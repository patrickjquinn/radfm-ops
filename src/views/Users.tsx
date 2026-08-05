import { useState } from 'react';
import type { Ctx } from '../App';
import { BG, C, FONT, LINE } from '../theme';
import { Icon } from '../icons';
import { ActionButton, SectionHead, Source, type Tone, toneColor } from '../components/primitives';
import { useEntitlement, useUserLookup } from '../lib/api';
import * as fx from '../lib/fixtures';

export default function Users({ ctx }: { ctx: Ctx }) {
  const demo = ctx.demo;
  const [term, setTerm] = useState('3');
  const [submitted, setSubmitted] = useState('3');
  // The id whose entitlement is shown. A numeric search sets it directly; an email
  // or RevenueCat id sets it once a match is chosen.
  const [userId, setUserId] = useState('3');

  const isNumeric = /^\d+$/.test(submitted);
  const lookup = useUserLookup(submitted, !demo);
  const ent = useEntitlement(userId, !demo);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const q = term.trim();
          setSubmitted(q);
          if (/^\d+$/.test(q)) setUserId(q);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          height: 44,
          padding: '0 15px',
          borderRadius: 8,
          background: 'rgba(255,255,255,0.045)',
          border: '1px solid rgba(255,255,255,0.1)',
          maxWidth: 520
        }}
      >
        <span style={{ color: 'rgba(255,255,255,0.45)', display: 'flex' }}>
          <Icon name="magnifyingglass" size={15} />
        </span>
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="user id, email or RevenueCat id"
          aria-label="Find a user"
          style={{
            flex: 1,
            minWidth: 0,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            font: `400 13.5px/1 ${FONT.text}`,
            color: 'rgba(255,255,255,0.82)'
          }}
        />
      </form>
      {/*
        A non-numeric search goes through the lookup route, which resolves an email
        or a RevenueCat subscriber id to user ids. Matches are listed rather than
        auto-selected: two accounts sharing an email prefix is exactly the case
        where guessing produces a support answer about the wrong person.
      */}
      {!demo && !isNumeric && submitted.length > 2 && (
        <section>
          <SectionHead title="Matches" meta="admin/users/lookup" />
          <Source data={lookup} what="User lookup">
            {(d) =>
              d.matches.length ? (
                <>
                  {d.matches.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setUserId(String(m.id))}
                      style={{
                        display: 'flex',
                        gap: 14,
                        width: '100%',
                        textAlign: 'left',
                        alignItems: 'baseline',
                        padding: '11px 0',
                        border: 'none',
                        borderBottom: LINE.row,
                        background: String(m.id) === userId ? 'rgba(63,179,166,0.07)' : 'transparent',
                        cursor: 'pointer'
                      }}
                    >
                      <span style={{ width: 72, flex: 'none', font: `400 12px/1.2 ${FONT.mono}`, color: 'rgba(255,255,255,0.6)' }}>
                        user {m.id}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, font: `400 12.5px/1.4 ${FONT.text}`, color: 'rgba(255,255,255,0.85)' }}>
                        {m.email ?? '—'}
                      </span>
                      <span style={{ font: `400 11.5px/1.2 ${FONT.mono}`, color: 'rgba(255,255,255,0.4)' }}>
                        {(m.created_at ?? '').slice(0, 10)}
                      </span>
                    </button>
                  ))}
                </>
              ) : (
                <div style={{ padding: '22px 0', font: `400 12.5px/1.5 ${FONT.text}`, color: 'rgba(255,255,255,0.5)' }}>
                  No user matched that email or RevenueCat id.
                </div>
              )
            }
          </Source>
        </section>
      )}

      {demo ? (
        <EntitlementCard ctx={ctx} data={fx.entitlement(demo)} header={{ title: 'user 3 · patrick.jm.quinn@gmail.com', sub: 'created 2025-11-02 · owner' }} />
      ) : (
        <Source data={ent} what="Entitlement">
          {(d) => <EntitlementCard ctx={ctx} data={shape(d)} header={headerOf(d, userId)} />}
        </Source>
      )}

      <section>
        <SectionHead title="Entitlement audit" meta="premium_audit · append-only" />
        {demo ? (
          <AuditRows rows={fx.entitlement(demo).audit} />
        ) : (
          <Source data={ent} what="Entitlement audit">
            {(d) =>
              // Degrades per field: `meta` or `audit` can be null while the rest
              // succeeds. A null section is not "no entitlement".
              d?.audit == null ? (
                <div style={{ padding: '22px 0', font: `400 12.5px/1.5 ${FONT.text}`, color: C.warnText }}>
                  Audit section came back null. That is per-field degradation, not "no history" — the rest of this page is
                  still valid.
                </div>
              ) : (
                <AuditRows
                  rows={(d.audit ?? []).map((a: any) => ({
                    at: String(a.created_at ?? '').slice(0, 10),
                    action: [a.source, a.entitlement_id].filter(Boolean).join(' · ') || 'entitlement change',
                    source: String(a.source ?? '—')
                  }))}
                />
              )
            }
          </Source>
        )}
      </section>
    </div>
  );
}

function EntitlementCard({
  ctx,
  data,
  header
}: {
  ctx: Ctx;
  data: { drift: boolean; local: { k: string; v: string; tone: Tone }[]; rc: { k: string; v: string; tone: Tone }[] };
  header: { title: string; sub: string };
}) {
  const { drift } = data;
  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.09)', borderRadius: 8, overflow: 'hidden' }}>
      <div
        style={{
          padding: '16px 18px',
          background: BG.card,
          borderBottom: LINE.edge,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center'
        }}
      >
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div style={{ font: `500 14.5px/1.3 ${FONT.text}`, letterSpacing: '-0.01em' }}>{header.title}</div>
          <div style={{ font: `400 11.5px/1.5 ${FONT.mono}`, color: 'rgba(255,255,255,0.4)', marginTop: 3 }}>
            {header.sub}
          </div>
        </div>
        <span
          style={{
            flex: 'none',
            padding: '5px 11px',
            borderRadius: 999,
            font: `600 10px/1.4 ${FONT.text}`,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            background: drift ? 'rgba(255,98,89,0.14)' : 'rgba(63,179,166,0.12)',
            border: `1px solid ${drift ? 'rgba(255,98,89,0.3)' : 'rgba(63,179,166,0.28)'}`,
            color: drift ? C.bad : C.ok
          }}
        >
          {drift ? 'Drift detected' : 'In agreement'}
        </span>
      </div>

      {/*
        Both sides, always. premium_users is a CACHE of RevenueCat that once went
        stale and silently stripped paid segments from live subscribers. A panel
        showing only the local row would confidently display exactly that state.
      */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))',
          gap: 1,
          background: 'rgba(255,255,255,0.08)'
        }}
      >
        <KvBlock title="Local · premium_users" rows={data.local} />
        <KvBlock title="RevenueCat · live" rows={data.rc} />
      </div>

      <div
        style={{
          padding: '13px 18px',
          font: `400 12.5px/1.55 ${FONT.text}`,
          background: drift ? 'rgba(255,98,89,0.07)' : 'rgba(255,255,255,0.02)',
          borderTop: `1px solid ${drift ? 'rgba(255,98,89,0.2)' : 'rgba(255,255,255,0.06)'}`,
          color: drift ? C.t2 : 'rgba(255,255,255,0.5)'
        }}
      >
        {drift
          ? 'Local says premium, RevenueCat says expired, and the cached row is stale against a 300s TTL. This is the incident that silently stripped paid segments from live subscribers — treat the remote answer as truth.'
          : 'premium_users is a cache of RevenueCat, not a source of truth. Both are shown because agreement is the only way to know the cache is sound.'}
      </div>

      <div
        style={{
          padding: '14px 18px',
          background: BG.card,
          borderTop: LINE.edge,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center'
        }}
      >
        <ActionButton label="Force reconcile" allowed={false} why={ctx.can.operate ? 'Phase 4 — writes are not enabled yet' : 'Requires operator'} />
        <ActionButton label="Grant premium" allowed={false} why={ctx.can.administer ? 'Phase 4 — writes are not enabled yet' : 'Requires owner'} />
        <ActionButton label="Revoke premium" allowed={false} why={ctx.can.administer ? 'Phase 4 — writes are not enabled yet' : 'Requires owner'} />
        <span style={{ flex: 1 }} />
        <span style={{ font: `400 11px/1.5 ${FONT.text}`, color: 'rgba(255,255,255,0.35)' }}>
          Mutations are Phase 4 — reads must earn trust first
        </span>
      </div>
    </div>
  );
}

function KvBlock({ title, rows }: { title: string; rows: { k: string; v: string; tone: Tone }[] }) {
  return (
    <div style={{ background: BG.page, padding: '16px 18px' }}>
      <div
        style={{
          font: `600 9.5px/1 ${FONT.text}`,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.42)',
          marginBottom: 12
        }}
      >
        {title}
      </div>
      {rows.map((k) => (
        <div key={k.k} style={{ display: 'flex', gap: 12, padding: '6px 0', alignItems: 'baseline' }}>
          <span style={{ width: 100, flex: 'none', font: `400 11.5px/1.4 ${FONT.mono}`, color: 'rgba(255,255,255,0.42)' }}>
            {k.k}
          </span>
          <span style={{ flex: 1, minWidth: 0, font: `400 12.5px/1.4 ${FONT.mono}`, color: toneColor(k.tone) }}>{k.v}</span>
        </div>
      ))}
    </div>
  );
}

function AuditRows({ rows }: { rows: { at: string; action: string; source: string }[] }) {
  if (!rows.length)
    return (
      <div style={{ padding: '22px 0', font: `400 12.5px/1.5 ${FONT.text}`, color: 'rgba(255,255,255,0.5)' }}>
        No entitlement history for this user.
      </div>
    );
  return (
    <>
      {rows.map((a, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px 14px',
            padding: '11px 0',
            borderBottom: LINE.row,
            alignItems: 'baseline'
          }}
        >
          <span style={{ font: `400 11.5px/1.2 ${FONT.mono}`, color: 'rgba(255,255,255,0.4)', flex: 'none' }}>{a.at}</span>
          <span style={{ flex: '1 1 220px', minWidth: 0, font: `400 12.5px/1.4 ${FONT.text}`, color: 'rgba(255,255,255,0.78)' }}>
            {a.action}
          </span>
          <span style={{ font: `400 11.5px/1.2 ${FONT.mono}`, color: 'rgba(255,255,255,0.45)', flex: 'none' }}>{a.source}</span>
        </div>
      ))}
    </>
  );
}

/* ── shaping the live /admin/users/:id/entitlement response ────────────────── */

function headerOf(d: any, id: string) {
  const u = d?.user ?? {};
  return {
    title: `user ${u.id ?? id}${u.email ? ` · ${u.email}` : ''}`,
    sub: [u.created_at ? `created ${String(u.created_at).slice(0, 10)}` : null].filter(Boolean).join(' · ') || '—'
  };
}

/**
 * The endpoint degrades per field: `meta` or `audit` can be null while the rest
 * succeeds, so each row says "unavailable" on its own rather than the card
 * claiming the user has no entitlement.
 */
function shape(d: any) {
  const premium = d?.premium ?? null;
  const meta = d?.meta ?? null;
  const rc = d?.revenueCat ?? d?.rc ?? null;

  const local: { k: string; v: string; tone: Tone }[] = [
    { k: 'premium', v: premium ? 'true' : 'false', tone: premium ? 'ok' : 'dim' },
    { k: 'since', v: meta?.premium_since ?? (meta === null ? 'unavailable' : '—'), tone: meta === null ? 'warn' : 'dim' },
    { k: 'last_source', v: meta?.last_source ?? (meta === null ? 'unavailable' : '—'), tone: meta === null ? 'warn' : 'dim' },
    { k: 'app_id', v: meta?.app_id ?? '—', tone: 'dim' }
  ];

  const rcRows: { k: string; v: string; tone: Tone }[] = rc
    ? [
        { k: 'entitlement', v: rc.active ? 'active' : 'expired', tone: rc.active ? 'ok' : 'bad' },
        { k: 'expires', v: rc.expires ?? '—', tone: rc.active ? 'dim' : 'bad' },
        { k: 'subscriber', v: meta?.rc_subscriber_id ?? '—', tone: 'dim' },
        { k: 'checked', v: 'live', tone: 'dim' }
      ]
    : [
        // Not "no subscription" — we did not get an answer, and saying otherwise
        // is precisely the failure this panel exists to catch.
        { k: 'entitlement', v: 'unavailable', tone: 'warn' },
        { k: 'expires', v: 'unavailable', tone: 'warn' },
        { k: 'subscriber', v: meta?.rc_subscriber_id ?? '—', tone: 'dim' },
        { k: 'checked', v: 'not returned by /admin', tone: 'warn' }
      ];

  // Drift is only claimed when both sides actually answered.
  const drift = Boolean(rc) && Boolean(premium) !== Boolean(rc.active);
  return { drift, local, rc: rcRows };
}
