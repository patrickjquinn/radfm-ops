import type { Ctx } from '../App';
import { C, FONT, LINE, num } from '../theme';
import { Icon } from '../icons';
import { Bar, Prose, SectionHead, Source } from '../components/primitives';
import { useAeDj, useAeProbe, useAeUpstream } from '../lib/api';
import * as fx from '../lib/fixtures';

export default function Rad({ ctx }: { ctx: Ctx }) {
  const demo = ctx.demo;
  const probe = useAeProbe();
  const dj = useAeDj(ctx.hours);
  const upstream = useAeUpstream(ctx.hours);

  // Unverified is a first-class state. Rendering a plausible-looking chart from a
  // source nobody has confirmed is the worst thing this dashboard could do, so
  // the banner stays until a probe actually returns rows.
  const verified = !demo && probe.state === 'ok' && probe.data.rows.length > 0;

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/*
        The banner stands in demo mode too, because Analytics Engine genuinely has
        never been read — but the live probe's failure detail is suppressed there,
        since mixing real diagnostics into fixture data is exactly the kind of
        half-true panel this dashboard is meant not to produce.
      */}
      {!verified && <UnverifiedBanner detail={!demo && probe.state === 'unavailable' ? probe.detail : undefined} />}

      <section>
        <SectionHead title="DJ line outcomes by reason" meta="rad_fm_events · blob3" />
        <div style={{ padding: '11px 0 4px' }}>
          <Prose max={74}>
            A rising share of non-<code style={{ font: `400 11.5px/1 ${FONT.mono}`, color: 'rgba(255,255,255,0.7)' }}>ok</code>{' '}
            means the degeneracy guard is rejecting more takes. Regressions here are otherwise only detectable by
            listening to the radio.
          </Prose>
        </div>
        {demo ? (
          <DjRows rows={fx.djReasons(demo)} incident={demo === 'incident'} />
        ) : (
          <Source data={dj} what="DJ outcomes">
            {(d) => {
              const rows = d.rows.map((r: any) => ({ reason: String(r.reason || 'ok'), n: Number(r.n ?? 0), share: '' }));
              const total = rows.reduce((a: number, b: any) => a + b.n, 0);
              if (!total) return <Empty text="No DJ events in this window." />;
              return (
                <DjRows
                  rows={rows.map((r: any) => ({ ...r, share: `${((r.n / total) * 100).toFixed(1)}%` }))}
                  incident={false}
                />
              );
            }}
          </Source>
        )}
      </section>

      <section>
        <SectionHead title="Upstream providers" meta="trackUpstream" />
        {/*
          Honest about which slot mappings have actually been confirmed. `recs`
          and `dj` are validated in RUNBOOK.md; the upstream doubles are read from
          source and have never been checked against real rows.
        */}
        {!demo && (
          <div style={{ padding: '11px 0 0' }}>
            <Prose max={78}>
              Slot mapping for <code style={{ font: `400 11.5px/1 ${FONT.mono}`, color: 'rgba(255,255,255,0.7)' }}>upstream</code>{' '}
              is read from <code style={{ font: `400 11.5px/1 ${FONT.mono}`, color: 'rgba(255,255,255,0.7)' }}>src/lib/analytics.ts</code>{' '}
              and has never been confirmed against real rows. Treat these columns as unlabelled until the probe runs.
            </Prose>
          </div>
        )}
        <UpstreamHead />
        {demo ? (
          <UpstreamRows rows={fx.upstream(demo)} />
        ) : (
          <Source data={upstream} what="Upstream providers">
            {(d) =>
              d.rows.length ? (
                <UpstreamRows
                  rows={d.rows.map((r: any) => ({
                    provider: String(r.provider ?? '—'),
                    calls: Number(r.calls ?? 0).toLocaleString(),
                    fail: Number(r.fail ?? 0).toLocaleString(),
                    p50: `${Math.round(Number(r.latency ?? 0))}ms`,
                    attempts: Number(r.attempts ?? 0).toFixed(2),
                    bad: Number(r.fail ?? 0) > 0 && Number(r.fail) / Math.max(1, Number(r.calls)) > 0.02
                  }))}
                />
              ) : (
                <Empty text="No upstream events in this window." />
              )
            }
          </Source>
        )}
      </section>
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
        did not happen — confirm the binding is deployed before assuming the code path is cold. Everything below is the
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

function DjRows({ rows, incident }: { rows: { reason: string; n: number; share: string }[]; incident: boolean }) {
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
          </div>
          <Bar
            pct={(d.n / max) * 100}
            color={d.reason === 'ok' ? C.okDim : incident ? C.warn : 'rgba(255,255,255,0.28)'}
          />
        </div>
      ))}
    </>
  );
}

const cols = [
  { label: 'Provider', w: undefined as number | undefined },
  { label: 'Calls', w: 72 },
  { label: 'Fail', w: 64 },
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
  rows: { provider: string; calls: string; fail: string; p50: string; attempts: string; bad?: boolean }[];
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
          <Cell w={64} value={u.fail} color={u.bad ? C.warn : C.t2} weight={500} />
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

const Empty = ({ text }: { text: string }) => (
  <div style={{ padding: '22px 0', font: `400 12.5px/1.5 ${FONT.text}`, color: 'rgba(255,255,255,0.5)' }}>{text}</div>
);
