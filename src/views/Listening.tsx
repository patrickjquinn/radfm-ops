import type { Ctx } from '../App';
import { C, FONT, LINE, num, GAP } from '../theme';
import { Bar, Callout, Collapsible, Prose, SectionHead, Source, StatGrid, Panel } from '../components/primitives';
import { statValue, useAdminStats, useAePlays } from '../lib/api';

/**
 * What people actually listened to.
 *
 * Every other view in this dashboard is engineering telemetry - error rates,
 * latency, deploy history. This is the first one that answers a product question,
 * and it can only exist because the backend writes an append-only play log to
 * Analytics Engine.
 *
 * `past_plays` in D1 cannot answer any of this and never will. Its primary key
 * collapses to (user_id, song), so a replay overwrites the previous row: it is
 * current state wearing a log's clothes. "Plays per day", "top played" and "repeat
 * rate" are all unanswerable from it. That is why the Overview labels its D1
 * counts "current state" and refuses to call 24h activity DAU.
 */
export default function Listening({ ctx }: { ctx: Ctx }) {
  // The header now offers day ranges on this view, so the window shown is the
  // window asked for. It used to widen 24h to 7d silently and explain itself in
  // the panel, which was honest about the result and misleading about the control.
  const days = Math.round(ctx.hours / 24);
  const plays = useAePlays(days, !ctx.demo);
  const stats = useAdminStats(!ctx.demo);
  const registered = stats.state === 'ok' ? statValue(stats.data.users) : null;

  return (
    <div style={{ display: 'grid', gap: GAP }}>
      <Callout tone="teal" icon>
        This is the only source that can answer a historical listening question.{' '}
        <code style={{ font: `400 12px/1 ${FONT.mono}`, color: '#7BCFC5' }}>past_plays</code> in D1 overwrites on
        replay, so it is current state, not a log - plays per day, top played and repeat rate are all unanswerable from
        it. The play log starts at the deploy that introduced it and{' '}
        <strong style={{ fontWeight: 500, color: '#fff' }}>cannot be backfilled</strong>.
      </Callout>

      <Source data={plays} what="Listening history">
        {(d) => {
          const t = d.totals;
          const p = Number(t?.plays ?? 0);
          const l = Number(t?.listeners ?? 0);
          const tr = Number(t?.tracks ?? 0);
          // Distinct tracks over plays. Near 100% means almost nothing is played
          // twice, which for a radio product is a finding, not a statistic.
          const repeat = p ? ((1 - tr / p) * 100).toFixed(1) : null;
          const reach = registered && l ? ((l / registered) * 100).toFixed(1) : null;

          return (
            <>
              <StatGrid
                min={190}
                items={[
                  { label: 'Plays', value: p.toLocaleString(), context: `in the last ${d.days} days`, tone: 'plain' },
                  {
                    label: 'Listeners',
                    value: l.toLocaleString(),
                    // The real engagement number, and the first time this dashboard
                    // has been able to state one. Registered users is the vanity
                    // number; this is the one that changes a decision.
                    context: reach ? `${reach}% of ${registered?.toLocaleString()} registered` : 'distinct accounts',
                    tone: 'plain'
                  },
                  {
                    label: 'Distinct tracks',
                    value: tr.toLocaleString(),
                    context: 'unique songs played',
                    tone: 'plain'
                  },
                  {
                    label: 'Repeat rate',
                    value: repeat != null ? `${repeat}%` : 'unavailable',
                    context:
                      repeat != null && Number(repeat) < 15
                        ? 'almost nothing is played twice'
                        : 'share of plays that were a repeat',
                    tone: 'plain'
                  }
                ]}
              />

              <Panel title="Plays and listeners by day" meta={`rad_fm_events · ${d.daily.length} day${d.daily.length === 1 ? '' : 's'} recorded`}>
                {d.daily.length ? (
                  <>
                    <DayRows rows={d.daily} />
                    {/*
                      The window asked for and the window that exists are different
                      numbers, and the gap is the whole caveat. An axis drawn across
                      30 empty days would read as "nobody listened", when it means
                      "nobody was measuring". Same class of lie as a false zero.
                    */}
                    {d.daily.length < d.days && (
                      <div style={{ paddingTop: 12 }}>
                        <Prose>
                          Asked for {d.days} days, {d.daily.length} recorded.{' '}
                          <strong style={{ fontWeight: 500, color: C.warnText }}>
                            The days before that are empty because instrumentation did not exist
                          </strong>
                          , not because nobody listened. The play log cannot be backfilled, so this window fills in one
                          day at a time from here.
                        </Prose>
                      </div>
                    )}
                  </>
                ) : (
                  <Empty text="No plays recorded in this window." />
                )}
              </Panel>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 20 }}>
                <Panel title="Top artists" meta="by plays">
                  {d.artists.length ? (
                    <RankRows
                      rows={d.artists.map((a) => ({
                        label: a.artist,
                        value: Number(a.plays),
                        note: `${a.listeners} listener${Number(a.listeners) === 1 ? '' : 's'}`
                      }))}
                    />
                  ) : (
                    <Empty text="No artist data in this window." />
                  )}
                </Panel>

                <Panel title="Top tracks" meta="by plays">
                  {d.tracks.length ? (
                    <RankRows
                      rows={d.tracks.map((t2) => ({
                        label: t2.title,
                        value: Number(t2.plays),
                        note: t2.artist
                      }))}
                    />
                  ) : (
                    <Empty text="No track data in this window." />
                  )}
                </Panel>
              </div>

              {/*
                A top-15 chart with counts in single digits is a ranking of noise.
                Saying so is cheaper than letting someone plan a playlist around it.
              */}
              {d.artists.length > 0 && Number(d.artists[0]?.plays ?? 0) < 20 && (
                <Prose>
                  The top artist has {d.artists[0].plays} plays. At this volume the ranking is mostly noise - one
                  listener on a long session moves it. Treat it as a sample of what is being played, not as a chart.
                </Prose>
              )}
            </>
          );
        }}
      </Source>
    </div>
  );
}

function DayRows({ rows }: { rows: { day: string; plays: string; listeners: string }[] }) {
  const max = Math.max(...rows.map((r) => Number(r.plays)), 1);
  return (
    <>
      {rows.map((r) => (
        <div key={r.day} style={{ padding: '11px 0', borderBottom: LINE.row }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 7 }}>
            <span style={{ width: 92, flex: 'none', font: `400 12px/1.2 ${FONT.mono}`, color: C.t2 }}>
              {r.day.slice(0, 10)}
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ ...num, font: `500 13px/1.2 ${FONT.mono}`, color: C.t1 }}>
              {Number(r.plays).toLocaleString()}
            </span>
            <span style={{ width: 96, textAlign: 'right', font: `400 11.5px/1.2 ${FONT.mono}`, color: C.t3 }}>
              {r.listeners} listener{Number(r.listeners) === 1 ? '' : 's'}
            </span>
          </div>
          <Bar pct={(Number(r.plays) / max) * 100} color={C.okDim} />
        </div>
      ))}
    </>
  );
}

function RankRows({ rows }: { rows: { label: string; value: number; note: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <Collapsible
      rows={rows}
      initial={6}
      noun="rows"
      render={(r, i) => (
        <div key={`${r.label}-${i}`} style={{ padding: '10px 0', borderBottom: LINE.row }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                font: `400 12.5px/1.4 ${FONT.text}`,
                color: 'rgba(255,255,255,0.85)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {r.label}
            </span>
            <span style={{ ...num, font: `500 12.5px/1.2 ${FONT.mono}`, color: C.t1 }}>{r.value.toLocaleString()}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1 }}>
              <Bar pct={(r.value / max) * 100} color={C.okDim} />
            </span>
            <span
              style={{
                width: 140,
                textAlign: 'right',
                font: `400 11px/1.4 ${FONT.text}`,
                color: C.t3,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {r.note}
            </span>
          </div>
        </div>
      )}
    />
  );
}

const Empty = ({ text }: { text: string }) => (
  <div style={{ padding: '22px 0', font: `400 12.5px/1.5 ${FONT.text}`, color: C.t3 }}>{text}</div>
);
