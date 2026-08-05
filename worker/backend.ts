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
 *     "not allowed" from "not found" — the API will not tell you, on purpose.
 *   - Role is resolved server-side per request. Never cache it beyond a page
 *     load, and never read a role from the token: tokens outlive grants.
 *   - It fails closed. Before migration 0003 is applied every /admin/* route
 *     404s for everyone, owner included. If a known admin sees 404, check the
 *     migration before debugging the client.
 *
 * An allowlist, not a passthrough, and split by method. Reads are broad; the only
 * write that can cross this boundary is a Tier 1 config value. Every other
 * mutation — grant premium, revoke, force reconcile, rollback — is rejected here
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
  /^\/admin\/config$/
];

/**
 * Tier 1 runtime config only, and `operator` is enforced on the backend side —
 * this allowlist controls the shape of what can be asked for, never who may ask.
 * Authorisation stays where the role lives.
 */
const ALLOWED_PUT = [/^\/admin\/config\/[A-Z0-9_]+$/];

app.all('/*', async (c) => {
  const method = c.req.method;
  if (method !== 'GET' && method !== 'PUT') {
    return c.json({ error: 'read_only', detail: 'Mutations are Phase 4 — reads must earn trust first' }, 405);
  }

  // The operator's own Rad.FM JWT. There is no separate admin login: "reuse the
  // existing admin" resolved to reusing the existing user auth, so the dashboard
  // carries the operator's token rather than holding a credential of its own.
  const jwt = c.req.header('X-Rad-Jwt') ?? c.env.DEV_BACKEND_JWT ?? '';
  if (!jwt) return c.json({ error: 'no_backend_token' }, 401);

  const path = new URL(c.req.url).pathname.replace(/^\/api\/backend/, '');
  const allowed = method === 'GET' ? ALLOWED_GET : ALLOWED_PUT;
  if (!allowed.some((re) => re.test(path))) return c.json({ error: 'not_allowed' }, 404);

  const target = new URL(path, c.env.BACKEND_ORIGIN);
  target.search = new URL(c.req.url).search;

  const res = await fetch(target, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/json',
      ...(method === 'PUT' ? { 'Content-Type': 'application/json' } : {})
    },
    body: method === 'PUT' ? await c.req.text() : undefined
  });

  // Status is passed through untouched, 404 included. Translating it to
  // something friendlier here would destroy the distinction the backend is
  // deliberately refusing to make.
  return new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' }
  });
});

export { app as backend };
