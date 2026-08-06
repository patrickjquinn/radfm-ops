import type { Ctx } from '../App';
import { C, FONT, LINE, num, GAP } from '../theme';
import { Bar, Callout, Prose, SectionHead, Source, StatGrid, Panel } from '../components/primitives';
import { useActivation, useGrowth, useRevenue } from '../lib/api';
import { STATE } from '../lib/vocabulary';

/**
 * Is the business growing, and is anyone paying.
 *
 * Three sources, deliberately not blended into one line:
 *
 *   signups      D1 users.created_at, complete back to Sept 2025
 *   activation   the append-only play log, because D1 CANNOT answer it
 *   revenue      RevenueCat, scoped to the local premium set
 *
 * The activation split matters. The backend refused to serve `firstPlays` and
 * was right to: `past_plays` is delete-then-inserted on replay, so MIN(created_at)
 * per user is the oldest SURVIVING row and moves every time someone replays a
 * track. It would have drawn a clean activation curve made of fiction. This
 * computes it from the play log instead, which is append-only and cannot move.
 */
export default function Growth({ ctx }: { ctx: Ctx }) {
  const days = Math.round(ctx.hours / 24);
  const growth = useGrowth(days, !ctx.demo);
  const activation = useActivation(Math.min(days, 90), !ctx.demo);
  const revenue = useRevenue(!ctx.demo);

  return (
    <div style={{ display: 'grid', gap: GAP }}>
      <Source data={growth} what="Growth">
        {(g) => {
          const signups = g.days.reduce((a, d) => a + (d.signups ?? 0), 0);
          const perWeek = g.days.length ? (signups / g.days.length) * 7 : 0;
          const act = activation.state === 'ok' ? activation.data.byDay.reduce((a, d) => a + d.activated, 0) : null;

          return (
            <>
              <StatGrid
                min={190}
                items={[
                  {
                    label: 'Signups',
                    value: signups.toLocaleString(),
                    context: `in ${g.days.length} days · ${perWeek.toFixed(1)}/week`,
                    tone: 'plain'
                  },
                  {
                    label: 'Activated',
                    value: act != null ? act.toLocaleString() : 'unavailable',
                    // Not a conversion rate. The two numbers cover different
                    // windows - signups reach back to 2025, the play log to 5 Aug -
                    // so dividing them would produce a ratio of two unrelated
                    // periods and read as an activation percentage.
                    context: act != null ? 'first play in the play-log window' : 'play log unreadable',
                    tone: act != null ? 'plain' : 'warn'
                  },
                  {
                    label: 'Subscriptions',
                    value:
                      revenue.state === 'ok' ? String(revenue.data.activeSubscriptions ?? 'unavailable') : 'unavailable',
                    context:
                      revenue.state === 'ok'
                        ? (revenue.data.byProduct ?? []).map((p) => `${p.count} ${p.productId.replace('rad_plus_', '')}`).join(' · ')
                        : 'RevenueCat unreachable',
                    tone: revenue.state === 'ok' ? 'plain' : 'warn'
                  },
                  {
                    // The only forward-looking number in the entire product.
                    // Everything else here is what already happened.
                    label: 'Expiring in 7d',
                    value: revenue.state === 'ok' ? String(revenue.data.expiringWithin7d ?? 'unavailable') : 'unavailable',
                    context: 'renew or lapse this week',
                    tone:
                      revenue.state === 'ok' && (revenue.data.expiringWithin7d ?? 0) > 0 ? 'warn' : 'plain'
                  }
                ]}
              />

              <Panel title="Signups by day" meta={`users.created_at · since ${g.since.signups.slice(0, 10)}`}>
                <DayRows rows={g.days} />
                {/*
                  Two transitions columns exist and are null for every historical
                  row. That is migration 0004 landing today, and the backend chose
                  null over 0 deliberately - defaulting would have invented 2,941
                  revocations that never happened. Saying which is the difference
                  between "nothing changed" and "we were not recording".
                */}
                <div style={{ paddingTop: 12 }}>
                  <Prose>
                    Premium starts and ends are recorded from{' '}
                    <strong style={{ fontWeight: 500, color: C.warnText }}>
                      {g.since.premiumTransitions.slice(0, 16)}
                    </strong>{' '}
                    onward and read null before it. Null, not zero: <code style={{ font: `400 12px/1 ${FONT.mono}`, color: 'rgba(255,255,255,0.7)' }}>premium_audit</code>{' '}
                    recorded that the system looked, never what it decided, so the earlier transitions are
                    unrecoverable rather than absent. Defaulting them to 0 would have invented thousands of
                    revocations that never happened.
                  </Prose>
                </div>
              </Panel>

              <Panel title="Activation" meta="rad_fm_events · play log">
                {activation.state === 'ok' && activation.data.byDay.length ? (
                  <>
                    <ActRows rows={activation.data.byDay} />
                    <div style={{ paddingTop: 12 }}>
                      <Prose>
                        First play <em>within this window</em>, not first ever. The play log starts 5 Aug and cannot be
                        backfilled, so everyone who was already listening before it appears as activating on their
                        first play after it.{' '}
                        <strong style={{ fontWeight: 500, color: C.warnText }}>
                          This is not a signup-to-activation rate
                        </strong>{' '}
                        - signups reach back to {g.since.signups.slice(0, 10)} and the play log does not, so dividing
                        one by the other would compare two unrelated periods.
                      </Prose>
                    </div>
                  </>
                ) : (
                  <Empty text="Play log unreadable for this window." />
                )}
              </Panel>

              <Source data={revenue} what="Revenue">
                {(r) => (
                  <Panel title="Subscriptions" meta={`RevenueCat · checked ${r.checkedAt?.slice(11, 16) ?? '-'}`}>
                    {(r.byProduct ?? []).map((p) => (
                      <div
                        key={p.productId}
                        style={{ display: 'flex', gap: 14, padding: '11px 0', borderBottom: LINE.row, alignItems: 'baseline' }}
                      >
                        <span style={{ flex: 1, minWidth: 0, font: `400 12.5px/1.4 ${FONT.mono}`, color: 'rgba(255,255,255,0.85)' }}>
                          {p.productId}
                        </span>
                        <span style={{ ...num, font: `500 13px/1.2 ${FONT.mono}`, color: C.t1 }}>{p.count}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 14, padding: '11px 0', borderBottom: LINE.row, alignItems: 'baseline' }}>
                      <span style={{ flex: 1, font: `400 12.5px/1.4 ${FONT.text}`, color: C.t2 }}>
                        Local says premium, RevenueCat says lapsed
                      </span>
                      <span
                        style={{
                          ...num,
                          font: `500 13px/1.2 ${FONT.mono}`,
                          color: (r.expiredNotReconciled ?? 0) > 0 ? C.bad : C.t1
                        }}
                      >
                        {r.expiredNotReconciled ?? 'unavailable'}
                      </span>
                    </div>
                    <div style={{ paddingTop: 12 }}>
                      <Prose>
                        {r.note ?? 'Scoped to the local premium set.'}{' '}
                        {r.scope && (
                          <>
                            {r.scope.answered} of {r.scope.localPremiumRows} answered
                            {r.scope.unreachable > 0 ? `, ${r.scope.unreachable} unreachable` : ''}.
                          </>
                        )}{' '}
                        {r.mrrEstimate == null && (
                          <>
                            MRR is deliberately absent - the RevenueCat response does not carry price, so it would cost
                            a second call per subscriber. A figure that times out is worse than no figure.
                          </>
                        )}
                      </Prose>
                    </div>
                  </Panel>
                )}
              </Source>
            </>
          );
        }}
      </Source>
    </div>
  );
}

function DayRows({ rows }: { rows: { day: string; signups: number; premiumStarts: number | null; premiumEnds: number | null }[] }) {
  const recent = rows.slice(-21);
  const max = Math.max(...recent.map((r) => r.signups), 1);
  return (
    <>
      {recent.map((r) => (
        <div key={r.day} style={{ padding: '9px 0', borderBottom: LINE.row }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
            <span style={{ width: 92, flex: 'none', font: `400 12px/1.2 ${FONT.mono}`, color: C.t2 }}>{r.day}</span>
            <span style={{ flex: 1 }} />
            <span style={{ ...num, font: `500 13px/1.2 ${FONT.mono}`, color: C.t1 }}>{r.signups}</span>
            <span style={{ width: 110, textAlign: 'right', font: `400 11px/1.2 ${FONT.mono}`, color: C.t3 }}>
              {r.premiumStarts == null ? STATE.notRecorded : `+${r.premiumStarts} / -${r.premiumEnds ?? 0}`}
            </span>
          </div>
          <Bar pct={(r.signups / max) * 100} color={C.okDim} />
        </div>
      ))}
    </>
  );
}

function ActRows({ rows }: { rows: { day: string; activated: number }[] }) {
  const max = Math.max(...rows.map((r) => r.activated), 1);
  return (
    <>
      {rows.map((r) => (
        <div key={r.day} style={{ padding: '9px 0', borderBottom: LINE.row }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
            <span style={{ width: 92, flex: 'none', font: `400 12px/1.2 ${FONT.mono}`, color: C.t2 }}>{r.day}</span>
            <span style={{ flex: 1 }} />
            <span style={{ ...num, font: `500 13px/1.2 ${FONT.mono}`, color: C.t1 }}>{r.activated}</span>
            <span style={{ width: 110, textAlign: 'right', font: `400 11px/1.2 ${FONT.text}`, color: C.t3 }}>
              first play
            </span>
          </div>
          <Bar pct={(r.activated / max) * 100} color={C.okDim} />
        </div>
      ))}
    </>
  );
}

const Empty = ({ text }: { text: string }) => (
  <div style={{ padding: '22px 0', font: `400 12.5px/1.5 ${FONT.text}`, color: C.t3 }}>{text}</div>
);
