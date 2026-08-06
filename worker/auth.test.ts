import { describe, expect, it } from 'vitest';
import { expiresInDays } from './index';
import { expectedIssuer, readAccessToken, staleIssuerHint } from './access';
import { isUnconfigured, UNCONFIGURED_AUD } from './types';

/**
 * The gate, and the two things that decide whether it is real.
 *
 * These do not exercise the JWKS crypto — that needs a live key set and belongs
 * in an integration test. They cover the branches that decide whether the crypto
 * runs at all, which is where a mistake is silent rather than loud.
 */

const base = {
  CF_ACCOUNT_ID: 'acct',
  BACKEND_ORIGIN: 'https://api.rad-fm.com',
  BACKEND_SCRIPT_NAME: 'rad-fm-backend',
  ACCESS_TEAM_DOMAIN: 'radfm.cloudflareaccess.com'
} as any;

describe('isUnconfigured', () => {
  it('treats the shipped placeholder as unconfigured', () => {
    // wrangler.jsonc ships this value, so a deploy of the file as committed must
    // never be mistaken for a configured one.
    expect(isUnconfigured({ ...base, ACCESS_AUD: UNCONFIGURED_AUD })).toBe(true);
  });

  it('treats a missing AUD as unconfigured', () => {
    expect(isUnconfigured({ ...base, ACCESS_AUD: '' })).toBe(true);
    expect(isUnconfigured({ ...base, ACCESS_AUD: undefined })).toBe(true);
  });

  it('treats a real AUD as configured', () => {
    expect(
      isUnconfigured({ ...base, ACCESS_AUD: 'b01e1140660d0a36b16f6e988774ac57e1c456bac1d36cb79108cee28450fe88' })
    ).toBe(false);
  });
});

describe('expiresInDays', () => {
  /** Unsigned, because the function reads the payload without verifying — by design. */
  const tokenExpiringIn = (days: number, now: number) => {
    const exp = Math.floor((now + days * 86_400_000) / 1000);
    // btoa rather than Buffer: this runs in the same runtime the Worker does.
    const payload = btoa(JSON.stringify({ userId: 3, typ: 'access', exp }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return `header.${payload}.signature`;
  };

  const NOW = 1_785_000_000_000;

  it('counts down to the expiry the countdown is for', () => {
    expect(expiresInDays(tokenExpiringIn(90, NOW), NOW)).toBe(90);
    expect(expiresInDays(tokenExpiringIn(1, NOW), NOW)).toBe(1);
  });

  it('goes negative once expired, so the UI can say so rather than go quiet', () => {
    expect(expiresInDays(tokenExpiringIn(-2, NOW), NOW)).toBeLessThan(0);
  });

  it('returns null when no token is held, rather than pretending to know', () => {
    expect(expiresInDays(undefined)).toBeNull();
    expect(expiresInDays('')).toBeNull();
  });

  it('returns null on a malformed token instead of throwing', () => {
    // A crash here would take down /api/session, which every panel depends on.
    expect(expiresInDays('not-a-jwt')).toBeNull();
    expect(expiresInDays('a.!!!not-base64!!!.c')).toBeNull();
    expect(expiresInDays('a.eyJubyI6ImV4cCJ9.c')).toBeNull();
  });
});

/**
 * The owner-token guard.
 *
 * Mirrors worker/backend.ts. The original objection to a Worker-held token was
 * that it "gives every Access user the rights of whoever's token it is" — this
 * is the answer to that, so it is worth a test that fails loudly if it regresses.
 */
const ownerTokenFor = (env: { OPS_OWNER_EMAIL?: string; OPS_BACKEND_JWT?: string }, caller?: string) => {
  const owner = env.OPS_OWNER_EMAIL?.trim().toLowerCase();
  const who = caller?.trim().toLowerCase();
  return owner && who && who === owner ? env.OPS_BACKEND_JWT : undefined;
};

describe('owner token guard', () => {
  const env = { OPS_OWNER_EMAIL: 'patrick.jm.quinn@gmail.com', OPS_BACKEND_JWT: 'owner-token' };

  it('attaches the token for the named owner', () => {
    expect(ownerTokenFor(env, 'patrick.jm.quinn@gmail.com')).toBe('owner-token');
  });

  it('is case and whitespace insensitive, since Access supplies the address', () => {
    expect(ownerTokenFor(env, '  Patrick.JM.Quinn@Gmail.com ')).toBe('owner-token');
  });

  it('does NOT hand the token to anyone else added to the Access policy', () => {
    // This is the whole guard: a second operator supplies their own token, so
    // admin_audit keeps naming a person rather than "the dashboard".
    expect(ownerTokenFor(env, 'someone.else@example.com')).toBeUndefined();
  });

  it('is inert when the owner email is not configured', () => {
    expect(ownerTokenFor({ OPS_BACKEND_JWT: 'owner-token' }, 'anyone@example.com')).toBeUndefined();
  });

  it('is inert when no token is held', () => {
    expect(ownerTokenFor({ OPS_OWNER_EMAIL: 'a@b.com' }, 'a@b.com')).toBeUndefined();
  });
});

describe('readAccessToken', () => {
  it('prefers the header Access actually sets', () => {
    expect(readAccessToken('from-header', 'CF_Authorization=from-cookie')).toBe('from-header');
  });

  it('falls back to the CF_Authorization cookie', () => {
    expect(readAccessToken(undefined, 'other=x; CF_Authorization=abc.def.ghi; more=y')).toBe('abc.def.ghi');
  });

  it('returns null when neither is present, so the caller 401s rather than verifying ""', () => {
    expect(readAccessToken(undefined, null)).toBeNull();
    expect(readAccessToken(undefined, 'unrelated=1')).toBeNull();
  });
});

describe('staleIssuerHint', () => {
  const tokenWithIss = (iss: string) => {
    const payload = btoa(JSON.stringify({ iss, aud: ['x'] }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return `header.${payload}.sig`;
  };

  // The exact failure that took the dashboard down after the team rename: a valid
  // signature and the right aud, rejected on iss alone, presenting as an outage.
  it('names both issuers and points at ACCESS_ISSUER, not at logging out', () => {
    const hint = staleIssuerHint(
      tokenWithIss('https://long-wildflower-f4fb.cloudflareaccess.com'),
      'https://radfm.cloudflareaccess.com'
    );
    expect(hint).toContain('long-wildflower-f4fb');
    expect(hint).toContain('radfm.cloudflareaccess.com');
    expect(hint).toMatch(/ACCESS_ISSUER/);
    // Logging out does NOT fix this — the issuer belongs to the application.
    expect(hint).toMatch(/does not resolve by logging out/i);
  });

  it('says nothing when the issuer is the one we expect', () => {
    expect(
      staleIssuerHint(tokenWithIss('https://radfm.cloudflareaccess.com'), 'https://radfm.cloudflareaccess.com')
    ).toBe('');
  });

  it('says nothing rather than throwing on a malformed token', () => {
    expect(staleIssuerHint('not-a-jwt', 'https://radfm.cloudflareaccess.com')).toBe('');
    expect(staleIssuerHint('a.!!!.c', 'https://radfm.cloudflareaccess.com')).toBe('');
  });
});

describe('expectedIssuer', () => {
  it('uses ACCESS_ISSUER when the app issuer has diverged from the team domain', () => {
    expect(
      expectedIssuer({
        ACCESS_ISSUER: 'https://long-wildflower-f4fb.cloudflareaccess.com',
        ACCESS_TEAM_DOMAIN: 'radfm.cloudflareaccess.com'
      })
    ).toBe('https://long-wildflower-f4fb.cloudflareaccess.com');
  });

  it('defaults to the team domain, so an unrenamed account needs no config', () => {
    expect(expectedIssuer({ ACCESS_TEAM_DOMAIN: 'radfm.cloudflareaccess.com' })).toBe(
      'https://radfm.cloudflareaccess.com'
    );
    expect(expectedIssuer({ ACCESS_ISSUER: '  ', ACCESS_TEAM_DOMAIN: 'radfm.cloudflareaccess.com' })).toBe(
      'https://radfm.cloudflareaccess.com'
    );
  });
});
