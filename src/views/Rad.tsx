import type { Ctx } from '../App';
import { C, FONT, LINE, num, GAP } from '../theme';
import { Icon } from '../icons';
import { Bar, Collapsible, Prose, SectionHead, Source, Panel, SkelBars, SkelRows } from '../components/primitives';
import { useAeDj, useAeDjLines, useAeProbe, useAeUpstream, type DjLine } from '../lib/api';
import * as fx from '../lib/fixtures';

export default function Rad({ ctx }: { ctx: Ctx }) {
  const demo = ctx.demo;
  const probe = useAeProbe();
  const dj = useAeDj(ctx.hours);
  const upstream = useAeUpstream(ctx.hours);
  const lines = useAeDjLines(ctx.hours, !demo);

  // Unverified is a first-class state. Rendering a plausible-looking chart from a
  // source nobody has confirmed is the worst thing this dashboard could do, so
  // the banner stays until a probe actually returns rows.
  const verified = !demo && probe.state === 'ok' && probe.data.rows.length > 0;

  return (
    <div style={{ display: 'grid', gap: GAP }}>
      {/*
        The banner stands in demo mode too, because Analytics Engine genuinely has
        never been read - but the live probe's failure detail is suppressed there,
        since mixing real diagnostics into fixture data is exactly the kind of
        half-true panel this dashboard is meant not to produce.
      */}
      {!verified && <UnverifiedBanner detail={!demo && probe.state === 'unavailable' ? probe.detail : undefined} />}

      <Panel title="DJ line outcomes by reason" meta="rad_fm_events · blob3">
        <div style={{ padding: '11px 0 4px' }}>
          <Prose max={78}>
            A rejection costs nothing if the retry succeeds. What matters is{' '}
            <strong style={{ fontWeight: 500, color: C.warnText }}>reached a listener</strong> - the guard rejected
            twice and a stock line went out instead. Rows are ranked by that, not by volume: across three days
            simile was rejected 43 times and reached nobody, while stutter was rejected 4 times and reached a
            listener every time, because it was tripping on song titles the retry had to repeat.
          </Prose>
        </div>
        {demo ? (
          <DjRows rows={fx.djReasons(demo)} incident={demo === 'incident'} />
        ) : (
          <Source data={dj} what="DJ outcomes" skeleton={<SkelBars rows={6} />}>
            {(d) => {
              const rows = d.rows.map((r: any) => ({
                reason: String(r.reason || 'ok'),
                n: Number(r.n ?? 0),
                fellBack: Number(r.fellBack ?? 0),
                share: ''
              }));
              const total = rows.reduce((a: number, b: any) => a + b.n, 0);
              if (!total) return <Empty text="No DJ events in this window." />;
              const anyFellBack = rows.some((r: any) => r.fellBack > 0);
              return (
                <>
                  <DjRows
                    rows={rows.map((r: any) => ({ ...r, share: `${((r.n / total) * 100).toFixed(1)}%` }))}
                    incident={false}
                  />
                  {/*
                    Zero fallbacks and "we were not recording fallbacks" are
                    different claims. The slot was appended on 6 Aug, so rows
                    written before it read 0 and look identical to a clean window.
                  */}
                  {!anyFellBack && (
                    <div style={{ paddingTop: 12 }}>
                      <Prose max={78}>
                        No line in this window fell back to stock. Rows written before 6 Aug carry no fallback
                        figure and read as 0 here, so on a window reaching back past that date this is not yet
                        evidence that none did.
                      </Prose>
                    </div>
                  )}
                </>
              );
            }}
          </Source>
        )}
      </Panel>

      {/*
        What Rad actually said, which this dashboard could not answer until 6 Aug.
        
        `trackDjLine` recorded textLength - a number - so the only record of the
        words was the RAD_SAYS KV, which caps at 10 entries per session and shifts
        the oldest off: across three days it held 184 of 579 lines, 32%, and the
        other 395 were gone. blob4 is the line itself, with no per-key cap.
        
        Every other panel in this product measures whether the machinery worked.
        This is the only one that shows the output a listener actually heard, and
        a DJ line can be well-formed, fast, non-degenerate and still bad.
      */}
      {!demo && (
        <Panel title="What Rad said" meta="rad_fm_events · blob4 · newest 30">
          <Source data={lines} what="DJ lines" skeleton={<SkelRows rows={6} cols={[null, 90, 70]} />}>
            {(d) =>
              d.rows.length ? (
                <>
                  <LineRows rows={d.rows} />
                  <div style={{ paddingTop: 12 }}>
                    <Prose max={78}>
                      <code style={{ font: `400 11.5px/1 ${FONT.mono}`, color: 'rgba(255,255,255,0.7)' }}>/ai</code> is
                      the instrumented path;{' '}
                      <code style={{ font: `400 11.5px/1 ${FONT.mono}`, color: 'rgba(255,255,255,0.7)' }}>/ai/text</code>{' '}
                      is the internal character-judging harness and is deliberately not instrumented, so a synthetic
                      run never appears here. A count that looks low against request volume is that, not a gap.
                    </Prose>
                  </div>
                </>
              ) : (
                <Empty text="No lines recorded in this window. blob4 was added on 6 Aug, so a window reaching back past it will be short or empty." />
              )
            }
          </Source>
        </Panel>
      )}

      <Panel title="Upstream providers" meta="trackUpstream">
        {/*
          Honest about which slot mappings have actually been confirmed. `recs`
          and `dj` are validated in RUNBOOK.md; the upstream doubles are read from
          source and have never been checked against real rows.
        */}
        {!demo && (
          <div style={{ padding: '11px 0 0' }}>
            <Prose max={78}>
              Outcomes are shown as the provider recorded them, not sorted into pass and fail.
            </Prose>
          </div>
        )}
        <UpstreamHead />
        {demo ? (
          <UpstreamRows rows={fx.upstream(demo)} />
        ) : (
          <Source data={upstream} what="Upstream providers" skeleton={<SkelRows rows={3} cols={[null, 70, 90, 80]} />}>
            {(d) =>
              d.rows.length ? (
                <UpstreamRows
                  rows={d.rows.map((r: any) => ({
                    provider: String(r.provider ?? '-'),
                    calls: Number(r.calls ?? 0).toLocaleString(),
                    outcomes: r.outcomes ?? {},
                    p50: `${Math.round(Number(r.latency ?? 0))}ms`,
                    attempts: Number(r.attempts ?? 0).toFixed(2)
                  }))}
                />
              ) : (
                <Empty text="No upstream events in this window." />
              )
            }
          </Source>
        )}
      </Panel>
    </div>
  );
}

function UnverifiedBanner({ detail }: { detail?: string }) {
  return (
    <div
      style={{
        border: '1px solid rgba(224,160,48,0.28)',
        background: 'rgba(224,160,48,0.06)',
        borderRadius: 8,
        padding: '16px 18px'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8, color: C.warnText }}>
        <Icon name="exclamationmark.triangle" size={13} />
        <span style={{ font: `600 10px/1 ${FONT.text}`, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
          Source unverified
        </span>
      </div>
      <div style={{ font: `400 12.5px/1.6 ${FONT.text}`, color: 'rgba(255,255,255,0.72)', maxWidth: '74ch' }}>
        Analytics Engine has never been read. Writes are fire-and-forget, so an absent datapoint is not proof the event
        did not happen - confirm the binding is deployed before assuming the code path is cold. Everything below is the
        panel shape, not confirmed data.
        {detail && <div style={{ marginTop: 6, color: C.warnText }}>{detail}</div>}
      </div>
      <div
        style={{
          marginTop: 12,
          padding: '11px 13px',
          borderRadius: 6,
          background: 'rgba(0,0,0,0.4)',
          border: LINE.edge,
          font: `400 11.5px/1.6 ${FONT.mono}`,
          color: 'rgba(255,255,255,0.6)',
          overflowX: 'auto'
        }}
      >
        SELECT count() AS n FROM rad_fm_events WHERE timestamp &gt; now() - INTERVAL '1' DAY
      </div>
    </div>
  );
}

function DjRows({
  rows,
  incident
}: {
  rows: { reason: string; n: number; share: string; fellBack?: number }[];
  incident: boolean;
}) {
  const max = Math.max(...rows.map((r) => r.n), 1);
  return (
    <>
      {rows.map((d) => (
        <div key={d.reason} style={{ padding: '11px 0', borderBottom: LINE.row }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 7 }}>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                font: `400 13px/1.4 ${FONT.mono}`,
                color: d.reason === 'ok' ? C.ok : 'rgba(255,255,255,0.82)'
              }}
            >
              {d.reason}
            </span>
            <span
              style={{
                ...num,
                font: `500 13px/1.2 ${FONT.mono}`,
                color: d.reason === 'ok' ? C.ok : incident ? C.warn : C.t1
              }}
            >
              {d.n.toLocaleString()}
            </span>
            <span style={{ width: 52, textAlign: 'right', font: `400 11.5px/1.2 ${FONT.mono}`, color: 'rgba(255,255,255,0.5)' }}>
              {d.share}
            </span>
            {/* The consequence column. Red when non-zero, because unlike the
                rejection count this one describes something a listener heard. */}
            <span
              style={{
                ...num,
                width: 116,
                textAlign: 'right',
                font: `500 11.5px/1.2 ${FONT.mono}`,
                color: d.fellBack ? C.bad : C.t3
              }}
            >
              {d.reason === 'ok' ? '' : d.fellBack ? `${d.fellBack} reached` : '0 reached'}
            </span>
          </div>
          <Bar
            pct={(d.n / max) * 100}
            color={d.reason === 'ok' ? C.okDim : d.fellBack ? C.bad : incident ? C.warn : 'rgba(255,255,255,0.28)'}
          />
        </div>
      ))}
    </>
  );
}

const cols = [
  { label: 'Provider', w: undefined as number | undefined },
  { label: 'Calls', w: 72 },
  { label: 'Outcomes', w: undefined as number | undefined },
  { label: 'p50', w: 72 },
  { label: 'Attempts', w: 72 }
];

function UpstreamHead() {
  return (
    <div
      style={{
        display: 'flex',
        gap: 14,
        padding: '10px 0',
        borderBottom: LINE.row,
        font: `600 9.5px/1 ${FONT.text}`,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.5)'
      }}
    >
      {cols.map((c) => (
        <span key={c.label} style={c.w ? { width: c.w, textAlign: 'right' } : { flex: 1, minWidth: 0 }}>
          {c.label}
        </span>
      ))}
    </div>
  );
}

function UpstreamRows({
  rows
}: {
  rows: { provider: string; calls: string; outcomes: Record<string, number>; p50: string; attempts: string }[];
}) {
  return (
    <>
      {rows.map((u) => (
        <div key={u.provider} style={{ display: 'flex', gap: 14, padding: '11px 0', borderBottom: LINE.row, alignItems: 'baseline' }}>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              font: `400 12.5px/1.4 ${FONT.mono}`,
              color: 'rgba(255,255,255,0.82)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {u.provider}
          </span>
          <Cell w={72} value={u.calls} color="rgba(255,255,255,0.7)" />
          {/*
            The outcomes as recorded, not sorted into pass and fail. Which token
            means success is the provider's business, and guessing it is what made
            a working provider read as 100% failure.
          */}
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {Object.entries(u.outcomes).map(([outcome, n]) => (
              <span
                key={outcome}
                style={{
                  padding: '2px 7px',
                  borderRadius: 4,
                  background: 'rgba(255,255,255,0.06)',
                  border: LINE.edge,
                  font: `400 11px/1.5 ${FONT.mono}`,
                  color: /err|fail|timeout|abort|refus|denied|4\d\d|5\d\d/i.test(outcome) ? C.warnText : C.t2
                }}
              >
                {/*
                  Historical rows carry a raw, truncated error message as the
                  outcome - the backend has since bounded it to a short token, but
                  the old rows keep their value. Untruncated it ran straight into
                  its own count and read as though "See 5" were part of the error.
                */}
                <span title={outcome}>{outcome.length > 28 ? `${outcome.slice(0, 28)}…` : outcome}</span>
                <span style={{ color: C.t3, marginLeft: 6 }}>{n.toLocaleString()}</span>
              </span>
            ))}
          </span>
          <Cell w={72} value={u.p50} color="rgba(255,255,255,0.7)" />
          <Cell w={72} value={u.attempts} color={parseFloat(u.attempts) > 1.1 ? C.warn : C.t2} />
        </div>
      ))}
    </>
  );
}

const Cell = ({ w, value, color, weight = 400 }: { w: number; value: string; color: string; weight?: number }) => (
  <span style={{ ...num, width: w, textAlign: 'right', font: `${weight} 12.5px/1.2 ${FONT.mono}`, color }}>{value}</span>
);

/**
 * One line as it went out, with the reason it was regenerated beside it.
 *
 * The line is the content, so it gets the room and the readable face. Everything
 * else - style, reason, length - is metadata and recedes. A fallback is called
 * out in words rather than by colour alone, because it is the one row here where
 * what the listener heard is not what is printed.
 */
function LineRows({ rows }: { rows: DjLine[] }) {
  return (
    <Collapsible
      rows={rows}
      initial={6}
      noun="lines"
      render={(r, i) => (
        <div key={`${r.at}-${i}`} style={{ padding: '12px 0', borderBottom: LINE.row }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 340px', minWidth: 0, font: `400 13px/1.55 ${FONT.text}`, color: 'rgba(255,255,255,0.88)' }}>
              {r.text}
            </span>
            <span style={{ display: 'flex', gap: 10, alignItems: 'baseline', flex: 'none' }}>
              {/*
                blob2 is documented as `style` and reads back as "dj" - the event
                type - on every live row. Rather than print an unexplained value
                under a label it may not deserve, it is not shown until that slot
                is confirmed against a real row, the same standing this file
                already gives the unverified upstream doubles.
              */}
              {r.reason !== 'ok' && (
                <span
                  style={{
                    padding: '1px 6px',
                    borderRadius: 4,
                    font: `500 10px/1.5 ${FONT.mono}`,
                    background: r.fellBack ? 'rgba(255,98,89,0.14)' : 'rgba(224,160,48,0.14)',
                    color: r.fellBack ? C.bad : C.warnText
                  }}
                >
                  {r.reason}
                </span>
              )}
              {r.fellBack && (
                <span style={{ font: `500 10.5px/1.4 ${FONT.mono}`, color: C.bad }}>stock line sent</span>
              )}
              {/*
                textLength is CHARACTERS. This rendered "171w", which reads as a
                171-WORD line - roughly a minute of speech for something that is
                actually two sentences. A unit invented on the label is the same
                defect as a wrong number.
              */}
              <span style={{ ...num, width: 62, textAlign: 'right', font: `400 11px/1.4 ${FONT.mono}`, color: C.t3 }}>
                {r.len} chars
              </span>
            </span>
          </div>
        </div>
      )}
    />
  );
}

const Empty = ({ text }: { text: string }) => (
  <div style={{ padding: '22px 0', font: `400 12.5px/1.5 ${FONT.text}`, color: 'rgba(255,255,255,0.5)' }}>{text}</div>
);
