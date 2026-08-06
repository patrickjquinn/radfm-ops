import { useState } from 'react';
import type { Ctx } from '../App';
import { BG, C, FONT, LINE } from '../theme';
import { Icon } from '../icons';
import { ActionButton, Prose, SectionHead, Source, type Tone, toneColor } from '../components/primitives';
import { statValue, useAdminStats, useEntitlement, useUserList, useUserLookup } from '../lib/api';
import { STATE } from '../lib/vocabulary';
import * as fx from '../lib/fixtures';

export type UserFilter = 'all' | 'premium' | 'drift' | 'admin';

export default function Users({ ctx }: { ctx: Ctx }) {
  const demo = ctx.demo;
  const [term, setTerm] = useState('');
  const [submitted, setSubmitted] = useState('');
  /**
   * Nothing is selected until someone selects it.
   *
   * This defaulted to '3' - the owner's own id - so the page always rendered a
   * populated entitlement card. That made a missing capability look like a
   * working screen: the design specifies a full directory here, the backend does
   * not serve one, and defaulting to a single hardcoded user hid that completely
   * rather than reporting it.
   */
  const [userId, setUserId] = useState('');
  const [filter, setFilter] = useState<UserFilter>('all');

  const isNumeric = /^\d+$/.test(submitted);
  const canLookup = demo ? true : ctx.can.operate;
  const lookup = useUserLookup(submitted, canLookup, !demo);
  const ent = useEntitlement(userId, !demo && Boolean(userId));
  const stats = useAdminStats(!demo);
  const list = useUserList(filter, !demo);
  // Drift is fetched independently of the visible filter, so the card reports the
  // same number whichever list is on screen. Two counts of one thing disagreeing
  // is the failure this whole product exists to prevent.
  const drift = useUserList('drift', !demo);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <UserStats ctx={ctx} stats={stats} drift={drift} filter={filter} pick={setFilter} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
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
          flex: '1 1 300px',
          minWidth: 0,
          maxWidth: 420
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

        <div style={{ display: 'flex', gap: 1, padding: 2, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: LINE.edge }}>
          {(['drift', 'premium', 'admin', 'all'] as UserFilter[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              aria-pressed={filter === k}
              style={{
                padding: '6px 11px',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                font: `500 11.5px/1.2 ${FONT.mono}`,
                background: filter === k ? 'rgba(63,179,166,0.16)' : 'transparent',
                color: filter === k ? C.ok : C.t3
              }}
            >
              {k === 'drift' ? 'Needs attention' : k === 'admin' ? 'Admins' : k === 'all' ? 'All' : 'Premium'}
            </button>
          ))}
        </div>
      </div>

      <UserList ctx={ctx} list={list} filter={filter} selected={userId} pick={setUserId} />

      {/*
        A non-numeric search goes through the lookup route, which resolves an email
        or a RevenueCat subscriber id to user ids. Matches are listed rather than
        auto-selected: two accounts sharing an email prefix is exactly the case
        where guessing produces a support answer about the wrong person.
      */}
      {/*
        Lookup is operator-level. Prefix search over `users` is a directory walk in
        20-row pages - bulk access to personal data rather than dashboard reading -
        so the role check runs before the query server-side and a viewer cannot
        drive it at all. The client must not even ask: a viewer who did would get a
        bare 404 and no way to tell it from a rate limit or a missing migration.
      */}
      {!demo && !isNumeric && submitted.length > 2 && !canLookup && (
        <div
          style={{
            border: '1px solid rgba(255,255,255,0.09)',
            background: 'rgba(255,255,255,0.02)',
            borderRadius: 8,
            padding: '15px 17px',
            font: `400 12.5px/1.6 ${FONT.text}`,
            color: 'rgba(255,255,255,0.62)',
            maxWidth: '82ch'
          }}
        >
          Searching by email or RevenueCat id requires <strong style={{ fontWeight: 500, color: '#fff' }}>operator</strong>.
          Resolving one user you already have an id for is support work; enumerating the directory is not, so that
          search is a different permission rather than a different result. A numeric user id works at your role.
        </div>
      )}

      {!demo && !isNumeric && submitted.length > 2 && canLookup && (
        <section>
          <SectionHead title="Matches" meta="admin/users/lookup · operator · 20 rows max" />
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
                        {m.email ?? '-'}
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
      ) : userId ? (
        <Source data={ent} what="Entitlement">
          {(d) => <EntitlementCard ctx={ctx} data={shape(d)} header={headerOf(d, userId)} />}
        </Source>
      ) : null}

      {(demo || userId) && (
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
                  Audit section came back null. That is per-field degradation, not "no history" - the rest of this page is
                  still valid.
                </div>
              ) : (
                <AuditRows
                  rows={(d.audit ?? []).map((a: any) => ({
                    at: String(a.created_at ?? '').slice(0, 10),
                    action: [a.source, a.entitlement_id].filter(Boolean).join(' · ') || 'entitlement change',
                    source: String(a.source ?? '-')
                  }))}
                />
              )
            }
          </Source>
        )}
      </section>
      )}
    </div>
  );
}

function EntitlementCard({
  ctx,
  data,
  header
}: {
  ctx: Ctx;
  data: {
    drift: boolean;
    crossChecked?: boolean;
    local: { k: string; v: string; tone: Tone }[];
    rc: { k: string; v: string; tone: Tone }[];
  };
  header: { title: string; sub: string };
}) {
  const { drift } = data;
  // Fixtures predate the flag and do compare both sides, so default to true.
  const crossChecked = data.crossChecked ?? true;
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
            background: !crossChecked
              ? 'rgba(224,160,48,0.14)'
              : drift
                ? 'rgba(255,98,89,0.14)'
                : 'rgba(63,179,166,0.12)',
            border: `1px solid ${
              !crossChecked ? 'rgba(224,160,48,0.3)' : drift ? 'rgba(255,98,89,0.3)' : 'rgba(63,179,166,0.28)'
            }`,
            color: !crossChecked ? C.warnText : drift ? C.bad : C.ok
          }}
        >
          {!crossChecked ? 'Not cross-checked' : drift ? 'Drift detected' : 'In agreement'}
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
        {!crossChecked
          ? 'Only the local row was read. /admin/users/:id/entitlement does not return a RevenueCat answer, so there is nothing to compare it against - this panel cannot currently tell you whether the cache is stale, which is the single thing it exists to detect. The backend needs to add the live lookup.'
          : drift
            ? 'Local says premium, RevenueCat says expired, and the cached row is stale against a 300s TTL. This is the incident that silently stripped paid segments from live subscribers - treat the remote answer as truth.'
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
        <ActionButton label="Force reconcile" allowed={false} why={ctx.can.operate ? 'Phase 4 - writes are not enabled yet' : 'Requires operator'} />
        <ActionButton label="Grant premium" allowed={false} why={ctx.can.administer ? 'Phase 4 - writes are not enabled yet' : 'Requires owner'} />
        <ActionButton label="Revoke premium" allowed={false} why={ctx.can.administer ? 'Phase 4 - writes are not enabled yet' : 'Requires owner'} />
        <span style={{ flex: 1 }} />
        <span style={{ font: `400 11px/1.5 ${FONT.text}`, color: 'rgba(255,255,255,0.35)' }}>
          Mutations are Phase 4 - reads must earn trust first
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
    sub: [u.created_at ? `created ${String(u.created_at).slice(0, 10)}` : null].filter(Boolean).join(' · ') || '-'
  };
}

/**
 * The endpoint degrades per field: `meta` or `audit` can be null while the rest
 * succeeds, so each row says "unavailable" on its own rather than the card
 * claiming the user has no entitlement.
 */
function shape(d: any) {
  // The handler returns `local: { isPremium, grantedAt }`, not a bare `premium`.
  const premium = d?.local?.isPremium ?? null;
  const meta = d?.meta ?? null;
  const rc = d?.revenueCat ?? d?.rc ?? null;

  const local: { k: string; v: string; tone: Tone }[] = [
    { k: 'premium', v: premium ? 'true' : 'false', tone: premium ? 'ok' : 'dim' },
    { k: 'granted', v: d?.local?.grantedAt ?? '-', tone: 'dim' },
    { k: 'since', v: meta?.premium_since ?? (meta === null ? 'unavailable' : '-'), tone: meta === null ? 'warn' : 'dim' },
    { k: 'last_source', v: meta?.last_source ?? (meta === null ? 'unavailable' : '-'), tone: meta === null ? 'warn' : 'dim' },
    { k: 'app_id', v: meta?.app_id ?? '-', tone: 'dim' }
  ];

  const rcRows: { k: string; v: string; tone: Tone }[] = rc
    ? [
        { k: 'entitlement', v: rc.active ? 'active' : 'expired', tone: rc.active ? 'ok' : 'bad' },
        { k: 'expires', v: rc.expires ?? '-', tone: rc.active ? 'dim' : 'bad' },
        { k: 'subscriber', v: meta?.rc_subscriber_id ?? '-', tone: 'dim' },
        { k: 'checked', v: 'live', tone: 'dim' }
      ]
    : [
        // Not "no subscription" - we did not get an answer, and saying otherwise
        // is precisely the failure this panel exists to catch.
        { k: 'entitlement', v: 'unavailable', tone: 'warn' },
        { k: 'expires', v: 'unavailable', tone: 'warn' },
        { k: 'subscriber', v: meta?.rc_subscriber_id ?? '-', tone: 'dim' },
        { k: 'checked', v: 'not returned by /admin', tone: 'warn' }
      ];

  // Drift - and agreement - are only claimed when both sides actually answered.
  // Reporting "in agreement" off a single source is the same mistake as trusting
  // premium_users alone, which is the incident this panel was built for.
  const crossChecked = Boolean(rc);
  const drift = crossChecked && Boolean(premium) !== Boolean(rc.active);
  return { drift, crossChecked, local, rc: rcRows };
}

/**
 * The four counts the design puts at the top, each doubling as a filter.
 *
 * Registered and Premium come from /admin/stats and are real. Drift and Admins
 * cannot be computed without the directory route, so they render as unavailable
 * rather than as 0 - a drift count of zero is the single most reassuring number
 * on this page and it must never be a guess.
 */
function UserStats({
  ctx,
  stats,
  drift,
  filter,
  pick
}: {
  ctx: Ctx;
  stats: ReturnType<typeof useAdminStats>;
  drift: ReturnType<typeof useUserList>;
  filter: UserFilter;
  pick: (f: UserFilter) => void;
}) {
  const d = stats.state === 'ok' ? stats.data : null;
  const users = d ? statValue(d.users) : null;
  const premium = d ? statValue(d.premium) : null;
  const pct = users && premium != null ? `${((premium / users) * 100).toFixed(1)}% of registered` : 'of registered';

  const cards: { label: string; value: string; context: string; tone: Tone; f: UserFilter }[] = [
    {
      label: 'Registered',
      value: users != null ? users.toLocaleString() : 'unavailable',
      context: d?.newUsers7d != null ? `+${d.newUsers7d} in 7d` : 'D1',
      tone: users != null ? 'plain' : 'warn',
      f: 'all'
    },
    {
      label: 'Premium',
      value: premium != null ? premium.toLocaleString() : 'unavailable',
      context: pct,
      tone: premium != null ? 'plain' : 'warn',
      f: 'premium'
    },
    {
      label: 'Entitlement drift',
      /**
       * A real count with its scope attached.
       *
       * Two things could make this number a lie and both are stated rather than
       * hidden. It compares only the rows on the page it fetched, so if the
       * premium set outgrows one page the figure silently narrows - hence
       * reporting how many were actually checked. And it is ONE-DIRECTIONAL: it
       * finds accounts we call premium that RevenueCat denies, never a real
       * subscriber we never marked. That second direction is the one the original
       * incident ran in, which is exactly why a bare 0 here would be dangerous.
       */
      value: drift.state === 'ok' ? String(drift.data.users.length) : drift.state === 'loading' ? '…' : 'unavailable',
      context:
        drift.state === 'ok'
          ? `${drift.data.revenueCatChecked} premium accounts checked${drift.data.cursor != null ? ' (page 1 only)' : ''}`
          : 'could not compare local against RevenueCat',
      tone: drift.state !== 'ok' ? 'warn' : drift.data.users.length > 0 ? 'bad' : 'plain',
      f: 'drift'
    },
    {
      label: 'Admins',
      value: d?.admins != null ? String(d.admins) : 'unavailable',
      context: d?.admins != null ? 'admin_users' : 'not returned by /admin/stats',
      tone: d?.admins != null ? 'plain' : 'warn',
      f: 'admin'
    }
  ];

  if (ctx.demo) return null;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,190px),1fr))',
        gap: 1,
        background: 'rgba(255,255,255,0.08)',
        border: LINE.edge,
        borderRadius: 8,
        overflow: 'hidden'
      }}
    >
      {cards.map((c) => (
        <button
          key={c.label}
          type="button"
          onClick={() => pick(c.f)}
          aria-pressed={filter === c.f}
          style={{
            background: BG.card,
            padding: '16px 18px 18px',
            border: 'none',
            textAlign: 'left',
            cursor: 'pointer',
            boxShadow: filter === c.f ? `inset 0 -2px 0 ${C.ok}` : undefined
          }}
        >
          <div
            style={{
              font: `600 9.5px/1 ${FONT.text}`,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: C.t3,
              marginBottom: 12
            }}
          >
            {c.label}
          </div>
          <div
            style={{
              font: `500 clamp(22px,2.4vw,28px)/1 ${FONT.mono}`,
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.02em',
              color: toneColor(c.tone)
            }}
          >
            {c.value}
          </div>
          <div style={{ font: `400 11px/1.5 ${FONT.text}`, color: C.t3, marginTop: 7 }}>{c.context}</div>
        </button>
      ))}
    </div>
  );
}

/**
 * The directory the design specifies, and the route that would populate it.
 *
 * `/admin/users` 404s on the backend today. Saying so here - naming the route,
 * and naming what does work - is the whole job of this panel until it ships. The
 * alternative, which is what this page did before, is to show a single user and
 * let the operator assume that is all there is.
 */
function UserList({
  ctx,
  list,
  filter,
  selected,
  pick
}: {
  ctx: Ctx;
  list: ReturnType<typeof useUserList>;
  filter: UserFilter;
  selected: string;
  pick: (id: string) => void;
}) {
  if (ctx.demo) return null;
  const title = filter === 'drift' ? 'Needs attention' : filter === 'premium' ? 'Premium users' : filter === 'admin' ? 'Admins' : 'All users';

  return (
    <section>
      <SectionHead title={title} meta="admin/users · D1 + RevenueCat" />
      {/*
        A 404 on /admin/* is usually ambiguous - limiter, role, or migration - and
        reasonText says all three because the API refuses to say which. Here we
        know: every other /admin/* route answers for this same caller at this same
        moment, so it is not the limiter, not the role, and not the migration. The
        route does not exist. Repeating the generic three-cause text would send
        someone to check three things we have already ruled out.
      */}
      {list.state === 'ok' && (
        <div style={{ padding: '11px 0 4px' }}>
          <Prose max={82}>
            {list.data.note ??
              'revenueCat is compared per page only; a null means not compared, not agreement.'}{' '}
            <strong style={{ fontWeight: 500, color: C.warnText }}>
              Drift only finds accounts we call premium that RevenueCat denies.
            </strong>{' '}
            A real subscriber we never marked will not appear here - and that is the direction the original stale-cache
            incident ran in. Check a specific account through search above if you suspect it.
          </Prose>
        </div>
      )}

      {list.state === 'unavailable' && list.reason === 'not_found' ? (
        <div style={{ padding: '18px 0', display: 'flex', flexDirection: 'column', gap: 9, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: C.warnText }}>
            <Icon name="exclamationmark.triangle" size={13} />
            <span style={{ font: `600 10px/1 ${FONT.text}`, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Directory route not built
            </span>
          </div>
          <div style={{ font: `400 12.5px/1.6 ${FONT.text}`, color: C.t2, maxWidth: '78ch' }}>
            The backend does not serve{' '}
            <code style={{ font: `400 12px/1 ${FONT.mono}`, color: C.warnText }}>GET /admin/users</code>. This is not the
            usual ambiguous 404 - every other <code style={{ font: `400 12px/1 ${FONT.mono}`, color: 'rgba(255,255,255,0.7)' }}>/admin/*</code>{' '}
            route answers for this caller right now, so the limiter, your role and migration 0003 are all ruled out.
            <br />
            <br />
            What does work: search above resolves a user by id, email or RevenueCat id, and selecting one shows their
            full entitlement. The counts above come from{' '}
            <code style={{ font: `400 12px/1 ${FONT.mono}`, color: 'rgba(255,255,255,0.7)' }}>/admin/stats</code>. Drift
            and admin counts need this route because both require comparing every row.
          </div>
        </div>
      ) : (
      <Source data={list} what="User directory">
        {(d) =>
          d.users?.length ? (
            <>
              <ListHead />
              {d.users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => pick(String(u.id))}
                  style={{
                    display: 'flex',
                    gap: 14,
                    width: '100%',
                    textAlign: 'left',
                    alignItems: 'baseline',
                    padding: '11px 0',
                    border: 'none',
                    borderBottom: LINE.row,
                    background: String(u.id) === selected ? 'rgba(63,179,166,0.07)' : 'transparent',
                    cursor: 'pointer'
                  }}
                >
                  <span style={{ width: 52, flex: 'none', font: `400 12.5px/1.4 ${FONT.mono}`, color: C.t2 }}>{u.id}</span>
                  <span style={{ flex: 1, minWidth: 0, font: `400 12.5px/1.4 ${FONT.text}`, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {u.email ?? '-'}
                  </span>
                  <Flag w={96} value={u.local} yes="premium" no="free" />
                  <Flag w={96} value={u.revenueCat} yes="active" no="denied" />
                  <span style={{ width: 104, textAlign: 'right', font: `400 12.5px/1.4 ${FONT.mono}`, color: C.t2 }}>
                    {(u.lastActive ?? '-').slice(0, 10)}
                  </span>
                </button>
              ))}
            </>
          ) : (
            <div style={{ padding: '22px 0', font: `400 12.5px/1.5 ${FONT.text}`, color: C.t3 }}>
              No users matched this filter.
            </div>
          )
        }
      </Source>
      )}
    </section>
  );
}

const ListHead = () => (
  <div
    style={{
      display: 'flex',
      gap: 14,
      padding: '10px 0',
      borderBottom: LINE.row,
      font: `600 9.5px/1 ${FONT.text}`,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: C.t3
    }}
  >
    <span style={{ width: 52, flex: 'none' }}>User</span>
    <span style={{ flex: 1, minWidth: 0 }}>Email</span>
    <span style={{ width: 96, textAlign: 'right' }}>Local</span>
    <span style={{ width: 96, textAlign: 'right' }}>RevenueCat</span>
    <span style={{ width: 104, textAlign: 'right' }}>Last active</span>
  </div>
);

/**
 * null is NOT COMPARED, which is not the same as false.
 *
 * The backend returns revenueCat: null on every list row deliberately, so that a
 * cross-check can never mirror its own input and agree with itself. Rendering
 * that null as "free" or "no" would undo the decision and manufacture the exact
 * false agreement the column exists to detect.
 */
const Flag = ({
  w,
  value,
  yes,
  no
}: {
  w: number;
  value: boolean | null | undefined;
  yes: string;
  no: string;
}) => (
  <span
    style={{
      width: w,
      textAlign: 'right',
      font: `400 12.5px/1.4 ${FONT.mono}`,
      color: value == null ? C.t3 : value ? C.ok : C.t2
    }}
  >
    {value == null ? STATE.notChecked : value ? yes : no}
  </span>
);
