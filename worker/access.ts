import type { MiddlewareHandler } from 'hono';
import { type Ctx, isUnconfigured } from './types';

/**
 * Verifies the Cloudflare Access JWT against the team's JWKS.
 *
 * This is the security-relevant part of the whole build — get it reviewed rather
 * than trusting it because it returns 200. Three mistakes are easy and all fatal:
 *
 *   1. Trusting Cf-Access-Authenticated-User-Email without verifying the JWT.
 *      That header is set by Access, but anything that can reach the Worker
 *      directly can also set it. Verify the signature, always.
 *   2. Skipping the aud check. A JWT from a DIFFERENT Access application in the
 *      same team is signed by the same JWKS and will otherwise validate here.
 *   3. Letting the dev bypass survive into production. It is keyed on the AUD
 *      still being the wrangler.jsonc placeholder, so configuring Access closes
 *      it automatically rather than relying on anyone remembering.
 */

type Jwk = { kid: string; kty: string; alg?: string; n: string; e: string };

let jwksCache: { keys: Jwk[]; at: number; domain: string } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function getKeys(teamDomain: string): Promise<Jwk[]> {
  if (jwksCache && jwksCache.domain === teamDomain && Date.now() - jwksCache.at < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('jwks fetch failed');
  const body = (await res.json()) as { keys: Jwk[] };
  jwksCache = { keys: body.keys, at: Date.now(), domain: teamDomain };
  return body.keys;
}

const b64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/**
 * Is this the local Vite dev server?
 *
 * `import.meta.env.DEV` is substituted at BUILD time — true in the dev server, false in anything
 * `vite build` produces. It is therefore not spoofable at runtime: a deployed bundle cannot express
 * it, no matter what headers arrive. The localhost check is belt-and-braces on top.
 *
 * This replaced keying the dev bypass on the AUD placeholder. That was a good idea with one fatal
 * property — configuring Access (which you must do before deploying) also switched local dev OFF,
 * so every /api route 401'd on a developer's machine and the dashboard could not be worked on at
 * all. The two concerns are separate: "is Access configured" is about production, "is this a dev
 * server" is about where the code is running.
 */
const isLocalDev = (c: { req: { url: string } }): boolean => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(import.meta as any).env?.DEV) return false;
  const host = new URL(c.req.url).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
};

export const accessAuth: MiddlewareHandler<Ctx> = async (c, next) => {
  // Local dev has no Access in front of the Worker. Gated on the build, so a production bundle
  // cannot take this path regardless of configuration or request headers.
  if (isLocalDev(c)) {
    c.set('email', 'dev@localhost');
    return next();
  }

  if (isUnconfigured(c.env)) {
    // The dev bypass exists because local dev has no Access in front of the Worker, and keying it on
    // the AUD placeholder is deliberate — configuring Access closes it automatically rather than
    // relying on anyone remembering.
    //
    // The gap was that the placeholder is what wrangler.jsonc SHIPS, so a deploy of the file as
    // committed was an open deploy. /api/cf holds CLOUDFLARE_API_TOKEN, so production logs and
    // analytics would have been served to anyone who found the hostname, with no DEV_BACKEND_JWT
    // needed. Add DEV_BACKEND_JWT and it also proxies /admin/* with an owner credential attached.
    //
    // So the bypass now additionally requires the request to be arriving at localhost. A deployed
    // Worker never is, which makes the dangerous state unreachable in production rather than merely
    // discouraged — while local dev, which legitimately holds a token and has no Access, still works.
    const host = new URL(c.req.url).hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');

    if (isLocal) {
      c.set('email', 'dev@localhost');
      return next();
    }

    console.error(
      '[access] REFUSING TO SERVE: ACCESS_AUD is still the placeholder on a non-local host. ' +
        'Configure ACCESS_AUD and ACCESS_TEAM_DOMAIN before deploying — serving here would expose ' +
        'this Worker\'s credentials unauthenticated.'
    );
    return c.json(
      {
        error: 'misconfigured',
        detail:
          'Cloudflare Access is not configured (ACCESS_AUD is still the placeholder). Refusing to serve rather than expose this Worker\'s credentials.'
      },
      503
    );
  }

  const token =
    c.req.header('Cf-Access-Jwt-Assertion') ??
    c.req.raw.headers.get('cookie')?.match(/CF_Authorization=([^;]+)/)?.[1];

  if (!token) return c.json({ error: 'unauthorized' }, 401);

  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return c.json({ error: 'unauthorized' }, 401);

    const header = JSON.parse(new TextDecoder().decode(b64url(h)));
    const payload = JSON.parse(new TextDecoder().decode(b64url(p)));

    // Access signs with RS256. Pinning it here stops an `alg: none` or HMAC
    // downgrade from being handed to importKey as if it were legitimate.
    if (header.alg !== 'RS256') return c.json({ error: 'unauthorized' }, 401);

    const jwk = (await getKeys(c.env.ACCESS_TEAM_DOMAIN)).find((k) => k.kid === header.kid);
    if (!jwk) return c.json({ error: 'unauthorized' }, 401);

    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64url(s),
      new TextEncoder().encode(`${h}.${p}`)
    );
    if (!ok) return c.json({ error: 'unauthorized' }, 401);

    // aud is an array. A token minted for another app in this team is signed by
    // the same JWKS and would otherwise pass.
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(c.env.ACCESS_AUD)) return c.json({ error: 'unauthorized' }, 401);
    if (!payload.exp || payload.exp * 1000 < Date.now()) return c.json({ error: 'unauthorized' }, 401);

    c.set('email', payload.email ?? 'unknown');
    return next();
  } catch {
    return c.json({ error: 'unauthorized' }, 401);
  }
};
