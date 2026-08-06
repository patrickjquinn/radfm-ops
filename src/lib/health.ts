import {
  useAdminStats,
  useTraffic,
  useAeDj,
  useAeProbe,
  useAeRecs,
  useLogs,
  useSetlistFill,
  useStatus4xx,
  useVersions
} from './api';
import * as fx from './fixtures';
import type { Scenario } from './fixtures';
import type { ViewId } from '../App';

/**
 * One derivation of "how is it going", consumed by both the nav badges and the
 * Overview verdict.
 *
 * This is centralised rather than computed twice on purpose. Two counts of the
 * same thing that disagree on the same screen is precisely the failure this tool
 * exists to prevent - a dashboard that contradicts itself teaches an operator to
 * trust none of it.
 */

export type Badge = { text: string; kind: 'bad' | 'warn' | 'plain' };

/**
 * Thresholds, calibrated against the real baselines measured 5 Aug 2026 - not
 * round numbers picked because they look tidy.
 *
 * The DJ guard rejects roughly 14% of takes when everything is working (264 `ok`
 * of 307 over 7 days). A 10% threshold - the obvious-looking choice - would have
 * fired permanently on a healthy system, and a dashboard that always shows a
 * warning has trained you to ignore it by the second day.
 *
 * MIN_SAMPLE matters as much as the threshold. DJ events run ~44/day, so a 6h
 * window holds barely a dozen: one bad stretch swings the percentage wildly and
 * the number means nothing. Below the floor no claim is made either way, which is
 * different from claiming health.
 */
const DJ_NONOK_WARN = 25;
const RECS_DEGRADED_WARN = 10;
const MIN_SAMPLE = 30;

/**
 * The DJ pass rate has a DAYPART CYCLE, measured by the backend on 6 Aug:
 *
 *     overnight  ~78% ok      daytime  ~92% ok
 *
 * Consistently, before and after any deploy. Against an 86% blended baseline a
 * short overnight window sits near 22% non-ok and would breach the 25% line most
 * nights - the dashboard would cry wolf every night and be ignored by the second
 * week. They nearly reported an overnight figure as a regression themselves before
 * checking like-for-like.
 *
 * So the DJ signal requires a window of at least 24h, which spans both dayparts
 * and makes the comparison honest. Below that, no claim is made either way.
 */
const DJ_MIN_WINDOW_HOURS = 24;

export type Signal = {
  /**
   * Stable identity, independent of the title.
   *
   * Titles interpolate live values ("3 requests returned zero tracks"), so they
   * change as the system changes. The narrative cites these ids and the Worker
   * drops any citation naming an id it was not given - that check is only worth
   * anything if the id is stable across renders.
   */
  id: string;
  title: string;
  evidence: string;
  metric: string;
  source: string;
  sev: 'bad' | 'warn' | 'info';
  go: ViewId;
};

export type Verdict = {
  tone: 'ok' | 'warn' | 'bad';
  title: string;
  sub: string;
  stats: { value: string; label: string; tone: 'plain' | 'bad' | 'dim' }[];
};

export type Health = {
  signals: Signal[];
  verdict: Verdict;
  badges: Partial<Record<ViewId, Badge>>;
};

/**
 * Every source the dashboard reads. Sources that could not be read are counted
 * as open signals, not skipped: "I could not ask" is a finding, and the whole
 * premise here is that a silent gap is how the last three incidents stayed
 * invisible.
 */
export function useHealth(hours: number, demo: Scenario | null, expiringInDays: number | null = null): Health {
  const live = !demo;
  const logHours = Math.min(hours, 72);

  const stats = useAdminStats(live);
  const four = useStatus4xx(logHours);
  const warn = useLogs('warn', logHours);
  const dj = useAeDj(hours);
  const recs = useAeRecs(hours);
  const probe = useAeProbe();
  const versions = useVersions();
  const setlists = useSetlistFill(logHours, live);
  const traffic = useTraffic(hours);

  if (demo) return demoHealth(demo);

  const sources = [
    { s: stats, label: 'D1 counts', go: 'overview' as ViewId },
    { s: four, label: '4xx breakdown', go: 'traffic' as ViewId },
    { s: warn, label: 'Warnings', go: 'logs' as ViewId },
    { s: dj, label: 'DJ outcomes', go: 'rad' as ViewId },
    { s: recs, label: 'Pool health', go: 'recs' as ViewId },
    { s: probe, label: 'Analytics Engine', go: 'rad' as ViewId },
    { s: versions, label: 'Deploy history', go: 'overview' as ViewId },
    { s: setlists, label: 'Setlist fill rate', go: 'logs' as ViewId },
    { s: traffic, label: 'Request metrics', go: 'traffic' as ViewId }
  ];

  const unreadable = sources.filter((x) => x.s.state === 'unavailable');
  const signals: Signal[] = [];

  // One signal per unreadable source, so the count on the badge, the count in the
  // verdict and the number of rows in the list are all the same number.
  for (const u of unreadable) {
    signals.push({
      id: `signal:unread:${u.go}`,
      title: `${u.label} could not be read`,
      evidence:
        u.s.state === 'unavailable'
          ? reasonShort(u.s.reason)
          : '',
      metric: 'unavailable',
      source: u.label,
      sev: 'warn',
      go: u.go
    });
  }

  // The owner token cannot renew itself - the Access session does, this does not.
  // Warn while there is still time to mint another, rather than after half the
  // dashboard has silently gone to "unavailable".
  if (expiringInDays != null && expiringInDays <= 14)
    signals.unshift({
      id: 'signal:owner-token',
      title:
        expiringInDays <= 0
          ? 'Owner token has expired'
          : `Owner token expires in ${expiringInDays} day${expiringInDays === 1 ? '' : 's'}`,
      evidence:
        'Every /admin/* panel goes to "unavailable" when it lapses. Cloudflare Access cannot refresh it - it is a Rad.FM JWT signed with the backend\u2019s secret, which Cloudflare does not hold. Mint a new one (README § Owner token), or land the Access-JWT change and retire it.',
      metric: expiringInDays <= 0 ? 'expired' : `${expiringInDays}d`,
      source: 'ops Worker',
      sev: expiringInDays <= 3 ? 'bad' : 'warn',
      go: 'overview'
    });

  const probeEmpty = probe.state === 'ok' && probe.data.rows.length === 0;
  if (probeEmpty) {
    signals.push({
      id: 'signal:ae-unverified',
      title: 'Analytics Engine returned no datapoints',
      evidence:
        'Ingestion lags - a datapoint can take over a minute to become queryable - and writes are fire-and-forget, so one empty query is not proof a code path is cold. Check the binding is deployed before concluding anything.',
      metric: 'unverified',
      source: 'day-one check',
      sev: 'info',
      go: 'rad'
    });
  }

  // Real findings from sources that DID answer, ranked above the unreadable ones.
  const fourxxTotal = four.state === 'ok' ? four.data.rows.total : null;
  /**
   * The exact count, NOT the sum of the visible groups.
   *
   * The events view returns a sample, and summing it under-reported badly - 12h
   * showed more warnings than 24h on the same instant. The badge and the >500
   * threshold both hang off this number, so it has to be the real one.
   */
  const warnTotal = warn.state === 'ok' ? warn.data.total : null;
  /**
   * 5xx and uncaught exceptions, READ rather than assumed.
   *
   * This was the literal string '0'. Not a default, not a fallback - a constant,
   * printed in the most prominent position in the product, that would have gone
   * on reading 0 through a total 500-level outage. The Traffic view had it right
   * all along from GraphQL `sum.errors`; the verdict simply never asked.
   *
   * It is the exact failure this dashboard exists because of - Cloudflare's own
   * console showing "0 Errors" while every user was locked out - reproduced in
   * our own headline, against the one metric that incident was about.
   *
   * Null when traffic could not be read, and rendered as "-". A zero here has to
   * mean "we asked and there were none".
   */
  const fivexxTotal =
    traffic.state === 'ok'
      ? traffic.data.series.reduce((a: number, s: any) => a + Number(s.sum?.errors ?? 0), 0)
      : null;
  const djPct = dj.state === 'ok' ? nonOkPct(dj.data.rows) : null;
  const recsPct = recs.state === 'ok' ? degradedPct(recs.data.rows) : null;
  const recsZero = recs.state === 'ok' ? (recs.data.zeroTrackRequests ?? null) : null;
  const missingPlayedAt = stats.state === 'ok' ? stats.data.dataQuality?.pastPlaysMissingPlayedAt : undefined;

  if (djPct != null && hours >= DJ_MIN_WINDOW_HOURS && djPct >= DJ_NONOK_WARN)
    signals.unshift({
      id: 'signal:dj-degeneracy',
      title: 'DJ degeneracy rising',
      evidence: `Non-ok share is ${Math.round(djPct)}% against a ~14% baseline. The guard is rejecting more takes, and regressions here are otherwise only detectable by listening to the radio.`,
      metric: `${Math.round(djPct)}%`,
      source: 'Analytics Engine',
      sev: 'warn',
      go: 'rad'
    });

  // Degraded is the seatbelt; zero tracks is the crash. A request that returns no
  // tracks at all is a dead player, and those are NOT flagged degraded - three of
  // them sat underneath a "19 degraded" headline unnoticed. Ranked above the
  // fallback-rate signal because it is strictly worse.
  if (recsZero != null && recsZero > 0)
    signals.unshift({
      id: 'signal:recs-zero-tracks',
      title: `${recsZero} request${recsZero === 1 ? '' : 's'} returned zero tracks`,
      evidence:
        'A dead player, not a degraded one. These do not show up as "degraded" - the fallback did not rescue them, it returned nothing. Check poolSource for the cause.',
      metric: String(recsZero),
      source: 'Analytics Engine',
      sev: 'bad',
      go: 'recs'
    });

  if (recsPct != null && recsPct >= RECS_DEGRADED_WARN)
    signals.unshift({
      id: 'signal:recs-fallback',
      title: 'Recommendation fallback rate elevated',
      evidence: 'The orchestrator is degrading gracefully, so nothing throws and nothing alerts.',
      metric: `${Math.round(recsPct)}%`,
      source: 'Analytics Engine',
      sev: 'warn',
      go: 'recs'
    });

  if (missingPlayedAt != null && missingPlayedAt > 0)
    signals.unshift({
      id: 'signal:played-at',
      title: 'past_plays rows missing played_at',
      evidence: 'The insert has regressed. The recommender’s "recently played" exclusion becomes arbitrary as this climbs.',
      metric: missingPlayedAt.toLocaleString(),
      source: 'D1',
      sev: 'bad',
      go: 'overview'
    });

  // Baseline is 75%, measured on a live 100-event London listing. It sat around
  // 65% while looking healthy, because the failures logged as warnings and
  // warnings are not errors - this is the check that would have caught it.
  const fillRate = setlists.state === 'ok' ? setlists.data.fillRate : null;
  if (fillRate != null && fillRate < 0.7)
    signals.unshift({
      id: 'signal:setlist-fill',
      title: 'Setlist fill rate below baseline',
      evidence:
        'Failures log as warnings, so nothing throws and nothing alerts. This is the 1,094-warning bug’s signature.',
      metric: `${Math.round(fillRate * 100)}%`,
      source: 'D1 · setlists',
      sev: 'warn',
      go: 'logs'
    });

  if (fourxxTotal != null && fourxxTotal > 1000)
    signals.unshift({
      id: 'signal:4xx-elevated',
      title: 'Elevated 4xx',
      evidence: 'The platform’s headline Errors metric excludes 4xx entirely, so this does not appear there.',
      metric: fourxxTotal.toLocaleString(),
      source: 'Observability',
      sev: 'bad',
      go: 'traffic'
    });

  /**
   * One list, derived once, consumed by everything below.
   *
   * A duplicated signal block once pushed the same signal twice AND did it after
   * the overview badge had already been computed, so the badge read 2 while the
   * header read 3 and the list showed the same row twice. Two counts of the same
   * thing disagreeing on one screen is the precise failure this module exists to
   * prevent, so the guard is structural: dedupe here, and let nothing below read
   * the raw array.
   */
  const open = dedupeSignals(signals);

  const badges: Partial<Record<ViewId, Badge>> = {};
  if (open.length)
    badges.overview = {
      text: String(open.length),
      kind: open.some((s) => s.sev === 'bad') ? 'bad' : 'warn'
    };
  if (fourxxTotal) badges.traffic = { text: compact(fourxxTotal), kind: fourxxTotal > 1000 ? 'warn' : 'plain' };
  if (warnTotal) badges.logs = { text: compact(warnTotal), kind: warnTotal > 500 ? 'warn' : 'plain' };
  if (djPct != null && hours >= DJ_MIN_WINDOW_HOURS && djPct >= DJ_NONOK_WARN) badges.rad = { text: `${Math.round(djPct)}%`, kind: 'warn' };
  if (recsPct != null && recsPct >= RECS_DEGRADED_WARN) badges.recs = { text: `${Math.round(recsPct)}%`, kind: 'warn' };

  const bad = open.filter((s) => s.sev === 'bad').length;
  const verdict: Verdict = unreadable.length
    ? {
        // Never "Healthy" on the strength of sources we could not reach. That is a
        // different claim, and only one of them is supported by the data.
        tone: bad ? 'bad' : 'warn',
        title: `Unverified - ${unreadable.length} source${unreadable.length === 1 ? '' : 's'} could not be read`,
        sub: 'This is not a claim that anything is healthy. Nothing below has been confirmed against the live system.',
        stats: [
          { value: fourxxTotal != null ? compact(fourxxTotal) : '-', label: '4xx', tone: 'dim' },
          { value: fivexxTotal != null ? compact(fivexxTotal) : '-', label: '5xx', tone: fivexxTotal ? 'bad' : 'dim' },
          { value: String(unreadable.length), label: 'sources down', tone: 'bad' }
        ]
      }
    : {
        /**
         * Binary: failing, or not. There is deliberately no amber verdict.
         *
         * This read `open.length ? 'warn' : 'ok'`, which rendered the word
         * "Healthy" in amber whenever any signal was open. The word claimed one
         * thing and the colour claimed another, on the same line, and colour in
         * this product means state - so the panel was contradicting itself in
         * the one place that is supposed to settle the question.
         *
         * The design is explicit that this is two-valued (`incident ? bad : ok`),
         * and it is right: the signals below carry their own severity, so amber
         * belongs on them. The verdict answers "is something failing", and an
         * open warning is not a failure. If it were, it would be a `bad` signal.
         */
        tone: bad ? 'bad' : 'ok',
        title: bad
          ? `Degraded - ${open.length} signal${open.length === 1 ? '' : 's'} open`
          : open.length
            ? `Healthy - ${open.length} signal${open.length === 1 ? '' : 's'} open`
            : 'Healthy - no signals open',
        sub: open.length
          ? 'Every source answered. The signals below are what they said.'
          : 'Every source read cleanly and none of them is reporting a problem.',
        stats: [
          { value: fourxxTotal != null ? compact(fourxxTotal) : '-', label: '4xx', tone: fourxxTotal && fourxxTotal > 1000 ? 'bad' : 'plain' },
          {
            value: fivexxTotal != null ? compact(fivexxTotal) : '-',
            label: '5xx',
            tone: fivexxTotal ? 'bad' : 'plain'
          },
          { value: warnTotal != null ? compact(warnTotal) : '-', label: 'warnings', tone: 'dim' }
        ]
      };

  return { signals: open, verdict, badges };
}

/**
 * One row per distinct signal, first occurrence wins so ranking is preserved.
 *
 * Keyed on the stable id rather than the title, because titles interpolate live
 * values and two renderings of the same signal can differ in text while being the
 * same claim. This exists because a copy-pasted block emitted one twice, and
 * because the cost of that bug is not the duplicate row - it is that the count
 * beside it stops matching.
 */
export function dedupeSignals(signals: Signal[]): Signal[] {
  const seen = new Set<string>();
  return signals.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

function demoHealth(demo: Scenario): Health {
  const signals = fx.signals(demo) as Signal[];
  return {
    signals,
    verdict:
      demo === 'incident'
        ? {
            tone: 'bad',
            title: 'Degraded - 3 signals open',
            sub: 'Auth refresh is failing at scale and the platform error metric does not show it.',
            stats: [
              { value: '2.17%', label: '4xx rate', tone: 'bad' },
              { value: '0', label: '5xx', tone: 'plain' },
              { value: '42m', label: 'since onset', tone: 'dim' }
            ]
          }
        : {
            tone: 'ok',
            title: 'Healthy - 1 signal open',
            sub: 'Nothing failing. One source has never been verified, which is not the same as healthy.',
            stats: [
              { value: '0.26%', label: '4xx rate', tone: 'plain' },
              { value: '0', label: '5xx', tone: 'plain' },
              { value: '176k', label: 'requests 24h', tone: 'dim' }
            ]
          },
    badges:
      demo === 'incident'
        ? {
            overview: { text: '3', kind: 'bad' },
            traffic: { text: '4k', kind: 'warn' },
            logs: { text: '1.5k', kind: 'warn' },
            rad: { text: '36%', kind: 'warn' },
            recs: { text: '17%', kind: 'warn' }
          }
        : {}
  };
}

const reasonShort = (reason: string) =>
  reason === 'no_token'
    ? 'No Cloudflare API token on this Worker - RUNBOOK §0.2.'
    : reason === 'bad_token'
      ? 'Cloudflare rejected the token (10000). The wrangler OAuth token does not work against this API.'
      : reason === 'no_backend_token'
        ? 'No Rad.FM JWT supplied, so /admin/* cannot be read.'
        : reason === 'not_found'
          ? 'Backend returned 404 - the admin rate limiter, a role below the route, or migration 0003.'
          : 'The source returned an error.';

/** Null below MIN_SAMPLE: too few events to mean anything, which is not the same as fine. */
function nonOkPct(rows: any[]) {
  const total = rows.reduce((a, r) => a + Number(r.n ?? 0), 0);
  if (total < MIN_SAMPLE) return null;
  const ok = Number(rows.find((r) => String(r.reason) === 'ok')?.n ?? 0);
  return ((total - ok) / total) * 100;
}

function degradedPct(rows: any[]) {
  const sets = rows.reduce((a, r) => a + Number(r.n ?? 0), 0);
  if (sets < MIN_SAMPLE) return null;
  return (rows.reduce((a, r) => a + Number(r.degraded ?? 0), 0) / sets) * 100;
}

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
