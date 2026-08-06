import { Hono } from 'hono';
import { accessAuth } from './access';
import { cf } from './cf';
import { backend, probe } from './backend';
import { type Ctx, isUnconfigured } from './types';

const app = new Hono<Ctx>();

// Gate 1: Cloudflare Access. Every /api route requires a verified Access JWT.
//
// Two independent gates protect this system, and both are necessary:
//   - Access alone protects the UI but not the API surface.
//   - The backend role check alone means a leaked JWT is full access.
app.use('/api/*', accessAuth);

app.route('/api/cf', cf); // named Cloudflare API queries; holds the token
app.route('/api/backend', backend); // proxies api.rad-fm.com/admin/*
app.route('/api/probe', probe); // diagnostics; deliberately weaker than the proxy, never stronger

/** What the client needs to render its chrome honestly, and nothing more. */
app.get('/api/session', (c) =>
  c.json({
    email: c.get('email'),
    accessConfigured: !isUnconfigured(c.env),
    // Only reported once Access is genuinely configured. Under the local-dev bypass this endpoint is
    // unauthenticated, and "which credentials does this host hold" is precisely the reconnaissance an
    // anonymous caller should not get for free.
    cfTokenPresent: isUnconfigured(c.env) ? undefined : Boolean(c.env.CLOUDFLARE_API_TOKEN),
    /**
     * Whether the Worker can reach /admin/* without the browser supplying a token.
     * The client needs this to know it may call /admin/me at all: gating that call
     * purely on a pasted token means the local dev fallback can never resolve a
     * role, and every role-gated control stays dark for the wrong reason.
     */
    devBackendJwt: isUnconfigured(c.env) ? undefined : Boolean(c.env.DEV_BACKEND_JWT),
    /**
     * Whether the Worker will attach an owner token for THIS caller. Reported per
     * request rather than as a global flag, so a second operator added to the
     * Access policy correctly sees "you need your own token" instead of a UI that
     * claims to be configured and then 401s.
     */
    ownerTokenForCaller:
      Boolean(c.env.OPS_BACKEND_JWT) &&
      Boolean(c.env.OPS_OWNER_EMAIL) &&
      c.get('email')?.trim().toLowerCase() === c.env.OPS_OWNER_EMAIL?.trim().toLowerCase(),
    /**
     * Days until the Worker-held owner token expires, or null if none is held.
     *
     * The Access session renews itself; this token cannot. It is a Rad.FM JWT
     * signed with the backend's JWT_SECRET, and Cloudflare has no way to mint or
     * refresh one — which is the whole reason it has a fixed lifetime. Without
     * this figure the first symptom of expiry is half the dashboard going dark
     * for no stated reason, which is the failure mode this tool exists to avoid.
     */
    ownerTokenExpiresInDays: expiresInDays(c.env.OPS_BACKEND_JWT),
    backendOrigin: c.env.BACKEND_ORIGIN,
    scriptName: c.env.BACKEND_SCRIPT_NAME,
    /** Observability retains 3 days; the UI surfaces this rather than truncating silently. */
    retentionHours: 72
  })
);

/**
 * Days until a JWT's `exp`, read WITHOUT verifying the signature.
 *
 * That is safe here and only here: this is the token we hold ourselves, and the
 * answer is used to display a countdown, never to decide access. Nothing is
 * authorised on the strength of it. Any use beyond a label must verify first.
 */
export function expiresInDays(jwt: string | undefined, now = Date.now()): number | null {
  if (!jwt) return null;
  const payload = jwt.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0))
      )
    );
    if (typeof json?.exp !== 'number') return null;
    return Math.floor((json.exp * 1000 - now) / 86_400_000);
  } catch {
    return null;
  }
}

// Static SPA assets last, so /api never falls through to index.html.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
