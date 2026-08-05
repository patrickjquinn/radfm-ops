import type { Ctx } from '../App';
import { C, FONT, LINE, num } from '../theme';
import { Bar, Callout, SectionHead, Source, StatGrid } from '../components/primitives';
import { useStatus4xx, useTraffic } from '../lib/api';
import * as fx from '../lib/fixtures';

export default function Traffic({ ctx }: { ctx: Ctx }) {
  const demo = ctx.demo;
  const four = useStatus4xx(Math.min(ctx.hours, 72));
  const traffic = useTraffic(ctx.hours);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/*
        The single most important statement in the tool, and the reason 4xx leads
        this page rather than sitting in a tab.
      */}
      <Callout tone="teal" icon>
        Cloudflare's headline <strong style={{ fontWeight: 500, color: '#fff' }}>Errors</strong> counts only 5xx and
        uncaught exceptions. A total auth outage on this service once displayed as{' '}
        <strong style={{ fontWeight: 500, color: '#fff' }}>0 Errors</strong> while every user was locked out. 4xx leads
        this page for that reason.
      </Callout>

      {demo ? (
        <StatGrid items={fx.redStats(demo)} />
      ) : (
        <Source data={traffic} what="Request metrics">
          {(d) => <StatGrid items={summarise(d.series)} />}
        </Source>
      )}

      <section>
        <SectionHead title="4xx by route and status" meta="Observability · 3d retention" />
        {demo ? (
          <FourxxRows rows={fx.fourxx(demo)} />
        ) : (
          <Source data={four} what="4xx breakdown">
            {(d) => {
              const rows = fromCalculations(d.result);
              if (!rows.length)
                return (
                  <div style={{ padding: '22px 0', font: `400 12.5px/1.5 ${FONT.text}`, color: 'rgba(255,255,255,0.5)' }}>
                    No 4xx in this window.
                  </div>
                );
              return <FourxxRows rows={rows} />;
            }}
          </Source>
        )}
      </section>

      <section>
        <SectionHead title="Request volume" meta="GraphQL · workersInvocationsAdaptive" />
        {demo ? (
          <Volume bars={fx.volume(demo)} start={ctx.range === '6h' ? '03:48' : 'yesterday 09:48'} />
        ) : (
          <Source data={traffic} what="Request volume">
            {(d) => <Volume bars={toBars(d.series)} start={`${ctx.range} ago`} />}
          </Source>
        )}
      </section>
    </div>
  );
}

function FourxxRows({
  rows
}: {
  rows: { route: string; status: string; count: number; share: string; bad?: boolean }[];
}) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <>
      {rows.map((r) => (
        <div key={`${r.route}-${r.status}`} style={{ padding: '11px 0', borderBottom: LINE.row }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 7 }}>
            <span
              style={{
                flex: 'none',
                padding: '2px 7px',
                borderRadius: 4,
                font: `500 11px/1.5 ${FONT.mono}`,
                background: r.bad ? 'rgba(255,98,89,0.14)' : 'rgba(255,255,255,0.07)',
                color: r.bad ? C.bad : 'rgba(255,255,255,0.6)'
              }}
            >
              {r.status}
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                font: `400 13px/1.4 ${FONT.mono}`,
                color: 'rgba(255,255,255,0.82)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {r.route}
            </span>
            <span style={{ ...num, font: `500 13px/1.2 ${FONT.mono}`, color: r.bad ? C.bad : C.t1 }}>
              {r.count.toLocaleString()}
            </span>
            <span
              style={{
                width: 52,
                textAlign: 'right',
                font: `400 11.5px/1.2 ${FONT.mono}`,
                color: 'rgba(255,255,255,0.38)'
              }}
            >
              {r.share}
            </span>
          </div>
          <Bar pct={(r.count / max) * 100} color={r.bad ? C.bad : C.warn} />
        </div>
      ))}
    </>
  );
}

function Volume({ bars, start }: { bars: { ok: number; err: number; hot?: boolean }[]; start: string }) {
  const max = Math.max(...bars.map((b) => b.ok + b.err), 1);
  return (
    <>
      <div style={{ padding: '20px 0 8px', display: 'flex', alignItems: 'flex-end', gap: 3, height: 132 }}>
        {bars.map((b, i) => (
          <div
            key={i}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 1, height: '100%', minWidth: 0 }}
          >
            <div
              style={{
                height: `${(b.err / max) * 100}%`,
                background: b.hot ? C.warn : 'rgba(224,160,48,0.5)',
                borderRadius: '2px 2px 0 0'
              }}
            />
            <div style={{ height: `${(b.ok / max) * 100}%`, background: C.okDim, borderRadius: '0 0 2px 2px' }} />
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          font: `400 10.5px/1 ${FONT.mono}`,
          color: 'rgba(255,255,255,0.32)',
          paddingTop: 6,
          borderTop: LINE.row
        }}
      >
        <span>{start}</span>
        <span>now</span>
      </div>
      {/* Colour is paired with a label, always. Never colour alone. */}
      <div style={{ display: 'flex', gap: 18, paddingTop: 12 }}>
        <Legend color={C.okDim} label="2xx / 3xx" />
        <Legend color={C.warn} label="4xx" />
      </div>
    </>
  );
}

const Legend = ({ color, label }: { color: string; label: string }) => (
  <span
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 7,
      font: `400 11.5px/1 ${FONT.text}`,
      color: 'rgba(255,255,255,0.5)'
    }}
  >
    <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'block' }} />
    {label}
  </span>
);

/* ── shaping the live responses ────────────────────────────────────────────── */

function fromCalculations(result: any) {
  const groups = result?.calculations?.[0]?.aggregates ?? result?.calculations?.[0]?.groups ?? [];
  const rows = groups.map((g: any) => {
    const dims: string[] = g.groups?.map((x: any) => String(x.value)) ?? [String(g.group ?? '')];
    const status = dims.find((d) => /^\d{3}$/.test(d)) ?? '4xx';
    const route = dims.find((d) => d.startsWith('/')) ?? dims[0] ?? '—';
    return { route, status, count: Number(g.value ?? g.count ?? 0), bad: status === '401' || status === '429' };
  });
  const total = rows.reduce((a: number, b: any) => a + b.count, 0) || 1;
  return rows
    .sort((a: any, b: any) => b.count - a.count)
    .slice(0, 12)
    .map((r: any) => ({ ...r, share: `${((r.count / total) * 100).toFixed(1)}%` }));
}

function summarise(series: any[]) {
  let requests = 0;
  let fourxx = 0;
  let fivexx = 0;
  let cpu = 0;
  let wall = 0;
  for (const s of series) {
    const n = Number(s.sum?.requests ?? 0);
    requests += n;
    const status = Number(s.dimensions?.status ?? 0);
    if (status >= 400 && status < 500) fourxx += n;
    if (status >= 500) fivexx += n;
    cpu = Math.max(cpu, Number(s.quantiles?.cpuTimeP99 ?? 0));
    wall = Math.max(wall, Number(s.quantiles?.wallTimeP99 ?? 0));
  }
  const pct = requests ? ((fourxx / requests) * 100).toFixed(2) : '0.00';
  return [
    { label: 'Requests', value: compact(requests), context: 'in window', tone: 'plain' as const },
    {
      label: '4xx',
      value: fourxx.toLocaleString(),
      context: `${pct}% of requests`,
      tone: Number(pct) > 1 ? ('bad' as const) : ('plain' as const)
    },
    {
      label: '5xx',
      value: fivexx.toLocaleString(),
      context: 'this is why 4xx leads',
      tone: fivexx > 0 ? ('bad' as const) : ('plain' as const)
    },
    { label: 'CPU p99', value: `${Math.round(cpu)}ms`, context: 'worst hour in window', tone: 'plain' as const },
    { label: 'Wall p99', value: `${Math.round(wall)}ms`, context: 'worst hour in window', tone: 'plain' as const }
  ];
}

function toBars(series: any[]) {
  const byHour = new Map<string, { ok: number; err: number }>();
  for (const s of series) {
    const h = String(s.dimensions?.datetimeHour ?? '');
    const n = Number(s.sum?.requests ?? 0);
    const status = Number(s.dimensions?.status ?? 0);
    const hit = byHour.get(h) ?? { ok: 0, err: 0 };
    if (status >= 400) hit.err += n;
    else hit.ok += n;
    byHour.set(h, hit);
  }
  return [...byHour.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
}

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n));
