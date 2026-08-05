import type { Ctx } from '../App';
import { BG, C, FONT, LINE, dot, num } from '../theme';
import { Icon } from '../icons';
import { KeyRow, SectionHead, Source } from '../components/primitives';
import { statValue, useAdminStats, useAeProbe, useSetlistFill, useVersions } from '../lib/api';
import { useHealth } from '../lib/health';
import * as fx from '../lib/fixtures';

export default function Overview({ ctx }: { ctx: Ctx }) {
  const demo = ctx.demo;
  const stats = useAdminStats(!demo);
  const probe = useAeProbe();
  const versions = useVersions();
  const setlists = useSetlistFill(Math.min(ctx.hours, 72), !demo);

  // Verdict and signals come from the same derivation the nav badges use, so the
  // number on the badge, the number in the verdict and the rows below always
  // agree. Two counts of the same thing that disagree is the failure this whole
  // tool exists to prevent.
  const { signals, verdict } = useHealth(ctx.hours, demo);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/*
        Verdict first, not a KPI row. A row of big numbers fails "answers a
        question in ten seconds", because a number without context answers
        nothing. There is deliberately no "Total Users" hero metric: 631
        registered users is a vanity number that changes nobody's day.
      */}
      <div
        style={{
          borderRadius: 8,
          padding: '18px 20px',
          border: `1px solid ${
            verdict.tone === 'bad' ? 'rgba(255,98,89,0.28)' : verdict.tone === 'warn' ? 'rgba(224,160,48,0.28)' : 'rgba(63,179,166,0.24)'
          }`,
          background:
            verdict.tone === 'bad' ? 'rgba(255,98,89,0.06)' : verdict.tone === 'warn' ? 'rgba(224,160,48,0.06)' : 'rgba(63,179,166,0.05)'
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
          <span style={dot(verdict.tone === 'bad' ? C.bad : verdict.tone === 'warn' ? C.warn : C.ok, true)} />
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            <div
              style={{
                font: `600 17px/1.25 ${FONT.display}`,
                letterSpacing: '-0.018em',
                color: verdict.tone === 'bad' ? C.bad : verdict.tone === 'warn' ? C.warnText : C.ok
              }}
            >
              {verdict.title}
            </div>
            <div style={{ font: `400 12.5px/1.5 ${FONT.text}`, color: 'rgba(255,255,255,0.62)', marginTop: 4 }}>
              {verdict.sub}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
            {verdict.stats.map((v) => (
              <div key={v.label}>
                <div
                  style={{
                    ...num,
                    font: `500 19px/1.1 ${FONT.mono}`,
                    color: v.tone === 'bad' ? C.bad : v.tone === 'dim' ? C.t2 : C.t1
                  }}
                >
                  {v.value}
                </div>
                <div
                  style={{
                    font: `400 10px/1.5 ${FONT.text}`,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'rgba(255,255,255,0.38)',
                    marginTop: 4
                  }}
                >
                  {v.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <section>
        <SectionHead title="Open signals" meta="ranked by blast radius" />
        {signals.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() => ctx.go(s.go)}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '12px 16px',
              alignItems: 'center',
              padding: '14px 0',
              cursor: 'pointer',
              width: '100%',
              textAlign: 'left',
              background: 'transparent',
              border: 'none',
              borderBottom: LINE.row
            }}
          >
            {/* Severity is never colour alone: a dot, a metric colour and the wording all carry it. */}
            <span style={dot(s.sev === 'bad' ? C.bad : s.sev === 'warn' ? C.warn : 'rgba(255,255,255,0.3)', s.sev === 'bad')} />
            <div style={{ minWidth: 0, flex: '1 1 300px' }}>
              <div style={{ font: `500 14px/1.35 ${FONT.text}`, letterSpacing: '-0.008em', color: '#fff' }}>{s.title}</div>
              <div style={{ font: `400 12.5px/1.5 ${FONT.text}`, color: 'rgba(255,255,255,0.55)', marginTop: 3 }}>
                {s.evidence}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 'none' }}>
              <div style={{ textAlign: 'right' }}>
                <div
                  style={{
                    ...num,
                    font: `500 14px/1.2 ${FONT.mono}`,
                    color: s.sev === 'bad' ? C.bad : s.sev === 'warn' ? C.warn : C.t2
                  }}
                >
                  {s.metric}
                </div>
                <div style={{ font: `400 10px/1.5 ${FONT.mono}`, color: 'rgba(255,255,255,0.32)', marginTop: 3 }}>
                  {s.source}
                </div>
              </div>
              <span style={{ color: 'rgba(255,255,255,0.3)', display: 'flex' }}>
                <Icon name="chevron.right" size={11} />
              </span>
            </div>
          </button>
        ))}
      </section>

      <ServiceState
        ctx={ctx}
        statsState={demo ? null : stats}
        probeOk={probe.state === 'ok' && probe.data.rows.length > 0}
        setlists={setlists}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', gap: 20 }}>
        <section>
          <SectionHead title="Scale" meta="D1 · live" />
          {demo ? (
            fx.scaleRows.map((r) => <KeyRow key={r.label} label={r.label} value={r.value} note={r.note} />)
          ) : (
            <Source data={stats} what="D1 counts">
              {(d) => <ScaleRows d={d} />}
            </Source>
          )}
        </section>

        <section>
          <SectionHead title="Deploys" meta="Workers Scripts · last 100" />
          {demo ? (
            <>
              {fx.deploys.map((d) => (
                <DeployRow key={d.id} id={d.id} msg={d.msg} age={d.age} current={d.current} />
              ))}
              <div style={{ paddingTop: 12 }}>
                <RollbackButton allowed={ctx.can.operate} target="7b20e94" />
              </div>
            </>
          ) : (
            <Source data={versions} what="Deploy history">
              {(d) => (
                <>
                  {d.versions.slice(0, 4).map((v: any) => (
                    <DeployRow
                      key={v.id}
                      id={String(v.id ?? '').slice(0, 7)}
                      msg={v.annotations?.['workers/message'] ?? v.metadata?.source ?? '—'}
                      age={relAge(v.metadata?.created_on ?? v.created_on)}
                      current
                    />
                  ))}
                  <div style={{ paddingTop: 12 }}>
                    <RollbackButton allowed={ctx.can.operate} target={String(d.versions?.[1]?.id ?? '').slice(0, 7)} />
                  </div>
                </>
              )}
            </Source>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * Honest labels. `past_plays` stores current state rather than history, so this
 * figure means "users who played a song they had not played before, or replayed
 * one" — calling it DAU would be a lie with a number attached.
 */
function ScaleRows({ d }: { d: any }) {
  const rows: { label: string; value: number | null; note: string }[] = [
    { label: 'Registered users', value: statValue(d.users), note: d.newUsers7d != null ? `+${d.newUsers7d} in 7d` : '' },
    { label: 'Premium', value: statValue(d.premiumUsers), note: d.premiumPct == null ? 'pct unavailable' : `${d.premiumPct}%` },
    { label: 'Users with play activity, 24h', value: statValue(d.activeUsers24h), note: 'not DAU' },
    { label: 'Users with play activity, 7d', value: statValue(d.activeUsers7d), note: 'not WAU' },
    { label: 'Stations', value: statValue(d.stations), note: '100% user-gen' },
    { label: 'Past plays', value: statValue(d.pastPlays), note: 'current state' },
    { label: 'Liked songs', value: statValue(d.likedSongs), note: 'all have ISRC' }
  ];
  return (
    <>
      {rows.map((r) => (
        <KeyRow
          key={r.label}
          label={r.label}
          // -1 is a query-failed sentinel, not a count. It renders as
          // "unavailable" and never as 0.
          value={r.value === null ? 'unavailable' : r.value.toLocaleString()}
          note={r.note}
          color={r.value === null ? C.warnText : C.t1}
        />
      ))}
    </>
  );
}

function DeployRow({ id, msg, age, current }: { id: string; msg: string; age: string; current: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: LINE.row }}>
      <span style={dot(current ? C.ok : 'rgba(255,255,255,0.25)')} />
      <span style={{ font: `400 11.5px/1.2 ${FONT.mono}`, color: 'rgba(255,255,255,0.72)' }}>{id}</span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          font: `400 12.5px/1.4 ${FONT.text}`,
          color: 'rgba(255,255,255,0.55)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {msg}
      </span>
      <span style={{ font: `400 11px/1.2 ${FONT.mono}`, color: 'rgba(255,255,255,0.35)', flex: 'none' }}>{age}</span>
    </div>
  );
}

function RollbackButton({ allowed, target }: { allowed: boolean; target: string }) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      // Two reasons, and the operator is told which applies. Hiding the control
      // would leave them unable to tell a missing feature from a missing permission.
      title={allowed ? 'Phase 4 — writes are not enabled yet' : 'Requires operator'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 34,
        padding: '0 14px',
        borderRadius: 7,
        font: `500 12.5px/1 ${FONT.text}`,
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.07)',
        color: 'rgba(255,255,255,0.28)',
        cursor: 'not-allowed'
      }}
    >
      {allowed ? `Roll back to ${target || '—'}` : 'Roll back — requires operator'}
    </button>
  );
}

function ServiceState({
  ctx,
  statsState,
  probeOk,
  setlists
}: {
  ctx: Ctx;
  statsState: ReturnType<typeof useAdminStats> | null;
  probeOk: boolean;
  setlists: ReturnType<typeof useSetlistFill>;
}) {
  const demo = ctx.demo;
  const missing =
    statsState?.state === 'ok' ? statsState.data.dataQuality?.pastPlaysMissingPlayedAt : undefined;

  const cards = demo
    ? [
        { label: 'Migration 0003', value: 'Applied', detail: 'admin_users seeded, played_at backfilled', tone: 'ok' as const },
        {
          label: 'RevenueCat cron',
          value: demo === 'incident' ? 'Last run failed' : 'Ran 12m ago',
          detail: demo === 'incident' ? '0 */6 * * * · reconcile returned 502' : '0 */6 * * * · 18 rows reconciled',
          tone: demo === 'incident' ? ('bad' as const) : ('ok' as const)
        },
        { label: 'Data quality', value: '0 rows', detail: 'past_plays missing played_at', tone: 'ok' as const },
        { label: 'Analytics Engine', value: 'Unverified', detail: 'never queried · needs scoped token', tone: 'warn' as const },
        {
          label: 'Setlist fill rate',
          value: demo === 'incident' ? '62%' : '75%',
          detail: demo === 'incident' ? 'below the 75% baseline' : 'at baseline · 100-event sample',
          tone: demo === 'incident' ? ('bad' as const) : ('ok' as const)
        }
      ]
    : [
        {
          label: 'Migration 0003',
          value: statsState?.state === 'ok' ? 'Applied' : 'Unknown',
          detail:
            statsState?.state === 'ok'
              ? 'admin_users readable, /admin/* responding'
              : 'every /admin/* route 404s until it runs',
          tone: statsState?.state === 'ok' ? ('ok' as const) : ('warn' as const)
        },
        {
          label: 'RevenueCat cron',
          value: 'Unavailable',
          detail: 'no cron status endpoint yet · worth adding',
          tone: 'warn' as const
        },
        {
          label: 'Data quality',
          value: missing === undefined ? 'Unavailable' : `${missing} rows`,
          detail: 'past_plays missing played_at',
          tone: missing === undefined ? ('warn' as const) : missing === 0 ? ('ok' as const) : ('bad' as const)
        },
        {
          label: 'Analytics Engine',
          value: probeOk ? 'Receiving' : 'Unverified',
          detail: probeOk ? 'probe returned rows' : 'never queried · needs scoped token',
          tone: probeOk ? ('ok' as const) : ('warn' as const)
        },
        {
          // 75% baseline, measured on a live 100-event London listing. Below 70%
          // is the shape of the bug that disabled setlists for a third of gigs.
          label: 'Setlist fill rate',
          value: setlists.state === 'ok' ? `${Math.round(setlists.data.fillRate * 100)}%` : 'Unavailable',
          detail:
            setlists.state === 'ok'
              ? `${setlists.data.filled}/${setlists.data.sampled} gigs enriched`
              : 'needs /admin/metrics/setlists',
          tone:
            setlists.state !== 'ok'
              ? ('warn' as const)
              : setlists.data.fillRate < 0.7
                ? ('bad' as const)
                : ('ok' as const)
        }
      ];

  return (
    <div
      style={{
        display: 'grid',
        // Five standing indicators. Sized so they sit on one row on a laptop
        // rather than leaving a dead cell, which reads as a missing panel.
        gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,228px),1fr))',
        gap: 1,
        background: 'rgba(255,255,255,0.08)',
        border: LINE.edge,
        borderRadius: 8,
        overflow: 'hidden'
      }}
    >
      {cards.map((c) => (
        <div key={c.label} style={{ background: BG.card, padding: '18px 18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={dot(c.tone === 'ok' ? C.ok : c.tone === 'bad' ? C.bad : C.warn)} />
            <span
              style={{
                font: `600 10px/1 ${FONT.text}`,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.5)'
              }}
            >
              {c.label}
            </span>
          </div>
          <div
            style={{
              font: `500 15px/1.3 ${FONT.text}`,
              letterSpacing: '-0.012em',
              color: c.tone === 'ok' ? C.ok : c.tone === 'bad' ? C.bad : C.warnText
            }}
          >
            {c.value}
          </div>
          <div style={{ font: `400 11.5px/1.5 ${FONT.text}`, color: 'rgba(255,255,255,0.45)', marginTop: 5 }}>
            {c.detail}
          </div>
        </div>
      ))}
    </div>
  );
}

function relAge(iso?: string) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '—';
  const h = Math.floor(ms / 3600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m`;
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
