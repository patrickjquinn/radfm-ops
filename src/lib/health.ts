import {
  useAdminStats,
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
 * exists to prevent — a dashboard that contradicts itself teaches an operator to
 * trust none of it.
 */

export type Badge = { text: string; kind: 'bad' | 'warn' | 'plain' };

export type Signal = {
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
export function useHealth(hours: number, demo: Scenario | null): Health {
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

  if (demo) return demoHealth(demo);

  const sources = [
    { s: stats, label: 'D1 counts', go: 'overview' as ViewId },
    { s: four, label: '4xx breakdown', go: 'traffic' as ViewId },
    { s: warn, label: 'Warnings', go: 'logs' as ViewId },
    { s: dj, label: 'DJ outcomes', go: 'rad' as ViewId },
    { s: recs, label: 'Pool health', go: 'recs' as ViewId },
    { s: probe, label: 'Analytics Engine', go: 'rad' as ViewId },
    { s: versions, label: 'Deploy history', go: 'overview' as ViewId },
    { s: setlists, label: 'Setlist fill rate', go: 'logs' as ViewId }
  ];

  const unreadable = sources.filter((x) => x.s.state === 'unavailable');
  const signals: Signal[] = [];

  // One signal per unreadable source, so the count on the badge, the count in the
  // verdict and the number of rows in the list are all the same number.
  for (const u of unreadable) {
    signals.push({
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

  const probeEmpty = probe.state === 'ok' && probe.data.rows.length === 0;
  if (probeEmpty) {
    signals.push({
      title: 'Analytics Engine returned no datapoints',
      evidence:
        'Writes are fire-and-forget, so this is not proof the events did not happen — check the binding is deployed before assuming the code path is cold.',
      metric: 'unverified',
      source: 'day-one check',
      sev: 'info',
      go: 'rad'
    });
  }

  // Real findings from sources that DID answer, ranked above the unreadable ones.
  const fourxxTotal = four.state === 'ok' ? countCalculations(four.data.result) : null;
  const warnTotal = warn.state === 'ok' ? (warn.data.groups ?? []).reduce((a, b) => a + b.count, 0) : null;
  const djPct = dj.state === 'ok' ? nonOkPct(dj.data.rows) : null;
  const recsPct = recs.state === 'ok' ? degradedPct(recs.data.rows) : null;
  const missingPlayedAt = stats.state === 'ok' ? stats.data.dataQuality?.pastPlaysMissingPlayedAt : undefined;

  if (djPct != null && djPct >= 10)
    signals.unshift({
      title: 'DJ degeneracy rising',
      evidence: 'The guard is rejecting more takes. Regressions here are otherwise only detectable by listening to the radio.',
      metric: `${Math.round(djPct)}%`,
      source: 'Analytics Engine',
      sev: 'warn',
      go: 'rad'
    });

  if (recsPct != null && recsPct >= 10)
    signals.unshift({
      title: 'Recommendation fallback rate elevated',
      evidence: 'The orchestrator is degrading gracefully, so nothing throws and nothing alerts.',
      metric: `${Math.round(recsPct)}%`,
      source: 'Analytics Engine',
      sev: 'warn',
      go: 'recs'
    });

  if (missingPlayedAt != null && missingPlayedAt > 0)
    signals.unshift({
      title: 'past_plays rows missing played_at',
      evidence: 'The insert has regressed. The recommender’s "recently played" exclusion becomes arbitrary as this climbs.',
      metric: missingPlayedAt.toLocaleString(),
      source: 'D1',
      sev: 'bad',
      go: 'overview'
    });

  // Baseline is 75%, measured on a live 100-event London listing. It sat around
  // 65% while looking healthy, because the failures logged as warnings and
  // warnings are not errors — this is the check that would have caught it.
  const fillRate = setlists.state === 'ok' ? setlists.data.fillRate : null;
  if (fillRate != null && fillRate < 0.7)
    signals.unshift({
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
      title: 'Elevated 4xx',
      evidence: 'The platform’s headline Errors metric excludes 4xx entirely, so this does not appear there.',
      metric: fourxxTotal.toLocaleString(),
      source: 'Observability',
      sev: 'bad',
      go: 'traffic'
    });

  const badges: Partial<Record<ViewId, Badge>> = {};
  if (signals.length)
    badges.overview = {
      text: String(signals.length),
      kind: signals.some((s) => s.sev === 'bad') ? 'bad' : 'warn'
    };
  if (fourxxTotal) badges.traffic = { text: compact(fourxxTotal), kind: fourxxTotal > 1000 ? 'warn' : 'plain' };
  if (warnTotal) badges.logs = { text: compact(warnTotal), kind: warnTotal > 500 ? 'warn' : 'plain' };
  if (djPct != null && djPct >= 10) badges.rad = { text: `${Math.round(djPct)}%`, kind: 'warn' };
  if (recsPct != null && recsPct >= 10) badges.recs = { text: `${Math.round(recsPct)}%`, kind: 'warn' };

  const bad = signals.filter((s) => s.sev === 'bad').length;
  const verdict: Verdict = unreadable.length
    ? {
        // Never "Healthy" on the strength of sources we could not reach. That is a
        // different claim, and only one of them is supported by the data.
        tone: bad ? 'bad' : 'warn',
        title: `Unverified — ${unreadable.length} source${unreadable.length === 1 ? '' : 's'} could not be read`,
        sub: 'This is not a claim that anything is healthy. Nothing below has been confirmed against the live system.',
        stats: [
          { value: fourxxTotal != null ? compact(fourxxTotal) : '—', label: '4xx', tone: 'dim' },
          { value: '—', label: '5xx', tone: 'dim' },
          { value: String(unreadable.length), label: 'sources down', tone: 'bad' }
        ]
      }
    : {
        tone: bad ? 'bad' : signals.length ? 'warn' : 'ok',
        title: bad
          ? `Degraded — ${signals.length} signal${signals.length === 1 ? '' : 's'} open`
          : signals.length
            ? `Healthy — ${signals.length} signal${signals.length === 1 ? '' : 's'} open`
            : 'Healthy — no signals open',
        sub: signals.length
          ? 'Every source answered. The signals below are what they said.'
          : 'Every source read cleanly and none of them is reporting a problem.',
        stats: [
          { value: fourxxTotal != null ? compact(fourxxTotal) : '—', label: '4xx', tone: fourxxTotal && fourxxTotal > 1000 ? 'bad' : 'plain' },
          { value: '0', label: '5xx', tone: 'plain' },
          { value: warnTotal != null ? compact(warnTotal) : '—', label: 'warnings', tone: 'dim' }
        ]
      };

  return { signals, verdict, badges };
}

function demoHealth(demo: Scenario): Health {
  const signals = fx.signals(demo) as Signal[];
  return {
    signals,
    verdict:
      demo === 'incident'
        ? {
            tone: 'bad',
            title: 'Degraded — 3 signals open',
            sub: 'Auth refresh is failing at scale and the platform error metric does not show it.',
            stats: [
              { value: '2.17%', label: '4xx rate', tone: 'bad' },
              { value: '0', label: '5xx', tone: 'plain' },
              { value: '42m', label: 'since onset', tone: 'dim' }
            ]
          }
        : {
            tone: 'ok',
            title: 'Healthy — 1 signal open',
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
            rad: { text: '18%', kind: 'warn' },
            recs: { text: '17%', kind: 'warn' }
          }
        : {}
  };
}

const reasonShort = (reason: string) =>
  reason === 'no_token'
    ? 'No Cloudflare API token on this Worker — RUNBOOK §0.2.'
    : reason === 'bad_token'
      ? 'Cloudflare rejected the token (10000). The wrangler OAuth token does not work against this API.'
      : reason === 'no_backend_token'
        ? 'No Rad.FM JWT supplied, so /admin/* cannot be read.'
        : reason === 'not_found'
          ? 'Backend returned 404 — unauthorised, or migration 0003 has not been applied.'
          : 'The source returned an error.';

function countCalculations(result: any) {
  const groups = result?.calculations?.[0]?.aggregates ?? result?.calculations?.[0]?.groups ?? [];
  return groups.reduce((a: number, g: any) => a + Number(g.value ?? g.count ?? 0), 0);
}

function nonOkPct(rows: any[]) {
  const total = rows.reduce((a, r) => a + Number(r.n ?? 0), 0);
  if (!total) return null;
  const ok = Number(rows.find((r) => String(r.reason) === 'ok')?.n ?? 0);
  return ((total - ok) / total) * 100;
}

function degradedPct(rows: any[]) {
  const sets = rows.reduce((a, r) => a + Number(r.n ?? 0), 0);
  if (!sets) return null;
  return (rows.reduce((a, r) => a + Number(r.degraded ?? 0), 0) / sets) * 100;
}

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
