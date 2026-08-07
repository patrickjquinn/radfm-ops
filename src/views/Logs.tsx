import type { Ctx } from '../App';
import { C, FONT, LINE, num, GAP } from '../theme';
import { Callout, Collapsible, Generated, Prose, SectionHead, Source, Panel } from '../components/primitives';
import { useCluster, useLogs, type LogGroup } from '../lib/api';
import * as fx from '../lib/fixtures';

export default function Logs({ ctx }: { ctx: Ctx }) {
  const demo = ctx.demo;
  // Capped at retention regardless of the header range. The banner above says so
  // rather than the number quietly meaning something different from the label.
  const hours = Math.min(ctx.hours, 72);
  const warn = useLogs('warn', hours);
  const err = useLogs('error', hours);

  const warnRows: { count: number; msg: string; window: string; bad?: boolean }[] = demo
    ? fx.warnings(demo)
    : [];

  return (
    <div style={{ display: 'grid', gap: GAP }}>
      <Callout tone="amber">
        A bug that had disabled setlists for a third of all gigs lived entirely in warnings - 1,094 of them in three
        days, none of which threw. Warnings are grouped by normalised message here - numbers and hex stripped as{' '}
        <code style={{ font: `400 12px/1 ${FONT.mono}`, color: C.warnText }}>scripts/logs.ts</code> does, and quoted
        literals collapsed as well, so one failure mode is one row rather than one row per artist name.
      </Callout>

      <Panel title="Warnings by normalised message" meta={demo ? `${warnRows.reduce((a, b) => a + b.count, 0).toLocaleString()} in window` : `${hours}h window`}>
        {demo ? (
          <WarnRows rows={warnRows} />
        ) : (
          <Source data={warn} what="Warnings">
            {(d) =>
              d.groups && d.groups.length ? (
                <>
                  <Cluster groups={d.groups} />
                  <WarnRows rows={d.groups.map(toWarnRow)} />
                  {/*
                    The counts below come from a sample, because normalising the message
                    requires the raw events and the events view does not return them all.
                    The headline count is exact and separate. Saying which is which is the
                    difference between a ranked breakdown and a wrong number - summing the
                    sample once put 12h above 24h on the same screen.
                  */}
                  {!d.covered && d.total != null && (
                    <div style={{ paddingTop: 12 }}>
                      <Prose>
                        <strong style={{ color: C.warnText, fontWeight: 500 }}>
                          {d.total.toLocaleString()} warnings in this window
                        </strong>
                        ; the grouping above is built from a {d.sampled.toLocaleString()}-event sample, so treat the
                        ranking as the signal and not the counts. Observability does not return every matching event to
                        a single query.
                      </Prose>
                    </div>
                  )}
                </>
              ) : (
                <Empty text="No warnings in this window." />
              )
            }
          </Source>
        )}
      </Panel>

      <Panel title="Errors" meta="level=error">
        {demo ? (
          demo === 'incident' ? (
            <ErrorRows rows={fx.errors} />
          ) : (
            <NoErrors go={() => ctx.go('traffic')} />
          )
        ) : (
          <Source data={err} what="Errors">
            {(d) =>
              (d.groups && d.groups.length) || (d.events && d.events.length) ? (
                <>
                  {/*
                    Errors get the same treatment warnings do, which they did not
                    before: normalised grouping first, semantic clustering over
                    that, then the raw lines.

                    The panel used to render one row per raw event, so a single
                    orchestrator fault repeating every few minutes read as a
                    hundred separate incidents and you could not see that it was
                    one thing happening often. That is precisely the bug the
                    warnings panel was built to fix, left in place on the more
                    severe level.
                  */}
                  {d.groups && d.groups.length > 0 && (
                    <>
                      <Cluster groups={d.groups} tone="bad" />
                      <WarnRows rows={d.groups.map((g) => toWarnRow(g, 1))} noun="error groups" />
                    </>
                  )}

                  {!d.covered && d.total != null && (
                    <div style={{ paddingTop: 12 }}>
                      <Prose>
                        <strong style={{ color: C.bad, fontWeight: 500 }}>
                          {d.total.toLocaleString()} error{d.total === 1 ? '' : 's'} in this window
                        </strong>
                        ; the grouping above is built from a {d.sampled.toLocaleString()}-event sample, so treat the
                        ranking as the signal and not the counts.
                      </Prose>
                    </div>
                  )}

                  {/*
                    The lines stay, behind a click. Grouping answers "how often";
                    for an error the exact text and the path are what you debug
                    from, and no normalisation can preserve those.
                  */}
                  {d.events && d.events.length > 0 && (
                    <div style={{ paddingTop: d.groups && d.groups.length ? 16 : 0 }}>
                      <Collapsible
                        rows={d.events.map((e: any) => ({
                          time: e.timestamp ? new Date(e.timestamp).toISOString().slice(11, 19) + 'Z' : '-',
                          msg: e.message,
                          route: e.route
                        }))}
                        initial={d.groups && d.groups.length ? 0 : 6}
                        noun="raw error lines"
                        render={(r, i) => <ErrorRow key={`${r.time}-${i}`} {...r} />}
                      />
                    </div>
                  )}
                </>
              ) : (
                <NoErrors go={() => ctx.go('traffic')} />
              )
            }
          </Source>
        )}
      </Panel>
    </div>
  );
}

/**
 * `bad` colours the count, and the bar for that is not the same at both levels.
 * 500 warnings in a window is noise worth naming; 500 errors would be an outage
 * and two is already a pattern, so the error path passes its own threshold
 * rather than inheriting a number tuned for the quieter level.
 */
const toWarnRow = (g: LogGroup, loudAt = 500) => ({
  count: g.count,
  msg: g.msg,
  window: g.first && g.last ? `first ${rel(g.first)} · last ${rel(g.last)}` : '',
  bad: g.count > loudAt
});

function WarnRows({
  rows,
  noun = 'warning groups'
}: {
  rows: { count: number; msg: string; window: string; bad?: boolean }[];
  noun?: string;
}) {
  // Ranked by count, so the answer is nearly always in the first few. Twenty-two
  // groups is one finding and twenty-one rows of tail.
  return (
    <Collapsible
      rows={rows}
      initial={6}
      noun={noun}
      render={(w) => (
        <div
          key={w.msg}
          style={{
            padding: '12px 0',
            borderBottom: LINE.row,
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px 14px',
            alignItems: 'baseline'
          }}
        >
          <span style={{ ...num, font: `500 13px/1.2 ${FONT.mono}`, color: w.bad ? C.warnText : C.t1, minWidth: 52 }}>
            {w.count.toLocaleString()}
          </span>
          <span style={{ flex: '1 1 300px', minWidth: 0, font: `400 12.5px/1.5 ${FONT.mono}`, color: 'rgba(255,255,255,0.78)' }}>
            {w.msg}
          </span>
          <span style={{ font: `400 11px/1.4 ${FONT.text}`, color: 'rgba(255,255,255,0.5)', flex: 'none' }}>
            {w.window}
          </span>
        </div>
      )}
    />
  );
}

/** One raw error line. Shared by the demo path and the collapsible live list. */
function ErrorRow({ time, msg, route }: { time: string; msg: string; route: string }) {
  return (
    <div
      style={{
        padding: '12px 0',
        borderBottom: LINE.row,
        display: 'flex',
        flexWrap: 'wrap',
        gap: '10px 14px',
        alignItems: 'baseline'
      }}
    >
      <span style={{ font: `400 11.5px/1.2 ${FONT.mono}`, color: 'rgba(255,255,255,0.4)', flex: 'none' }}>{time}</span>
      <span style={{ flex: '1 1 300px', minWidth: 0, font: `400 12.5px/1.5 ${FONT.mono}`, color: '#FF8078' }}>
        {msg}
      </span>
      <span style={{ font: `400 11px/1.4 ${FONT.mono}`, color: 'rgba(255,255,255,0.5)', flex: 'none' }}>{route}</span>
    </div>
  );
}

function ErrorRows({ rows }: { rows: { time: string; msg: string; route: string }[] }) {
  return (
    <>
      {rows.map((e, i) => (
        <ErrorRow key={i} {...e} />
      ))}
    </>
  );
}

/**
 * The empty state says the quiet part out loud. "No errors" is the exact reading
 * that let a total auth outage look fine, so this state refuses to be reassuring
 * and sends the operator to the panel that would actually show it.
 */
function NoErrors({ go }: { go: () => void }) {
  return (
    <div style={{ padding: '28px 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
      <div style={{ font: `400 13.5px/1.5 ${FONT.text}`, color: 'rgba(255,255,255,0.62)' }}>No errors in this window.</div>
      <div style={{ font: `400 12px/1.5 ${FONT.text}`, color: 'rgba(255,255,255,0.5)', maxWidth: '56ch' }}>
        That is not the same as healthy - check the 4xx panel and the warning groups above before concluding anything.
      </div>
      <button
        type="button"
        onClick={go}
        style={{
          marginTop: 4,
          display: 'inline-flex',
          alignItems: 'center',
          height: 34,
          padding: '0 14px',
          borderRadius: 7,
          border: '1px solid rgba(255,255,255,0.14)',
          background: 'rgba(255,255,255,0.05)',
          font: `500 12.5px/1 ${FONT.text}`,
          color: '#fff',
          cursor: 'pointer'
        }}
      >
        Check 4xx →
      </button>
    </div>
  );
}

const Empty = ({ text }: { text: string }) => (
  <div style={{ padding: '22px 0', font: `400 12.5px/1.5 ${FONT.text}`, color: 'rgba(255,255,255,0.5)' }}>{text}</div>
);

function rel(ts: number) {
  const ms = Date.now() - ts;
  if (!Number.isFinite(ms) || ms < 0) return '-';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Semantic clustering, reported as a DIFF against the regex grouping.
 *
 * The regex pass stays authoritative and its counts stay exact - this panel can
 * only ever say "these rows appear to mean the same thing". Framing it as a diff
 * rather than a replacement is what makes it safe to ship: the worst case is a
 * wrong sentence inside a labelled box, never a wrong count in the table below.
 *
 * It renders nothing at all when the two agree and there is no shortfall to
 * report. A panel that appears only when it has something to say is worth
 * reading; one that says "no findings" on every load teaches you to skip it.
 */
function Cluster({ groups, tone = 'warn' }: { groups: LogGroup[]; tone?: 'warn' | 'bad' }) {
  const c = useCluster(
    groups.map((g) => ({ msg: g.msg, count: g.count })),
    true
  );

  if (c.state === 'loading' || c.state === 'unavailable') return null;
  const { merges, compared, model, threshold } = c.data;
  if (!merges.length) return null;

  return (
    <div style={{ paddingBottom: 14 }}>
      <Generated model={model ?? 'bge-m3'} meta={threshold ? `cosine ≥ ${threshold}` : undefined}>
        <div style={{ font: `400 13px/1.55 ${FONT.text}`, color: '#fff', maxWidth: '76ch' }}>
          {merges.length === 1
            ? `${merges[0].members.length} groups the regex pass kept separate look like the same failure. Together they are ${merges[0].total.toLocaleString()} events, not ${merges[0].members.length} unrelated rows.`
            : `${merges.length} sets of groups look like the same failure as each other, across ${compared} compared.`}
        </div>
        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          {merges.slice(0, 3).map((m) => (
            <div key={m.members[0]} style={{ display: 'grid', gap: 3 }}>
              {m.members.map((msg) => (
                <div key={msg} style={{ font: `400 11.5px/1.5 ${FONT.mono}`, color: C.t2 }}>
                  ↳ {msg}
                </div>
              ))}
              {/* The combined figure carries the level's colour, like every
                  other count in this product. Amber for warnings, red for
                  errors - the same panel component, two different severities. */}
              <div style={{ ...num, font: `500 12px/1.4 ${FONT.mono}`, color: tone === 'bad' ? C.bad : C.warnText }}>
                {m.total.toLocaleString()} combined
              </div>
            </div>
          ))}
        </div>
        <div style={{ font: `400 11.5px/1.55 ${FONT.text}`, color: C.t3, marginTop: 12, maxWidth: '76ch' }}>
          Clustering changes grouping only. Every count below is still an exact sum of real events from the regex pass,
          which stays authoritative.
        </div>
      </Generated>
    </div>
  );
}
