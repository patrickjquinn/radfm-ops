import type { Ctx } from '../App';
import { C, FONT, LINE, num } from '../theme';
import { Prose, SectionHead, Source, StatGrid } from '../components/primitives';
import { useAeRecs } from '../lib/api';
import * as fx from '../lib/fixtures';
import { WEIGHTS_SOURCE, weights } from '../lib/constants';

export default function Recs({ ctx }: { ctx: Ctx }) {
  const demo = ctx.demo;
  const recs = useAeRecs(ctx.hours);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {demo ? (
        <StatGrid items={fx.recStats(demo)} />
      ) : (
        <Source data={recs} what="Recommendation metrics">
          {(d) => <StatGrid items={summarise(d.rows)} />}
        </Source>
      )}

      <section>
        <SectionHead title="Pool health by source" meta="trackRecommendations" />
        <SourceHead />
        {demo ? (
          <SourceRows rows={fx.recSources(demo)} />
        ) : (
          <Source data={recs} what="Pool health">
            {(d) =>
              d.rows.length ? (
                <SourceRows
                  rows={d.rows.map((r: any) => ({
                    source: String(r.source ?? '-'),
                    pool: String(Math.round(Number(r.pool ?? 0))),
                    ms: String(Math.round(Number(r.ms ?? 0))),
                    degraded: String(Math.round(Number(r.degraded ?? 0))),
                    low: Number(r.pool ?? 0) < 400
                  }))}
                />
              ) : (
                <div style={{ padding: '22px 0', font: `400 12.5px/1.5 ${FONT.text}`, color: 'rgba(255,255,255,0.5)' }}>
                  No recommendation events in this window.
                </div>
              )
            }
          </Source>
        )}
        <div style={{ paddingTop: 14 }}>
          <Prose>
            Degraded climbing means the orchestrator is falling back. It degrades gracefully, so nothing throws - this
            table is the only way to see it.
          </Prose>
        </div>
      </section>

      <section>
        <SectionHead title="Why the pool collapsed" meta="rad_fm_events · poolSource" />
        <div style={{ padding: '11px 0 12px' }}>
          <Prose>
            These demand opposite responses, which is why they are separated rather than counted
            together. <code style={{ font: `400 11.5px/1 ${FONT.mono}`, color: 'rgba(255,255,255,0.7)' }}>error:deadline</code>{' '}
            is upstreams running slow - expected at roughly 2% and not a code fault.{' '}
            <code style={{ font: `400 11.5px/1 ${FONT.mono}`, color: 'rgba(255,255,255,0.7)' }}>error:validation</code>{' '}
            is a caller bug: the request never got in and the listener got nothing.
          </Prose>
        </div>
        {demo ? (
          <Empty text="Cause breakdown is live-only." />
        ) : (
          <Source data={recs} what="Pool collapse causes">
            {(d) =>
              d.causes?.length ? (
                <CauseRows rows={d.causes} />
              ) : (
                <Empty text="No pool collapses in this window." />
              )
            }
          </Source>
        )}
      </section>

      <section>
        <SectionHead title="Scoring weights" meta={`${WEIGHTS_SOURCE} · not read live`} />
        <div style={{ padding: '11px 0 12px' }}>
          <Prose>
            These interact - a tuned system, not independent dials. A slider here produces confident nonsense, so they
            are shown beside the outcome metrics above and changed in code. <strong style={{ fontWeight: 500, color: C.warnText }}>
            Transcribed from the backend source, not read from the running system</strong> - no route serves them, so
            they can drift the moment that file is edited.
          </Prose>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {weights.map((w) => (
            <div
              key={w.name}
              style={{
                padding: '9px 13px',
                borderRadius: 6,
                background: 'rgba(255,255,255,0.04)',
                border: LINE.edge,
                display: 'flex',
                alignItems: 'baseline',
                gap: 10
              }}
            >
              <span style={{ font: `400 11.5px/1 ${FONT.mono}`, color: 'rgba(255,255,255,0.55)' }}>{w.name}</span>
              <span style={{ ...num, font: `500 12.5px/1 ${FONT.mono}`, color: C.ok }}>{w.value}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const cols = [
  { label: 'Source', w: undefined as number | undefined },
  { label: 'Pool avg', w: 74 },
  { label: 'Proc ms', w: 74 },
  { label: 'Degraded', w: 80 }
];

function SourceHead() {
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

function SourceRows({
  rows
}: {
  rows: { source: string; pool: string; ms: string; degraded: string; low?: boolean }[];
}) {
  return (
    <>
      {rows.map((r) => (
        <div key={r.source} style={{ display: 'flex', gap: 14, padding: '11px 0', borderBottom: LINE.row, alignItems: 'baseline' }}>
          <span style={{ flex: 1, minWidth: 0, font: `400 12.5px/1.4 ${FONT.mono}`, color: 'rgba(255,255,255,0.82)' }}>
            {r.source}
          </span>
          <span style={{ ...num, width: 74, textAlign: 'right', font: `400 12.5px/1.2 ${FONT.mono}`, color: r.low ? C.warn : C.t2 }}>
            {r.pool}
          </span>
          <span style={{ ...num, width: 74, textAlign: 'right', font: `400 12.5px/1.2 ${FONT.mono}`, color: 'rgba(255,255,255,0.7)' }}>
            {r.ms}
          </span>
          <span
            style={{
              ...num,
              width: 80,
              textAlign: 'right',
              font: `500 12.5px/1.2 ${FONT.mono}`,
              color: parseInt(r.degraded, 10) > 30 ? C.warn : C.t2
            }}
          >
            {r.degraded}
          </span>
        </div>
      ))}
    </>
  );
}

function summarise(rows: any[]) {
  const sets = rows.reduce((a, b) => a + Number(b.n ?? 0), 0);
  const degraded = rows.reduce((a, b) => a + Number(b.degraded ?? 0), 0);
  /**
   * Average the LIVE pool only.
   *
   * The fallback source has a pool size of 0 by definition - that is what makes
   * it the fallback. Averaging it with the live pool produced 47 from a live
   * pool of 95, and then flagged it amber for being "below the 400 floor". The
   * conclusion happened to be right and the number was an artefact of averaging
   * two incomparable things.
   */
  const liveRows = rows.filter((r) => Number(r.pool ?? 0) > 0);
  const pool = liveRows.length ? liveRows.reduce((a, b) => a + Number(b.pool ?? 0), 0) / liveRows.length : 0;
  const ms = rows.length ? rows.reduce((a, b) => a + Number(b.ms ?? 0), 0) / rows.length : 0;
  const degPct = sets ? (degraded / sets) * 100 : 0;
  return [
    { label: 'Sets built', value: sets.toLocaleString(), context: 'in window', tone: 'plain' as const },
    {
      label: 'Degraded',
      value: `${degPct.toFixed(1)}%`,
      context: degPct > 10 ? 'orchestrator falling back' : 'within normal band',
      tone: degPct > 10 ? ('warn' as const) : ('plain' as const)
    },
    {
      label: 'Pool size avg',
      value: String(Math.round(pool)),
      context: pool < 400 ? 'live sources only · below the 400 floor' : 'live sources only · healthy',
      tone: pool < 400 ? ('warn' as const) : ('plain' as const)
    },
    { label: 'Processing p50', value: `${Math.round(ms)}ms`, context: 'mean of per-source averages', tone: 'plain' as const }
  ];
}

/**
 * A cause is only "not a fault" if it is a deadline. Everything else means someone
 * got a worse experience than they should have, and `error:validation` means they
 * got nothing at all - so it is coloured as the failure it is.
 *
 * `legacy` is rows written before the backend separated the causes. It is shown as
 * unknown rather than folded into `error:other`, because "we did not record why"
 * and "the cause was other" are different statements.
 */
function CauseRows({ rows }: { rows: { cause: string; n: number }[] }) {
  const total = rows.reduce((a, b) => a + b.n, 0) || 1;
  const tone = (cause: string) =>
    cause === 'error:validation' ? C.bad : cause === 'error:deadline' ? C.t2 : cause === 'legacy' ? C.t3 : C.warn;
  const note = (cause: string) =>
    cause === 'error:deadline'
      ? 'upstreams slow · expected'
      : cause === 'error:validation'
        ? 'caller bug · listener got nothing'
        : cause === 'error:empty'
          ? 'upstreams answered, produced nothing'
          : cause === 'legacy'
            ? 'pre-4fa6f58e · cause not recorded'
            : cause === 'error:other'
              ? 'unclassified error'
              : 'unexpected value - not an error cause';

  return (
    <>
      {rows.map((r) => (
        <div key={r.cause} style={{ display: 'flex', gap: 14, padding: '11px 0', borderBottom: LINE.row, alignItems: 'baseline' }}>
          <span style={{ flex: '0 0 190px', font: `400 12.5px/1.4 ${FONT.mono}`, color: tone(r.cause) }}>{r.cause}</span>
          <span style={{ flex: 1, minWidth: 0, font: `400 12px/1.4 ${FONT.text}`, color: 'rgba(255,255,255,0.45)' }}>
            {note(r.cause)}
          </span>
          <span style={{ ...num, width: 64, textAlign: 'right', font: `500 12.5px/1.2 ${FONT.mono}`, color: tone(r.cause) }}>
            {r.n.toLocaleString()}
          </span>
          <span style={{ width: 52, textAlign: 'right', font: `400 11.5px/1.2 ${FONT.mono}`, color: 'rgba(255,255,255,0.5)' }}>
            {((r.n / total) * 100).toFixed(1)}%
          </span>
        </div>
      ))}
    </>
  );
}

const Empty = ({ text }: { text: string }) => (
  <div style={{ padding: '22px 0', font: `400 12.5px/1.5 ${FONT.text}`, color: 'rgba(255,255,255,0.5)' }}>{text}</div>
);
