import { describe, expect, it } from 'vitest';
import {
  clampHours,
  exactTotal,
  fourxxRows,
  groupDjReasons,
  groupNormalised,
  groupUpstream,
  messageOf,
  normalisePath,
  spendLimit,
  windowLabel
} from './cf';

/**
 * These tests exist because every one of them describes a bug that shipped.
 *
 * The fixtures are shapes recorded from LIVE Cloudflare responses on 5 Aug 2026,
 * not shapes invented from the documentation - which is exactly how the bugs got
 * in. Where a field name looks odd (`source.message`, `status: 'success'`), that
 * oddness is the point and must not be "tidied up".
 */

describe('messageOf', () => {
  // SHIPPED BUG: read $workers.event.message, which does not exist. Every message
  // came back empty, so the warnings panel rendered "no warnings" over a window
  // containing hundreds of them.
  it('reads the message from source.message, where it actually lives', () => {
    const live = {
      source: { level: 'warn', message: '[explorer] attempt 1/3 produced no usable article - retrying' },
      $workers: { event: { request: { path: '/ai/explorer' } } },
      timestamp: 1785931242554
    };
    expect(messageOf(live)).toBe('[explorer] attempt 1/3 produced no usable article - retrying');
  });

  it('returns empty rather than throwing on a shape it does not recognise', () => {
    expect(messageOf({})).toBe('');
    expect(messageOf(null)).toBe('');
  });
});

describe('groupNormalised', () => {
  const ev = (message: string) => ({ source: { message }, timestamp: 1 });

  // SHIPPED BUG: the setlist failure arrives once per artist name, so one failure
  // mode occupied a dozen rows at one count each and the real scale was invisible.
  it('collapses quoted literals so one failure mode is one row', () => {
    const groups = groupNormalised([
      ev('[setlists] last.fm fallback failed for "ursula harrison quartet": not found'),
      ev('[setlists] last.fm fallback failed for "the slow jamz orchestra": not found'),
      ev('[setlists] last.fm fallback failed for "soulection experience": not found')
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
    expect(groups[0].msg).toContain('"…"');
  });

  it('collapses numbers and hex, as scripts/logs.ts does', () => {
    const groups = groupNormalised([ev('rate limit for ip 10.2.3.4'), ev('rate limit for ip 88.99.1.2')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
  });

  it('keeps genuinely different failure modes apart', () => {
    const groups = groupNormalised([
      ev('[guard] text DJ degenerate (simile), regenerating'),
      ev('[guard] text DJ degenerate (names-nothing), regenerating')
    ]);
    expect(groups).toHaveLength(2);
  });

  it('ranks by count, so the biggest problem is the first row', () => {
    const groups = groupNormalised([ev('rare'), ev('common'), ev('common'), ev('common')]);
    expect(groups[0].msg).toBe('common');
  });
});

describe('groupDjReasons', () => {
  // SHIPPED BUG: degeneracyReason carries its parameters, so `too-short(20w < 24)`
  // and `too-short(18w < 24)` counted as different reasons and a real regression
  // would have been spread across a long tail of one-count rows.
  it('strips the parenthetical so one reason is one row', () => {
    const rows = groupDjReasons([
      { reason: 'ok', n: '271' },
      { reason: 'too-short(20w < 24)', n: '2' },
      { reason: 'too-short(18w < 24)', n: '1' },
      { reason: 'too-short(16w < 24)', n: '1' },
      { reason: 'wrong-track("a-ha")', n: '1' }
    ]);
    const byReason = Object.fromEntries(rows.map((r) => [r.reason, r.n]));
    expect(byReason['too-short']).toBe(4);
    expect(byReason['wrong-track']).toBe(1);
    expect(rows.some((r) => r.reason.includes('('))).toBe(false);
  });

  // Analytics Engine returns counts as strings. Concatenating them instead of
  // adding would produce a plausible-looking number, which is the worst kind.
  it('adds string counts as numbers', () => {
    const rows = groupDjReasons([
      { reason: 'simile', n: '10' },
      { reason: 'simile', n: '6' }
    ]);
    expect(rows[0].n).toBe(16);
  });

  it('puts ok first regardless of count, since it is the baseline', () => {
    const rows = groupDjReasons([
      { reason: 'simile', n: '90' },
      { reason: 'ok', n: '10' }
    ]);
    expect(rows[0].reason).toBe('ok');
  });
});

describe('normalisePath', () => {
  // SHIPPED BUG: Observability groups on the literal path, so one route arrived
  // as many rows and every share percentage divided by the wrong denominator.
  it('collapses ids so one route is one row', () => {
    expect(normalisePath('/apple/v1/me/library/playlists/p.9oDKOAatN4QNJbm/tracks')).toBe(
      '/apple/v1/me/library/playlists/:id/tracks'
    );
    expect(normalisePath('/user/3/stations')).toBe('/user/:id/stations');
    expect(normalisePath('/stations/art/8f21c0de-1234-5678-9abc-def012345678')).toBe('/stations/art/:uuid');
  });

  it('leaves a static route alone', () => {
    expect(normalisePath('/admin/users/lookup')).toBe('/admin/users/lookup');
    expect(normalisePath('/.env.txt')).toBe('/.env.txt');
  });

  it('never returns an empty string', () => {
    expect(normalisePath('/')).toBe('/');
  });
});

describe('fourxxRows', () => {
  // Shape recorded live: result.calculations[0].aggregates[].groups[{key,value}]
  const live = {
    calculations: [
      {
        aggregates: [
          {
            groups: [
              { key: '$workers.event.request.path', value: '/admin/users/lookup' },
              { key: '$workers.event.response.status', value: 404 }
            ],
            value: 373
          },
          {
            groups: [
              { key: '$workers.event.request.path', value: '/admin/users/lookup' },
              { key: '$workers.event.response.status', value: 429 }
            ],
            value: 39
          },
          {
            groups: [
              { key: '$workers.event.request.path', value: '/apple/v1/me/library/playlists/p.abc/tracks' },
              { key: '$workers.event.response.status', value: 429 }
            ],
            value: 5
          },
          {
            groups: [
              { key: '$workers.event.request.path', value: '/apple/v1/me/library/playlists/p.xyz/tracks' },
              { key: '$workers.event.response.status', value: 429 }
            ],
            value: 4
          }
        ]
      }
    ]
  };

  it('merges rows that differ only by an id in the path', () => {
    const { rows } = fourxxRows(live, 421);
    const apple = rows.filter((r) => r.route.startsWith('/apple'));
    expect(apple).toHaveLength(1);
    expect(apple[0].count).toBe(9);
  });

  it('takes the total from the ungrouped count, never from the visible rows', () => {
    const { total, rows } = fourxxRows(live, 421);
    expect(total).toBe(421);
    expect(rows[0].share).toBe('88.6%');
  });

  it('ranks by count and flags the statuses that signal an outage', () => {
    const { rows } = fourxxRows(live, 421);
    expect(rows[0].count).toBe(373);
    expect(rows.find((r) => r.status === '429')?.bad).toBe(true);
    expect(rows.find((r) => r.status === '404')?.bad).toBe(false);
  });

  /**
   * The regression this whole change exists for.
   *
   * The grouped telemetry query returns a capped set of groups, so the rows can
   * describe only part of the window. Dividing by the row sum would make the
   * breakdown total a tidy 100% and read as complete - the most convincing way to
   * be wrong. Shares must divide by the real count, and the shortfall must show.
   */
  it('divides shares by the true count, not by the rows it can see', () => {
    const { total, accounted, covered, rows } = fourxxRows(live, 10_000);
    expect(total).toBe(10_000);
    expect(accounted).toBe(421);
    expect(covered).toBe(false);
    expect(rows[0].share).toBe('3.7%');
  });

  it('reports covered when the rows do account for every 4xx', () => {
    expect(fourxxRows(live, 421).covered).toBe(true);
  });

  it('never reports a total of 0 when the exact count is unavailable', () => {
    // 0 would render as "no 4xx" - a false healthy reading, which is the exact
    // failure mode (Cloudflare's own console showing "0 Errors" during an outage)
    // that this dashboard was built to catch.
    const { total, covered } = fourxxRows(live, null);
    expect(total).toBeNull();
    expect(covered).toBe(false);
  });

  it('returns an empty result rather than throwing when there are no 4xx', () => {
    expect(fourxxRows(undefined, 0).rows).toEqual([]);
    expect(fourxxRows({ calculations: [] }, 0).rows).toEqual([]);
  });
});

describe('exactTotal', () => {
  it('reads the single aggregate from an ungrouped count query', () => {
    expect(exactTotal({ calculations: [{ aggregates: [{ value: 655 }] }] })).toBe(655);
  });

  it('is null, not 0, when the response has no aggregates', () => {
    expect(exactTotal({ calculations: [{ aggregates: [] }] })).toBeNull();
    expect(exactTotal(undefined)).toBeNull();
  });

  it('is null when the value is not a number, rather than coercing to NaN', () => {
    expect(exactTotal({ calculations: [{ aggregates: [{ value: 'lots' }] }] })).toBeNull();
  });
});

describe('clampHours', () => {
  // Observability retains 3 days. Asking for more silently returns less, which
  // would teach the operator a timeline that does not exist.
  it('caps at the 72h retention window', () => {
    expect(clampHours('168')).toBe(72);
    expect(clampHours('24')).toBe(24);
  });

  it('falls back rather than passing garbage to the API', () => {
    expect(clampHours(undefined)).toBe(24);
    expect(clampHours('-5')).toBe(24);
    expect(clampHours('abc')).toBe(24);
  });
});

/**
 * "No limit" and "could not check whether there is a limit" demand different
 * actions from the operator, and only one of them is reassuring. Collapsing the
 * second into the first would invent safety - the exact failure this dashboard
 * was built in response to, applied to its own controls.
 */
describe('spendLimit', () => {
  /**
   * Recorded from the LIVE gateway record on 6 Aug 2026, not invented from the
   * docs - which is exactly how the first version got it wrong. It guessed an
   * array of rules; the API returns an object wrapping them, and the window is
   * seconds rather than a word.
   */
  const live = {
    id: 'default',
    spend_limits: {
      enabled: true,
      rules: [{ id: '7bd5241b', enabled: true, limitType: 'cost', limit: 5, window: 86400, technique: 'sliding' }]
    }
  };

  it('reads the live shape', () => {
    expect(spendLimit(live).limits).toEqual([{ budget: 5, window: 'day', enabled: true }]);
  });

  it('treats the feature master switch as overriding a rule that says enabled', () => {
    // A rule listed as active under a disabled feature is not enforced. Showing it
    // as active would be the panel asserting protection that is not running.
    const off = { spend_limits: { enabled: false, rules: [{ limit: 5, window: 86400, enabled: true }] } };
    expect(spendLimit(off).limits?.[0].enabled).toBe(false);
  });

  it('treats a rule with no enabled flag as enforced', () => {
    const r = { spend_limits: { enabled: true, rules: [{ limit: 5, window: 86400 }] } };
    expect(spendLimit(r).limits?.[0].enabled).toBe(true);
  });

  it('still accepts a bare array, in case the shape moves back', () => {
    expect(spendLimit({ spend_limits: [{ limit: 10, window: 3600 }] }).limits).toEqual([
      { budget: 10, window: 'hour', enabled: true }
    ]);
  });

  it('reports an empty list when the gateway read fine and carries no rules', () => {
    // A real finding - "no limit set" - and distinct from the case below.
    expect(spendLimit({ id: 'default' }).limits).toEqual([]);
  });

  it('reports null, NOT an empty list, when the shape is unrecognised', () => {
    // Null renders as "cannot verify". Returning [] here would render as
    // "no limit set", which is a claim we have not earned.
    expect(spendLimit({ spend_limits: 'nope' }).limits).toBeNull();
    expect(spendLimit({ spend_limits: { enabled: true } }).limits).toBeNull();
    expect(spendLimit(null).limits).toBeNull();
  });
});

describe('windowLabel', () => {
  it('turns seconds into the word a human reads', () => {
    // The API returns 86400. Rendering it raw would put "$5 / 86400" on the
    // panel - true, and unreadable.
    expect(windowLabel(86_400)).toBe('day');
    expect(windowLabel(3600)).toBe('hour');
    expect(windowLabel(604_800)).toBe('week');
  });

  it('handles intervals with no name', () => {
    expect(windowLabel(259_200)).toBe('3 days');
    expect(windowLabel(7200)).toBe('2 hours');
    expect(windowLabel(90)).toBe('90s');
  });

  it('passes an already-worded interval straight through', () => {
    expect(windowLabel('day')).toBe('day');
  });

  it('says unknown rather than guessing', () => {
    expect(windowLabel(undefined)).toBe('unknown');
    expect(windowLabel(0)).toBe('unknown');
  });
});

/**
 * The upstream panel read "9 calls, 9 fail" for a provider that was plainly
 * working - the DJ produced 210 good lines on it in the same window.
 *
 * The slot mapping was never wrong. blobs are [event, provider, model, outcome]
 * exactly as queried. The bug was `sum(if(blob4 = 'ok', 0, 1))`: it invented a
 * success token the backend never writes, so every call fell into the else
 * branch and got reported as a provider failure.
 *
 * The fix is to stop guessing. Which string means success is the provider's
 * business; we show what was recorded.
 */
describe('groupUpstream', () => {
  it('folds per-outcome rows into one row per provider', () => {
    const rows = groupUpstream([
      { provider: 'groq', outcome: 'success', calls: '400', latency: 700, attempts: 1 },
      { provider: 'groq', outcome: 'error:403', calls: '100', latency: 1200, attempts: 2 }
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].calls).toBe(500);
    expect(rows[0].outcomes).toEqual({ success: 400, 'error:403': 100 });
  });

  it('adds string counts as numbers', () => {
    // Analytics Engine returns counts as strings. Concatenating gives "400100",
    // which is a plausible-looking number and therefore the worst kind of wrong.
    expect(groupUpstream([
      { provider: 'g', outcome: 'a', calls: '400' },
      { provider: 'g', outcome: 'b', calls: '100' }
    ])[0].calls).toBe(500);
  });

  it('weights the averages by call count', () => {
    // A rare failing outcome must not drag the provider's p50 to its own value.
    const [g] = groupUpstream([
      { provider: 'g', outcome: 'success', calls: '900', latency: 100, attempts: 1 },
      { provider: 'g', outcome: 'error', calls: '100', latency: 1100, attempts: 2 }
    ]);
    expect(Math.round(g.latency)).toBe(200);
    expect(Number(g.attempts.toFixed(1))).toBe(1.1);
  });

  it('names an empty outcome rather than rendering a blank chip', () => {
    expect(groupUpstream([{ provider: 'g', outcome: '', calls: '3' }])[0].outcomes).toEqual({ '(not recorded)': 3 });
  });

  it('ranks providers by call volume', () => {
    const rows = groupUpstream([
      { provider: 'small', outcome: 'success', calls: '5' },
      { provider: 'big', outcome: 'success', calls: '500' }
    ]);
    expect(rows[0].provider).toBe('big');
  });
});
