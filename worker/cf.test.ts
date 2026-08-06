import { describe, expect, it } from 'vitest';
import { clampHours, fourxxRows, groupDjReasons, groupNormalised, messageOf, normalisePath } from './cf';

/**
 * These tests exist because every one of them describes a bug that shipped.
 *
 * The fixtures are shapes recorded from LIVE Cloudflare responses on 5 Aug 2026,
 * not shapes invented from the documentation — which is exactly how the bugs got
 * in. Where a field name looks odd (`source.message`, `status: 'success'`), that
 * oddness is the point and must not be "tidied up".
 */

describe('messageOf', () => {
  // SHIPPED BUG: read $workers.event.message, which does not exist. Every message
  // came back empty, so the warnings panel rendered "no warnings" over a window
  // containing hundreds of them.
  it('reads the message from source.message, where it actually lives', () => {
    const live = {
      source: { level: 'warn', message: '[explorer] attempt 1/3 produced no usable article — retrying' },
      $workers: { event: { request: { path: '/ai/explorer' } } },
      timestamp: 1785931242554
    };
    expect(messageOf(live)).toBe('[explorer] attempt 1/3 produced no usable article — retrying');
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
    const { rows } = fourxxRows(live);
    const apple = rows.filter((r) => r.route.startsWith('/apple'));
    expect(apple).toHaveLength(1);
    expect(apple[0].count).toBe(9);
  });

  it('totals every 4xx, so the share column has an honest denominator', () => {
    const { total, rows } = fourxxRows(live);
    expect(total).toBe(421);
    expect(rows[0].share).toBe('88.6%');
  });

  it('ranks by count and flags the statuses that signal an outage', () => {
    const { rows } = fourxxRows(live);
    expect(rows[0].count).toBe(373);
    expect(rows.find((r) => r.status === '429')?.bad).toBe(true);
    expect(rows.find((r) => r.status === '404')?.bad).toBe(false);
  });

  it('returns an empty result rather than throwing when there are no 4xx', () => {
    expect(fourxxRows(undefined)).toEqual({ total: 0, rows: [] });
    expect(fourxxRows({ calculations: [] })).toEqual({ total: 0, rows: [] });
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
