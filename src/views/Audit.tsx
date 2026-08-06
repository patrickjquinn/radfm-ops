import type { Ctx } from '../App';
import { C, FONT, LINE } from '../theme';
import { Callout, SectionHead, Source } from '../components/primitives';
import { useAdminAudit } from '../lib/api';
import * as fx from '../lib/fixtures';

export default function Audit({ ctx }: { ctx: Ctx }) {
  const demo = ctx.demo;
  const audit = useAdminAudit(!demo);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Callout tone="neutral">
        Every mutation writes an audit row in the same handler that performs it - actor, action, target, before/after,
        timestamp. That is the whole point of the table.{' '}
        <code style={{ font: `400 12px/1 ${FONT.mono}`, color: '#7BCFC5' }}>admin_audit</code> is append-only.
      </Callout>

      <section>
        <SectionHead title="Admin actions" meta="admin_audit · newest first" />
        <Head />
        {demo ? (
          <Rows rows={fx.auditRows} />
        ) : (
          <Source data={audit} what="Audit trail">
            {(d) => {
              const rows = normalise(d);
              /*
                This used to say "expected: no route performs a mutation yet". That
                stopped being true the moment config writes shipped - the table now
                carries real config.write rows and real cron runs. An empty result
                is no longer the expected state, so it must not be described as one:
                reassuring copy on an append-only audit table is the last place a
                stale claim belongs.
              */
              if (!rows.length)
                return (
                  <div style={{ padding: '22px 0', font: `400 12.5px/1.5 ${FONT.text}`, color: C.warnText, maxWidth: '70ch' }}>
                    No admin actions in this window. Config writes and the reconcile cron both write here, so an empty
                    table means either nothing has happened recently or the rows are not being written - and this view
                    cannot tell those apart. Check the cron card on Overview before concluding it is quiet.
                  </div>
                );
              return <Rows rows={rows} />;
            }}
          </Source>
        )}
      </section>
    </div>
  );
}

/**
 * Actor was a fixed 88px, sized for "user 3". The real column is `actor_email`,
 * so every row rendered an address on top of the action text - unreadable, and on
 * the one screen whose job is to say who did what. Widths now match the data.
 */
const cols = [
  { label: 'When', w: 132 },
  { label: 'Actor', w: 210 },
  { label: 'Action', w: undefined as number | undefined },
  { label: 'Target', w: 150, right: true }
];

function Head() {
  return (
    <div
      style={{
        display: 'flex',
        gap: 14,
        padding: '10px 0',
        borderBottom: LINE.edge,
        font: `600 9.5px/1 ${FONT.text}`,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.5)'
      }}
    >
      {cols.map((c) => (
        <span
          key={c.label}
          style={c.w ? { width: c.w, flex: 'none', textAlign: c.right ? 'right' : 'left' } : { flex: 1, minWidth: 0 }}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

function Rows({ rows }: { rows: { at: string; actor: string; action: string; target: string; tone?: string }[] }) {
  return (
    <>
      {rows.map((a, i) => (
        <div key={i} style={{ display: 'flex', gap: 14, padding: '11px 0', borderBottom: LINE.row, alignItems: 'baseline' }}>
          <span style={{ width: 132, flex: 'none', font: `400 11.5px/1.2 ${FONT.mono}`, color: 'rgba(255,255,255,0.4)' }}>
            {a.at}
          </span>
          <span
            title={a.actor}
            style={{
              width: 210,
              flex: 'none',
              font: `400 11.5px/1.2 ${FONT.mono}`,
              color: 'rgba(255,255,255,0.6)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {a.actor}
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              font: `400 12.5px/1.4 ${FONT.mono}`,
              color: a.tone === 'ok' ? C.ok : a.tone === 'bad' ? C.bad : a.tone === 'dim' ? C.t2 : C.t1
            }}
          >
            {a.action}
          </span>
          <span
            style={{
              width: 150,
              flex: 'none',
              textAlign: 'right',
              font: `400 11.5px/1.2 ${FONT.mono}`,
              color: 'rgba(255,255,255,0.45)'
            }}
          >
            {a.target}
          </span>
        </div>
      ))}
    </>
  );
}

/**
 * `/admin/audit` returns `{ entries: [...] }` with columns
 * `id, actor_id, actor_email, action, target, outcome, created_at`.
 *
 * The other key names are tolerated because this shape is not pinned by a test on
 * either side yet, and an audit view that silently renders empty is worse than
 * one that is slightly permissive - an empty audit trail reads as "nothing has
 * happened", which is the most misleading thing this table could say.
 */
function normalise(d: any) {
  const rows: any[] = Array.isArray(d) ? d : (d?.entries ?? d?.rows ?? d?.audit ?? []);
  return rows.map((r) => ({
    at: String(r.created_at ?? r.at ?? '').replace('T', ' ').slice(0, 16),
    actor: r.actor_email ?? (r.actor_id != null ? `user ${r.actor_id}` : (r.actor ?? 'system')),
    action: String(r.action ?? '-'),
    target: String(r.target ?? '-'),
    tone: r.outcome && r.outcome !== 'ok' ? 'bad' : 'plain'
  }));
}
