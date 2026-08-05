import { Hono } from 'hono';
import { accessAuth } from './access';
import { cf } from './cf';
import { backend } from './backend';
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

/** What the client needs to render its chrome honestly, and nothing more. */
app.get('/api/session', (c) =>
  c.json({
    email: c.get('email'),
    accessConfigured: !isUnconfigured(c.env),
    cfTokenPresent: Boolean(c.env.CLOUDFLARE_API_TOKEN),
    /**
     * Whether the Worker can reach /admin/* without the browser supplying a token.
     * The client needs this to know it may call /admin/me at all: gating that call
     * purely on a pasted token means the local dev fallback can never resolve a
     * role, and every role-gated control stays dark for the wrong reason.
     */
    devBackendJwt: Boolean(c.env.DEV_BACKEND_JWT),
    backendOrigin: c.env.BACKEND_ORIGIN,
    scriptName: c.env.BACKEND_SCRIPT_NAME,
    /** Observability retains 3 days; the UI surfaces this rather than truncating silently. */
    retentionHours: 72
  })
);

// Static SPA assets last, so /api never falls through to index.html.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
