import { Hono } from 'hono';
import type { Ctx } from './types';

/**
 * Proxies api.rad-fm.com/admin/*. Everything touching D1, KV, R2 or entitlement
 * goes through here rather than being reimplemented, so the invariants stay in
 * one codebase.
 *
 * Behaviours the UI must respect, all deliberate on the backend side:
 *
 *   - Unauthorised returns 404, NOT 403. A 403 confirms the surface exists and
 *     that the caller merely lacks a role. Do not build UI that distinguishes
 *     "not allowed" from "not found" - the API will not tell you, on purpose.
 *   - Role is resolved server-side per request. Never cache it beyond a page
 *     load, and never read a role from the token: tokens outlive grants.
 *   - It fails closed. Before migration 0003 is applied every /admin/* route
 *     404s for everyone, owner included. If a known admin sees 404, check the
 *     migration before debugging the client.
 *
 * An allowlist, not a passthrough, and split by method. Reads are broad; the only
 * write that can cross this boundary is a Tier 1 config value. Every other
 * mutation - grant premium, revoke, force reconcile, rollback - is rejected here
 * as well as being absent from the UI, so enabling one is a deliberate act in two
 * places rather than an oversight in one.
 */

const app = new Hono<Ctx>();

const ALLOWED_GET = [
  /^\/admin\/me$/,
  /^\/admin\/stats$/,
  /^\/admin\/audit$/,
  /^\/admin\/users\/\d+\/entitlement$/,
  // Routes the backend does not serve yet. They are allowlisted so the dashboard
  // lights up the moment they ship; until then they 404 and the UI says which
  // route is missing rather than blaming the client.
  /^\/admin\/users\/lookup$/,
  /^\/admin\/stations$/,
  /^\/admin\/metrics\/setlists$/,
  /^\/admin\/metrics\/cron$/,
  /^\/admin\/config$/
];

/**
 * Tier 1 runtime config only, and `operator` is enforced on the backend side -
 * this allowlist controls the shape of what can be asked for, never who may ask.
 * Authorisation stays where the role lives.
 */
const ALLOWED_PUT = [/^\/admin\/config\/[A-Z0-9_]+$/];

app.all('/*', async (c) => {
  const method = c.req.method;
  if (method !== 'GET' && method !== 'PUT') {
    return c.json({ error: 'read_only', detail: 'Mutations are Phase 4 - reads must earn trust first' }, 405);
  }

  // The operator's own Rad.FM JWT, in order of preference:
  //
  //   1. A token pasted in this browser - always wins, so a second operator is
  //      always acting as themselves.
  //   2. The Worker-held owner token, but ONLY for the one Access identity named
  //      in OPS_OWNER_EMAIL. This exists because requiring the sole authorised
  //      operator to paste a second credential after already authenticating
  //      through Access is friction with no security return - the Access policy
  //      has already established who they are. The email check is what keeps the
  //      original objection answered: add a second person to the Access policy and
  //      they do NOT inherit this token, they supply their own.
  //   3. Local dev.
  const accessJwt = c.get('accessJwt');
  const ownerEmail = c.env.OPS_OWNER_EMAIL?.trim().toLowerCase();
  const caller = c.get('email')?.trim().toLowerCase();
  const ownerToken = ownerEmail && caller && caller === ownerEmail ? c.env.OPS_BACKEND_JWT : undefined;

  const jwt = c.req.header('X-Rad-Jwt') || ownerToken || c.env.DEV_BACKEND_JWT || '';

  // A missing bearer is only fatal if there is ALSO no Access assertion to forward.
  //
  // This used to 401 unconditionally, which would have made deleting OPS_BACKEND_JWT
  // break the dashboard even though the backend now derives identity from the
  // forwarded assertion. The bearer is the legacy path; Access is the replacement,
  // and once it carries identity the bearer is dead weight with an expiry date.
  if (!jwt && !accessJwt) return c.json({ error: 'no_backend_token' }, 401);

  const path = new URL(c.req.url).pathname.replace(/^\/api\/backend/, '');
  const allowed = method === 'GET' ? ALLOWED_GET : ALLOWED_PUT;
  if (!allowed.some((re) => re.test(path))) return c.json({ error: 'not_allowed' }, 404);

  const target = new URL(path, c.env.BACKEND_ORIGIN);
  target.search = new URL(c.req.url).search;

  const res = await fetch(target, {
    method,
    headers: {
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      Accept: 'application/json',
      // Access Linked App Token. Forwarding the verified assertion lets an Access
      // application in front of api.rad-fm.com/admin/* validate that this request
      // came from THIS dashboard, and attribute it to the original human in the
      // audit log - no shared secret, no minted token, nothing to expire.
      //
      // Sent unconditionally and harmlessly ignored until that application exists,
      // so the backend side can land without a redeploy here.
      ...(accessJwt ? { 'Cf-Access-Token': accessJwt } : {}),
      ...(method === 'PUT' ? { 'Content-Type': 'application/json' } : {})
    },
    body: method === 'PUT' ? await c.req.text() : undefined
  });

  // Diagnostics on failure only. A 404 from /admin/* is deliberately ambiguous
  // (limiter, role, or migration), so when one happens it is worth recording what
  // this side actually sent - otherwise the ambiguity becomes untraceable across
  // two codebases, which is precisely what happened when the owner token was
  // removed and every /admin/* route began 404ing.
  if (!res.ok) {
    console.error(
      `[backend] ${method} ${path} -> ${res.status} | bearer=${jwt ? 'yes' : 'no'} | cf-access-token=${
        accessJwt ? `yes(${accessJwt.length} chars)` : 'NO'
      } | caller=${caller ?? 'unknown'}`
    );
  }

  // Status is passed through untouched, 404 included. Translating it to
  // something friendlier here would destroy the distinction the backend is
  // deliberately refusing to make.
  return new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' }
  });
});

/**
 * The one test that licenses deleting OPS_BACKEND_JWT.
 *
 * "Confirm the dashboard still reaches /admin/*" is satisfiable with the bearer
 * attached, which proves only that requests arrive - nothing about whether Access
 * carries identity. Acting on that weaker check is what took /admin/* down on
 * 6 Aug: the bearer was deleted, the Access path had never actually resolved a
 * role, and every route 404'd with no way to tell which of three causes it was.
 *
 * So this asks the real question: with the bearer DELIBERATELY suppressed and only
 * the forwarded assertion to go on, does the backend resolve a role?
 *
 * Suppressing a credential can only ever reduce this request's authority - there
 * is no configuration in which sending less makes it stronger. That is what makes
 * a permanent probe safe to leave mounted rather than a one-off branch to delete.
 *
 * It exists as a route rather than a curl because Access now blocks direct calls
 * to /admin/* at the edge, so the dashboard is the only client that can reach
 * them at all. Diagnosis has to live here.
 */
const probe = new Hono<Ctx>();

probe.get('/access', async (c) => {
  const accessJwt = c.get('accessJwt');
  if (!accessJwt) {
    return c.json({
      ok: false,
      verdict: 'no_assertion',
      detail:
        'No Access assertion on this request, so there is nothing to forward. Under the local dev bypass there is no Access in front of the Worker - run this against the deployed ops.rad-fm.com.'
    });
  }

  const target = new URL('/admin/me', c.env.BACKEND_ORIGIN);
  let res: Response;
  try {
    res = await fetch(target, {
      // No Authorization header, deliberately and unconditionally. That omission IS the test.
      headers: { Accept: 'application/json', 'Cf-Access-Token': accessJwt }
    });
  } catch (err) {
    return c.json({
      ok: false,
      verdict: 'unreachable',
      detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    });
  }

  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* a non-JSON body is itself the finding - keep it as text */
  }

  // A role is the only pass condition. A 200 carrying no `can` object means the
  // assertion authenticated but resolved nobody, which is a different bug from a
  // 404 and must not be reported as success.
  const can = (body as { can?: Record<string, boolean> })?.can;
  const ok = res.ok && Boolean(can);

  return c.json({
    ok,
    verdict: ok
      ? 'access_path_carries_identity'
      : res.status === 404
        ? 'rejected_404'
        : res.status === 403
          ? 'blocked_at_edge_403'
          : res.ok
            ? 'authenticated_but_no_role'
            : 'rejected',
    status: res.status,
    can: can ?? null,
    body,
    sent: {
      authorization: false,
      cfAccessToken: `${accessJwt.length} chars`,
      caller: c.get('email') ?? null,
      target: target.toString()
    },
    /**
     * Written into the response rather than left to memory, because the whole
     * point of the probe is that the person reading it is deciding whether to
     * delete a credential that is hard to mint again.
     */
    meaning: ok
      ? 'The Access path resolves a role without a bearer. OPS_BACKEND_JWT is now dead weight and can be deleted.'
      : res.status === 403
        ? 'Cloudflare Access rejected this at the edge - the Linked App Token policy did not accept the forwarded token. Do NOT delete OPS_BACKEND_JWT.'
        : 'The backend did not resolve a role from the assertion alone. Deleting OPS_BACKEND_JWT would take /admin/* down. Check the backend logs for the aud it received vs expected.'
  });
});

export { app as backend, probe };
