import type { Ctx } from '../App';
import { BG, C, ELEV, FONT, LINE, MOTION, dot, num } from '../theme';
import { Icon } from '../icons';
import { Generated, KeyRow, SectionHead, Source } from '../components/primitives';
import {
  reasonText,
  statValue,
  useAdminStats,
  useAeProbe,
  useCron,
  useNarrative,
  useSetlistFill,
  useVersions
} from '../lib/api';
import { useHealth, type Signal } from '../lib/health';
import { STATE } from '../lib/vocabulary';
import * as fx from '../lib/fixtures';

export default function Overview({ ctx }: { ctx: Ctx }) {
  const demo = ctx.demo;
  const stats = useAdminStats(!demo);
  const probe = useAeProbe();
  const versions = useVersions();
  const setlists = useSetlistFill(Math.min(ctx.hours, 72), !demo);
  const cron = useCron(!demo);

  // Verdict and signals come from the same derivation the nav badges use, so the
  // number on the badge, the number in the verdict and the rows below always
  // agree. Two counts of the same thing that disagree is the failure this whole
  // tool exists to prevent.
  const { signals, verdict, domains, attention } = useHealth(ctx.hours, demo, ctx.ownerTokenExpiresInDays);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/*
        The hero, in the tvOS sense: one surface carrying the single most
        important thing, with everything else deferring to it.

        The verdict and the three domain numbers used to be two stacked panels of
        identical treatment - same border, same fill, same weight - so the answer
        and its supporting detail competed. Apple TV builds hierarchy with layers
        rather than borders: the thing that matters lifts, the rest recedes. One
        raised surface, the verdict at the top of it, the domains reading as its
        evidence rather than as a second panel.
      */}
      <div
        style={{
          ...ELEV.raised,
          borderRadius: 14,
          overflow: 'hidden',
          borderColor:
            verdict.tone === 'bad' ? 'rgba(255,98,89,0.3)' : verdict.tone === 'warn' ? 'rgba(224,160,48,0.3)' : 'rgba(63,179,166,0.22)'
        }}
      >
        <div
          style={{
            padding: 'clamp(22px,3vw,32px)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
            gap: 24,
            // A wash of the verdict colour rather than a filled card. The colour
            // still carries the state; it just stops shouting it.
            background:
              verdict.tone === 'bad'
                ? 'radial-gradient(120% 140% at 0% 0%, rgba(255,98,89,0.10) 0%, transparent 60%)'
                : verdict.tone === 'warn'
                  ? 'radial-gradient(120% 140% at 0% 0%, rgba(224,160,48,0.10) 0%, transparent 60%)'
                  : 'radial-gradient(120% 140% at 0% 0%, rgba(63,179,166,0.09) 0%, transparent 60%)'
          }}
        >
          <div style={{ minWidth: 0, flex: '1 1 340px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <span style={dot(verdict.tone === 'bad' ? C.bad : verdict.tone === 'warn' ? C.warn : C.ok, true)} />
              <span
                style={{
                  font: `600 9.5px/1 ${FONT.text}`,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: C.t3
                }}
              >
                {ctx.range} · live
              </span>
            </div>
            <h2
              style={{
                margin: 0,
                font: `600 clamp(30px,4vw,44px)/1.02 ${FONT.display}`,
                letterSpacing: '-0.033em',
                color: verdict.tone === 'bad' ? C.bad : verdict.tone === 'warn' ? C.warnText : C.ok
              }}
            >
              {verdict.title}
            </h2>
            <p style={{ font: `400 14.5px/1.55 ${FONT.text}`, color: C.t2, margin: '12px 0 0', maxWidth: '58ch' }}>
              {verdict.sub}
            </p>
          </div>
        </div>

        {/* The evidence, inside the same surface. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,230px),1fr))',
            gap: 1,
            background: 'rgba(255,255,255,0.07)',
            borderTop: '1px solid rgba(255,255,255,0.07)'
          }}
        >
          {domains.map((d) => (
            <button
              key={d.domain}
              type="button"
              onClick={() => ctx.go(d.go)}
              // tvOS focus: the thing under the cursor lifts toward you. Cheap,
              // and it turns a wall of equal boxes into something navigable.
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.045)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = BG.card;
              }}
              style={{
                background: BG.card,
                padding: '18px 20px 20px',
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 9,
                transition: `background ${MOTION}`
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={dot(d.tone === 'bad' ? C.bad : d.tone === 'warn' ? C.warn : d.tone === 'dim' ? C.t3 : C.ok)} />
                <span
                  style={{
                    font: `600 9.5px/1 ${FONT.text}`,
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    color: C.t3
                  }}
                >
                  {d.domain}
                </span>
              </span>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
                <span
                  style={{
                    ...num,
                    font: `500 clamp(26px,2.6vw,32px)/1 ${FONT.mono}`,
                    letterSpacing: '-0.025em',
                    color: d.tone === 'bad' ? C.bad : d.tone === 'dim' ? C.t3 : C.t1
                  }}
                >
                  {d.value}
                </span>
                <span style={{ font: `400 12px/1.4 ${FONT.text}`, color: C.t3 }}>{d.label}</span>
              </span>
              <span style={{ font: `400 12px/1.5 ${FONT.text}`, color: C.t2 }}>{d.detail}</span>
            </button>
          ))}
        </div>
      </div>

      {/*
        What to do when nothing is wrong.
        
        The page previously said "Healthy - no signals open" and then offered
        five static cards and two tables: nothing to act on, nothing changed, no
        reason to have opened it. These are deliberately NOT signals and carry no
        severity colour - they are things worth knowing that are working as
        designed. A page that is only useful during an incident is unfamiliar
        during one.
      */}
      {attention.length > 0 && (
        <section>
          <SectionHead title="Worth a look" meta="not faults" />
          {attention.map((a) => (
            <button
              key={a.title}
              type="button"
              onClick={() => ctx.go(a.go)}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                width: '100%',
                textAlign: 'left',
                padding: '13px 10px 13px 2px',
                border: 'none',
                borderBottom: LINE.row,
                background: 'transparent',
                cursor: 'pointer',
                transition: `background ${MOTION}`
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: `500 13.5px/1.4 ${FONT.text}`, color: '#fff' }}>{a.title}</div>
                <div style={{ font: `400 12.5px/1.5 ${FONT.text}`, color: C.t3, marginTop: 3 }}>{a.detail}</div>
              </div>
              <span style={{ color: C.t3, display: 'flex', flex: 'none' }}>
                <Icon name="chevron.right" size={11} />
              </span>
            </button>
          ))}
        </section>
      )}

      {!demo && signals.length >= 2 && (
        <Narrative signals={signals} verdict={verdict.title} hours={ctx.hours} />
      )}

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
                <div style={{ font: `400 10px/1.5 ${FONT.mono}`, color: C.t3, marginTop: 3 }}>
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
        cron={cron}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', gap: 20 }}>
        <section>
          <SectionHead title="Scale" meta="D1 · current state" />
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
                      msg={v.annotations?.['workers/message'] ?? v.metadata?.source ?? '-'}
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
 * one" - calling it DAU would be a lie with a number attached.
 */
function ScaleRows({ d }: { d: any }) {
  const rows: { label: string; value: number | null; note: string }[] = [
    { label: 'Registered users', value: statValue(d.users), note: d.newUsers7d != null ? `+${d.newUsers7d} in 7d` : '' },
    { label: 'Premium', value: statValue(d.premium), note: d.premiumPct == null ? 'pct unavailable' : `${d.premiumPct}%` },
    { label: 'Users with play activity, 24h', value: statValue(d.activeUsers24h), note: 'not DAU' },
    { label: 'Users with play activity, 7d', value: statValue(d.activeUsers7d), note: 'not WAU' },
    { label: 'Stations', value: statValue(d.stations), note: '100% user-gen' },
    { label: 'Past plays', value: statValue(d.plays), note: 'current state' },
    { label: 'Liked songs', value: statValue(d.liked), note: 'all have ISRC' }
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
      title={allowed ? 'Phase 4 - writes are not enabled yet' : 'Requires operator'}
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
      {allowed ? `Roll back to ${target || '-'}` : 'Roll back - requires operator'}
    </button>
  );
}

function ServiceState({
  ctx,
  statsState,
  probeOk,
  setlists,
  cron
}: {
  ctx: Ctx;
  statsState: ReturnType<typeof useAdminStats> | null;
  probeOk: boolean;
  setlists: ReturnType<typeof useSetlistFill>;
  cron: ReturnType<typeof useCron>;
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
        { label: 'Analytics Engine', value: STATE.unverified, detail: 'never queried · needs scoped token', tone: 'warn' as const },
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
          value: statsState?.state === 'ok' ? 'Applied' : STATE.unavailable,
          detail:
            statsState?.state === 'ok'
              ? 'admin_users readable, /admin/* responding'
              : 'every /admin/* route 404s until it runs',
          tone: statsState?.state === 'ok' ? ('ok' as const) : ('warn' as const)
        },
        cronCard(cron),
        {
          label: 'Data quality',
          value: missing === undefined ? STATE.unavailable : `${missing} rows`,
          detail: 'past_plays missing played_at',
          tone: missing === undefined ? ('warn' as const) : missing === 0 ? ('ok' as const) : ('bad' as const)
        },
        {
          label: 'Analytics Engine',
          value: probeOk ? 'Receiving' : STATE.unverified,
          detail: probeOk ? 'probe returned rows' : 'never queried · needs scoped token',
          tone: probeOk ? ('ok' as const) : ('warn' as const)
        },
        setlistCard(setlists)
      ];

  return (
    <div
      style={{
        display: 'grid',
        // Five standing indicators. Sized so they sit on one row on a laptop
        // rather than leaving a dead cell, which reads as a missing panel.
        gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,228px),1fr))',
        gap: 1,
        // The hairline that shows through as the 1px grid gaps, so it must win
        // over ELEV's fill - hence border and shadow only.
        background: 'rgba(255,255,255,0.07)',
        border: ELEV.raised.border,
        boxShadow: ELEV.raised.boxShadow,
        borderRadius: 12,
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

/**
 * The cron card.
 *
 * `lastRunAt: null` is NOT healthy - the backend documents it as "never observed",
 * and this cron is the only server-initiated revocation path. It has been silently
 * misconfigured before, so rendering null as anything reassuring would recreate
 * exactly the failure this card exists to catch.
 */
function cronCard(cron: ReturnType<typeof useCron>) {
  if (cron.state !== 'ok')
    return { label: 'RevenueCat cron', value: STATE.unavailable, detail: 'could not read status', tone: 'warn' as const };

  const { lastRunAt, outcome, rowsReconciled, schedule } = cron.data;
  const cadence = schedule ?? '0 */6 * * *';
  if (!lastRunAt)
    return {
      label: 'RevenueCat cron',
      value: 'Never observed',
      detail: `${cadence} \u00b7 the only revocation path`,
      tone: 'bad' as const
    };

  const ageH = (Date.now() - new Date(`${lastRunAt.replace(' ', 'T')}Z`).getTime()) / 3_600_000;
  // Six-hourly. Two missed runs is a fault, not a blip.
  const overdue = !Number.isFinite(ageH) || ageH > 12;
  const failed = outcome !== undefined && outcome !== 'ok';
  return {
    label: 'RevenueCat cron',
    value: failed ? `Last run ${outcome}` : overdue ? 'Overdue' : `Ran ${Math.max(0, Math.round(ageH))}h ago`,
    detail: `${cadence} \u00b7 ${rowsReconciled ?? '\u2014'} rows reconciled`,
    tone: failed || overdue ? ('bad' as const) : ('ok' as const)
  };
}

/**
 * The setlist card.
 *
 * A 0/0 sample is NOT a 0% fill rate. It rendered as "0%" in red - a false zero
 * dressed as an outage, which is the same lie as a false "unavailable" and exactly
 * what this dashboard is meant to refuse to do. No gigs in the window means there
 * is nothing to report, so it says that.
 */
function setlistCard(setlists: ReturnType<typeof useSetlistFill>) {
  if (setlists.state !== 'ok')
    return {
      label: 'Setlist fill rate',
      value: STATE.unavailable,
      detail: 'could not read /admin/metrics/setlists',
      tone: 'warn' as const
    };

  const { fillRate, filled, sampled } = setlists.data;
  if (!sampled)
    return {
      label: 'Setlist fill rate',
      value: 'No sample',
      detail: 'no gigs in this window \u2014 not a 0% fill rate',
      tone: 'dim' as const
    };

  // 75% baseline, measured on a live 100-event London listing. Below 70% is the
  // shape of the bug that disabled setlists for a third of gigs.
  return {
    label: 'Setlist fill rate',
    value: `${Math.round(fillRate * 100)}%`,
    detail: `${filled}/${sampled} gigs enriched`,
    tone: fillRate < 0.7 ? ('bad' as const) : ('ok' as const)
  };
}

function relAge(iso?: string) {
  if (!iso) return '-';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '-';
  const h = Math.floor(ms / 3600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m`;
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * The generated narrative.
 *
 * It receives signals health.ts has ALREADY computed and writes prose about them.
 * It is never handed raw data to aggregate, because a subtly wrong number inside
 * fluent prose is far harder to catch than an obviously wrong one - and this is
 * the tool that exists because a wrong number looked fine.
 *
 * Three properties make it safe to put at the top of the page:
 *
 *   1. It sits BELOW the verdict, which is deterministic. If the prose and the
 *      verdict ever disagree, the verdict is the one that is measured.
 *   2. Citations are filtered Worker-side against the ids we sent, so a
 *      fabricated source cannot render. What you see cited, we supplied.
 *   3. It degrades like any other source. When inference is down the panel says
 *      so and states plainly that nothing measured is affected - because nothing
 *      on this page depends on it for a number.
 */
function Narrative({ signals, verdict, hours }: { signals: Signal[]; verdict: string; hours: number }) {
  const n = useNarrative(
    signals.map((s) => ({
      id: s.id,
      title: s.title,
      evidence: s.evidence,
      metric: s.metric,
      source: s.source,
      sev: s.sev
    })),
    verdict,
    hours,
    true
  );

  if (n.state === 'loading')
    return (
      <Generated model="…" meta="reading">
        <div style={{ font: `400 13px/1.55 ${FONT.text}`, color: C.t3 }}>Generating…</div>
      </Generated>
    );

  if (n.state === 'unavailable')
    return (
      <Generated model="-">
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
          <span style={{ color: C.warnText, display: 'flex', flex: 'none' }}>
            <Icon name="exclamationmark.triangle" size={13} />
          </span>
          <span
            style={{
              font: `600 10px/1 ${FONT.text}`,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: C.warnText
            }}
          >
            Narrative unavailable
          </span>
        </div>
        <div style={{ font: `400 13px/1.55 ${FONT.text}`, color: C.t2, maxWidth: '76ch' }}>
          {reasonText(n.reason, n.detail)} The signals below are unaffected - they are measured, not generated.
          Nothing is missing from this page except the prose.
        </div>
      </Generated>
    );

  const d = n.data;
  return (
    <Generated
      model={d.model}
      meta={`${(d.ms / 1000).toFixed(1)}s${d.neurons != null ? ` · ${d.neurons} neurons` : ''}`}
    >
      <p style={{ font: `400 15px/1.6 ${FONT.text}`, color: '#fff', margin: 0, maxWidth: '76ch' }}>{d.narrative}</p>
      {d.citations.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          {d.citations.map((c) => (
            <span
              key={c}
              style={{
                padding: '4px 9px',
                borderRadius: 4,
                background: 'rgba(255,255,255,0.05)',
                border: LINE.edge,
                font: `400 10.5px/1.4 ${FONT.mono}`,
                color: C.t3
              }}
            >
              {c}
            </span>
          ))}
        </div>
      )}
      <div style={{ font: `400 11.5px/1.55 ${FONT.text}`, color: C.t3, marginTop: 14, maxWidth: '76ch' }}>
        Narration only. Every figure above is rendered from the signal it cites, not produced by the model - see the
        panels below for the measured values.
      </div>
    </Generated>
  );
}
