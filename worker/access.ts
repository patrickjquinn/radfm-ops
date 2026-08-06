import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { type Ctx, isUnconfigured } from './types';

/**
 * Verifies the Cloudflare Access JWT.
 *
 * This was hand-rolled - manual base64url decoding, a manual `crypto.subtle`
 * RSASSA verify, and manual `aud`/`exp` checks. It worked, and a security review
 * still found two holes in that layer. It also never checked `iss`, so a token
 * from another Cloudflare team, signed by whatever JWKS we happened to be pointed
 * at, would have passed.
 *
 * `jose` is what Cloudflare's own documentation uses for this. It verifies the
 * signature, the algorithm, `exp`, `nbf`, `aud` and `iss` in one call, and
 * `createRemoteJWKSet` handles fetching, caching and key rotation. Fewer places
 * for me to be subtly wrong, and none of them mine.
 *
 * Two things still matter and are NOT jose's job:
 *
 *   1. Passing `aud`. A JWT minted for a DIFFERENT Access application in the same
 *      team is signed by the same JWKS and would otherwise validate.
 *   2. Keeping the dev bypass unreachable in production. It is gated on
 *      `import.meta.env.DEV`, substituted at build time, so a deployed bundle
 *      compiles it to `return false` and cannot express it regardless of headers.
 */

/**
 * One JWKS per team domain, cached across requests.
 *
 * `createRemoteJWKSet` does its own fetching, caching and rotation. Rebuilding it
 * per request would refetch the key set on every call.
 */
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksDomain = '';

function keySet(teamDomain: string) {
  if (!jwks || jwksDomain !== teamDomain) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksDomain = teamDomain;
  }
  return jwks;
}

/**
 * Is this the local Vite dev server?
 *
 * `import.meta.env.DEV` is substituted at BUILD time - true in the dev server, false in anything
 * `vite build` produces. It is therefore not spoofable at runtime: a deployed bundle cannot express
 * it, no matter what headers arrive. The localhost check is belt-and-braces on top.
 *
 * This replaced keying the dev bypass on the AUD placeholder. That was a good idea with one fatal
 * property - configuring Access (which you must do before deploying) also switched local dev OFF,
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

/**
 * Where Access puts the assertion, and the cookie it falls back to.
 *
 * Extracted so it can be tested without standing up a JWKS: getting this wrong
 * fails closed and looks identical to a bad signature.
 */
export function readAccessToken(headerValue: string | undefined, cookie: string | null): string | null {
  if (headerValue) return headerValue;
  return cookie?.match(/CF_Authorization=([^;]+)/)?.[1] ?? null;
}

/**
 * The issuer to expect, which is NOT necessarily the current team domain.
 *
 * Access pins an application's `iss` at creation and does NOT update it when the
 * Zero Trust team is renamed. This application was created under
 * long-wildflower-f4fb and still issues tokens with that issuer, months of
 * renames later. Verified empirically: renaming the team to `radfm`, logging out
 * and logging back in still produced `iss: https://long-wildflower-f4fb…`.
 *
 * So the JWKS domain and the issuer are two different values that merely happen
 * to match on an account that has never been renamed - which is why every example
 * (Cloudflare's included) conflates them. ACCESS_ISSUER exists to hold them apart.
 * Defaulting to the team domain keeps the common case zero-config.
 */
export function expectedIssuer(env: { ACCESS_ISSUER?: string; ACCESS_TEAM_DOMAIN: string }): string {
  return env.ACCESS_ISSUER?.trim() || `https://${env.ACCESS_TEAM_DOMAIN}`;
}

/**
 * Explains the one `iss` failure that is not an attack.
 *
 * A token whose signature and `aud` are both good but whose `iss` is a DIFFERENT
 * cloudflareaccess.com domain is almost always the rename trap above, not an
 * attack. It does not resolve by logging out - the issuer is a property of the
 * application, not the session. The fix is to set ACCESS_ISSUER, and the point of
 * this hint is that nobody else spends an hour discovering that.
 *
 * The claim is read WITHOUT verification, which is safe because it is used only to
 * write a log line. Nothing is authorised on the strength of it - the request has
 * already been rejected by the time this runs.
 */
export function staleIssuerHint(token: string, expected: string): string {
  try {
    const payload = token.split('.')[1];
    if (!payload) return '';
    const json = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0))
      )
    );
    const iss = String(json?.iss ?? '');
    if (iss && iss !== expected) {
      return ` - token was issued by ${iss}, this Worker expects ${expected}. Access pins an application's issuer at creation and does NOT change it when the team is renamed, so this does not resolve by logging out. Set ACCESS_ISSUER to ${iss}.`;
    }
  } catch {
    /* a malformed token is already covered by the error above */
  }
  return '';
}

export const accessAuth: MiddlewareHandler<Ctx> = async (c, next) => {
  // Local dev has no Access in front of the Worker. Gated on the build, so a production bundle
  // cannot take this path regardless of configuration or request headers.
  if (isLocalDev(c)) {
    c.set('email', 'dev@localhost');
    return next();
  }

  if (isUnconfigured(c.env)) {
    // wrangler.jsonc SHIPS the placeholder, so a deploy of the file as committed would otherwise be
    // an open deploy. /api/cf holds CLOUDFLARE_API_TOKEN, so production logs and analytics would be
    // served to anyone who found the hostname. Refuse instead.
    console.error(
      '[access] REFUSING TO SERVE: ACCESS_AUD is still the placeholder. Configure ACCESS_AUD and ' +
        "ACCESS_TEAM_DOMAIN before deploying - serving here would expose this Worker's credentials."
    );
    return c.json(
      {
        error: 'misconfigured',
        detail:
          "Cloudflare Access is not configured (ACCESS_AUD is still the placeholder). Refusing to serve rather than expose this Worker's credentials."
      },
      503
    );
  }

  const token = readAccessToken(c.req.header('Cf-Access-Jwt-Assertion'), c.req.raw.headers.get('cookie'));
  if (!token) return c.json({ error: 'unauthorized' }, 401);

  try {
    const { payload } = await jwtVerify(token, keySet(c.env.ACCESS_TEAM_DOMAIN), {
      issuer: expectedIssuer(c.env),
      audience: c.env.ACCESS_AUD,
      algorithms: ['RS256']
    });

    c.set('email', typeof payload.email === 'string' ? payload.email : 'unknown');

    // Kept verbatim so the /admin/* proxy can forward it as Cf-Access-Token. Forwarding the
    // ORIGINAL assertion is the whole mechanism behind Access Linked App Token: the downstream
    // application validates the token was issued for THIS application, then attributes the request
    // to the original human rather than to a shared service credential.
    c.set('accessJwt', token);

    return next();
  } catch (err) {
    // Which claim failed is deliberately NOT reported to the caller - an unauthenticated caller
    // learns nothing from a 401 beyond "no". It IS logged, because a verifier that fails closed and
    // says nothing anywhere is indistinguishable from an outage, and that cost an hour once already.
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[access] verification failed: ${detail}${staleIssuerHint(token, expectedIssuer(c.env))}`);
    return c.json({ error: 'unauthorized' }, 401);
  }
};
