import { describe, expect, it } from 'vitest';
import { reasonText, statValue } from './api';
import { dedupeSignals, type Signal } from './health';

/**
 * The contract between this client and the Rad.FM backend.
 *
 * The payloads below are recorded from the LIVE handlers in
 * `rad-fm-backend/src/users/routes/admin.ts`. If the backend renames a field,
 * these fail - which is the entire point.
 *
 * The bug this guards against shipped to production: the client read
 * `premiumUsers`, `pastPlays` and `likedSongs`; the handler returns `premium`,
 * `plays` and `liked`. Missing fields came back `undefined`, statValue turned
 * `undefined` into null, and null renders as "unavailable" - so the dashboard
 * reported three counts as unreadable while the backend returned them perfectly.
 *
 * A false "unavailable" is the same class of lie as a false zero, and it is worse
 * in this tool than anywhere else, because admitting what it could not read is
 * the single promise the whole thing makes.
 */

/** Exactly what GET /admin/stats returns. */
const STATS = {
  users: 632,
  newUsers7d: 14,
  premium: 19,
  premiumPct: 3,
  stations: 342,
  plays: 35035,
  liked: 4508,
  activeUsers24h: 12,
  activeUsers7d: 45,
  dataQuality: { pastPlaysMissingPlayedAt: 0 }
};

/** Exactly what GET /admin/users/:id/entitlement returns. */
const ENTITLEMENT = {
  user: { id: 3, email: 'patrick.jm.quinn@gmail.com', username: 'patrick', created_at: '2025-09-09 00:00:00' },
  local: { isPremium: true, grantedAt: '2026-08-05 16:14:51' },
  meta: { user_id: 3, premium_since: null, last_source: 'api', rc_subscriber_id: '3', app_id: 'app3e6d845aab' },
  audit: [{ created_at: '2026-08-05', source: 'api', entitlement_id: 'Rad.FM+' }],
  note: 'local is a CACHE of RevenueCat, not the source of truth - cross-check before acting'
};

/** Exactly what GET /admin/audit returns. */
const AUDIT = {
  entries: [
    {
      id: 41,
      actor_id: 3,
      actor_email: 'patrick.jm.quinn@gmail.com',
      action: 'config.write',
      target: 'MAX_OTP_ATTEMPTS',
      outcome: 'ok',
      created_at: '2026-08-05 16:24:00'
    }
  ]
};

describe('/admin/stats contract', () => {
  it('every count the Scale panel reads is present and non-null', () => {
    const read = {
      users: statValue(STATS.users),
      premium: statValue(STATS.premium),
      stations: statValue(STATS.stations),
      plays: statValue(STATS.plays),
      liked: statValue(STATS.liked),
      activeUsers24h: statValue(STATS.activeUsers24h),
      activeUsers7d: statValue(STATS.activeUsers7d)
    };
    for (const [field, value] of Object.entries(read)) {
      expect(value, `${field} read as null - the panel would render "unavailable"`).not.toBeNull();
    }
  });

  it('does NOT answer to the names the client originally guessed', () => {
    // If these ever become real, this test is the reminder to update the client
    // rather than to leave three panels quietly dark.
    expect(STATS).not.toHaveProperty('premiumUsers');
    expect(STATS).not.toHaveProperty('pastPlays');
    expect(STATS).not.toHaveProperty('likedSongs');
  });

  it('treats -1 as the query-failed sentinel, never as a count', () => {
    expect(statValue(-1)).toBeNull();
    expect(statValue(0)).toBe(0); // a real zero must survive
    expect(statValue(undefined)).toBeNull();
    expect(statValue(null)).toBeNull();
  });
});

describe('/admin/users/:id/entitlement contract', () => {
  it('premium status lives at local.isPremium, not at a bare premium', () => {
    expect(ENTITLEMENT).not.toHaveProperty('premium');
    expect(ENTITLEMENT.local.isPremium).toBe(true);
  });

  it('returns no RevenueCat side yet - the panel must not claim a cross-check', () => {
    // When the backend adds this, the panel flips itself to In agreement / Drift
    // with no frontend change. Until then "Not cross-checked" is the honest label.
    expect(ENTITLEMENT).not.toHaveProperty('revenueCat');
  });

  it('degrades per field, so a null section is not "no entitlement"', () => {
    const degraded = { ...ENTITLEMENT, meta: null, audit: null };
    expect(degraded.user).toBeTruthy();
    expect(degraded.local.isPremium).toBe(true);
  });
});

describe('/admin/audit contract', () => {
  it('rows are under entries, with actor_email', () => {
    // Reading `rows` or `audit` here returned [], which rendered as "no admin
    // actions recorded" - the most misleading thing an audit table can say.
    expect(AUDIT).toHaveProperty('entries');
    expect(AUDIT.entries[0]).toHaveProperty('actor_email');
    expect(AUDIT.entries[0]).not.toHaveProperty('actor_user_id');
  });
});

describe('reasonText', () => {
  it('names all three causes of a 404, because the API will not', () => {
    const text = reasonText('not_found');
    expect(text).toMatch(/rate limit/i);
    expect(text).toMatch(/role/i);
    expect(text).toMatch(/migration/i);
  });

  it('does not describe a missing route as a permissions problem', () => {
    // The interim "route_not_built" inference was removed once the routes shipped:
    // a 404 now means limiter, role, or migration - never "not written yet".
    expect(reasonText('not_found')).not.toMatch(/not been built/i);
  });

  it('names the wrangler OAuth token trap by its error code', () => {
    expect(reasonText('bad_token')).toMatch(/10000/);
  });
});

/**
 * The invariant health.ts exists for: one count of one thing.
 *
 * A duplicated signal block once pushed the same signal twice and did it after
 * the overview badge had been computed, so the badge read 2, the header read 3,
 * and the list showed the same row twice - on the same screen, at the same time.
 * That is the exact failure this module was centralised to prevent.
 */
describe('dedupeSignals', () => {
  const sig = (title: string, sev: Signal['sev'] = 'bad'): Signal => ({
    id: `signal:${title}`,
    title,
    evidence: '',
    metric: '1',
    source: 'test',
    sev,
    go: 'overview'
  });

  it('collapses a signal pushed twice, so the count matches the rows', () => {
    const out = dedupeSignals([sig('zero tracks'), sig('Elevated 4xx'), sig('zero tracks')]);
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.title)).toEqual(['zero tracks', 'Elevated 4xx']);
  });

  it('keeps the first occurrence, so blast-radius ranking survives', () => {
    const first = sig('dup', 'bad');
    const out = dedupeSignals([first, sig('other', 'warn'), sig('dup', 'warn')]);
    expect(out[0]).toBe(first);
    expect(out[0].sev).toBe('bad');
  });

  /**
   * Titles interpolate live values, so the same signal can render as different
   * text between passes. Keying on the title would let that slip through as two
   * rows - which is the failure, not the cosmetic detail.
   */
  it('keys on the stable id, not the interpolated title', () => {
    const a: Signal = { ...sig('3 requests returned zero tracks'), id: 'signal:recs-zero-tracks' };
    const b: Signal = { ...sig('4 requests returned zero tracks'), id: 'signal:recs-zero-tracks' };
    expect(dedupeSignals([a, b])).toHaveLength(1);
  });

  it('leaves a list with no duplicates untouched', () => {
    const list = [sig('a'), sig('b'), sig('c')];
    expect(dedupeSignals(list)).toEqual(list);
  });
});
