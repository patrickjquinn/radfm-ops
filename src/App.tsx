import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BG, C, FONT, LINE, dot } from './theme';
import { Icon, type IconName } from './icons';
import { useAdminMe, useSession, getJwt, setJwt } from './lib/api';
import { useHealth } from './lib/health';
import type { Scenario } from './lib/fixtures';

import Overview from './views/Overview';
import Traffic from './views/Traffic';
import Logs from './views/Logs';
import Rad from './views/Rad';
import Recs from './views/Recs';
import Users from './views/Users';
import Stations from './views/Stations';
import Config from './views/Config';
import Audit from './views/Audit';

export type ViewId = 'overview' | 'traffic' | 'logs' | 'rad' | 'recs' | 'users' | 'stations' | 'config' | 'audit';
export type Range = '6h' | '24h' | '3d' | '7d';

export const RANGE_HOURS: Record<Range, number> = { '6h': 6, '24h': 24, '3d': 72, '7d': 168 };

const TITLES: Record<ViewId, [string, string]> = {
  overview: ['Overview', 'The ten-second answer. Signals are ranked by blast radius, not by recency.'],
  traffic: ['Traffic and 4xx', 'Rate, errors and duration. 4xx leads because the platform’s own error metric excludes it.'],
  logs: ['Logs', 'Warnings grouped by normalised message. Errors are the smaller half of the problem.'],
  rad: ['Rad', 'DJ line quality and the upstream providers behind it.'],
  recs: ['Recommendations', 'Pool health and fallback rate. Degradation here is silent by design.'],
  users: ['Users and entitlement', 'Local state and RevenueCat shown side by side. Disagreement is the bug returning.'],
  stations: ['Stations', 'A content browser, not a leaderboard — every station is user-generated and subscriber counts are flat.'],
  config: ['Config', 'What can be changed at runtime, what must go through a PR, and what is deliberately absent.'],
  audit: ['Audit', 'Append-only record of every admin action.']
};

const NAV: { group: string; items: { id: ViewId; label: string; icon: IconName }[] }[] = [
  {
    group: 'Health',
    items: [
      { id: 'overview', label: 'Overview', icon: 'square.grid.2x2' },
      { id: 'traffic', label: 'Traffic & 4xx', icon: 'waveform' },
      { id: 'logs', label: 'Logs', icon: 'line.horizontal.3' }
    ]
  },
  {
    group: 'Domain',
    items: [
      { id: 'rad', label: 'Rad', icon: 'mic.fill' },
      { id: 'recs', label: 'Recommendations', icon: 'dot.radiowaves.left.and.right' }
    ]
  },
  {
    group: 'Operate',
    items: [
      { id: 'users', label: 'Users', icon: 'person.crop.circle' },
      { id: 'stations', label: 'Stations', icon: 'playlist' },
      { id: 'config', label: 'Config', icon: 'slider.horizontal.3' },
      { id: 'audit', label: 'Audit', icon: 'checkmark' }
    ]
  }
];

export type Ctx = {
  view: ViewId;
  go: (v: ViewId) => void;
  range: Range;
  hours: number;
  demo: Scenario | null;
  can: { read: boolean; operate: boolean; administer: boolean };
  ownerTokenExpiresInDays: number | null;
};

export default function App() {
  const qc = useQueryClient();
  const [view, setView] = useState<ViewId>('overview');
  const [range, setRange] = useState<Range>('24h');
  const [jwt, setJwtState] = useState(getJwt());
  const [refreshedAt, setRefreshedAt] = useState(() => Date.now());
  const [, setTick] = useState(0);

  // Demo mode is opt-in via the URL and never a fallback. See lib/fixtures.ts.
  const demo = useMemo<Scenario | null>(() => {
    const p = new URLSearchParams(window.location.search).get('demo');
    return p === 'incident' || p === 'healthy' ? p : null;
  }, []);

  const session = useSession();
  // The Worker's DEV_BACKEND_JWT counts as having a token: gating this purely on a
  // pasted one means local dev can never resolve a role, and every role-gated
  // control stays disabled for a reason that is not the real one.
  const workerHoldsToken =
    session.state === 'ok' && (session.data.ownerTokenForCaller || session.data.devBackendJwt);
  const hasBackendToken = Boolean(jwt) || workerHoldsToken;
  const me = useAdminMe(!demo && hasBackendToken);

  // Relative age only. If this interval never runs the label stays at its
  // initial value, which is visible and correct-at-load — it never blanks.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const ageSec = Math.floor((Date.now() - refreshedAt) / 1000);
  const stale = ageSec > 120;
  const freshLabel =
    ageSec < 5 ? 'Updated just now' : ageSec < 60 ? `Updated ${ageSec}s ago` : `Updated ${Math.floor(ageSec / 60)}m ago`;

  const refresh = () => {
    qc.invalidateQueries();
    setRefreshedAt(Date.now());
  };

  /**
   * Shaped from `can`, exactly as /admin/me returns it — and never from a role
   * baked into a token, because tokens outlive grants. In demo mode the role is
   * owner so every state is reachable for review.
   */
  const can =
    demo
      ? { read: true, operate: true, administer: true }
      : me.state === 'ok'
        ? me.data.can
        : { read: false, operate: false, administer: false };

  const role = demo ? 'owner' : me.state === 'ok' ? me.data.role : null;
  const email = demo ? 'patrick.jm.quinn@gmail.com' : session.state === 'ok' ? session.data.email : '—';

  // Observability retains 3 days — surfaced rather than silently truncated.
  const rangeExceedsRetention = range === '7d';

  const ownerTokenExpiresInDays =
    session.state === 'ok' ? session.data.ownerTokenExpiresInDays : null;
  const ctx: Ctx = { view, go: setView, range, hours: RANGE_HOURS[range], demo, can, ownerTokenExpiresInDays };
  const health = useHealth(RANGE_HOURS[range], demo, ownerTokenExpiresInDays);
  const badges = health.badges;
  const [title, sub] = TITLES[view];

  return (
    <div
      data-shell="1"
      style={{
        display: 'grid',
        gridTemplateColumns: '236px minmax(0,1fr)',
        minHeight: '100vh',
        background: BG.page,
        color: '#fff',
        fontFamily: FONT.text
      }}
    >
      <aside
        data-side="1"
        style={{
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflowY: 'auto',
          borderRight: LINE.edge,
          background: BG.side,
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div style={{ padding: '18px 16px 14px', borderBottom: LINE.edge, display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/assets/rad-logo-128.png" alt="" style={{ width: 26, height: 26, borderRadius: 7, display: 'block', flex: 'none' }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ font: `600 14px/1.2 ${FONT.display}`, letterSpacing: '-0.018em' }}>Rad.FM Ops</div>
            <div style={{ font: `400 10.5px/1.4 ${FONT.mono}`, color: 'rgba(255,255,255,0.38)', letterSpacing: '0.04em' }}>
              {demo ? `demo · ${demo}` : 'production'}
            </div>
          </div>
        </div>

        <nav data-nav="1" style={{ padding: '12px 10px', flex: 1 }} aria-label="Views">
          {NAV.map((g) => (
            <div key={g.group} style={{ display: 'contents' }}>
              <div
                data-navgroup="1"
                style={{
                  font: `600 9.5px/1 ${FONT.text}`,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.3)',
                  padding: '16px 8px 8px'
                }}
              >
                {g.group}
              </div>
              {g.items.map((n) => {
                const on = view === n.id;
                const badge = badges[n.id];
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => setView(n.id)}
                    aria-current={on ? 'page' : undefined}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 9px',
                      cursor: 'pointer',
                      width: '100%',
                      textAlign: 'left',
                      border: 'none',
                      font: `${on ? 500 : 400} 13px/1.3 ${FONT.text}`,
                      marginBottom: 1,
                      borderRadius: on ? '0 6px 6px 0' : 6,
                      background: on ? 'rgba(63,179,166,0.14)' : 'transparent',
                      color: on ? '#fff' : 'rgba(255,255,255,0.62)',
                      boxShadow: on ? `inset 2px 0 0 ${C.ok}` : undefined
                    }}
                  >
                    <span style={{ color: on ? C.ok : 'rgba(255,255,255,0.45)', display: 'flex' }}>
                      <Icon name={n.icon} size={15} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>{n.label}</span>
                    {badge && (
                      <span
                        style={{
                          flex: 'none',
                          padding: '2px 6px',
                          borderRadius: 4,
                          font: `500 10px/1.5 ${FONT.mono}`,
                          fontVariantNumeric: 'tabular-nums',
                          background:
                            badge.kind === 'bad'
                              ? 'rgba(255,98,89,0.16)'
                              : badge.kind === 'warn'
                                ? 'rgba(224,160,48,0.16)'
                                : 'rgba(255,255,255,0.08)',
                          color: badge.kind === 'bad' ? C.bad : badge.kind === 'warn' ? C.warnText : 'rgba(255,255,255,0.55)'
                        }}
                      >
                        {badge.text}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div style={{ padding: '12px 14px 16px', borderTop: LINE.edge }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                background: 'rgba(63,179,166,0.14)',
                border: '1px solid rgba(63,179,166,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                font: `600 10px/1 ${FONT.mono}`,
                color: C.ok,
                flex: 'none'
              }}
            >
              {initials(email)}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  font: `400 11.5px/1.3 ${FONT.text}`,
                  color: 'rgba(255,255,255,0.62)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
                title={email}
              >
                {email}
              </div>
              <div
                style={{
                  font: `600 9.5px/1.4 ${FONT.mono}`,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: role === 'owner' ? C.ok : role === 'operator' ? C.warnText : 'rgba(255,255,255,0.5)'
                }}
              >
                {role ?? 'no role'}
              </div>
            </div>
          </div>
          <div style={{ font: `400 10px/1.5 ${FONT.mono}`, color: 'rgba(255,255,255,0.3)' }}>
            role resolved server-side
            <br />
            per request
          </div>

          {/*
            Not in the prototype, and needed: there is no separate admin login —
            "reuse the existing admin" resolved to reusing the existing user auth,
            so the dashboard carries the operator's own Rad.FM JWT. It lives in
            sessionStorage and dies with the tab.
          */}
          {!demo && me.state !== 'ok' && !workerHoldsToken && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const v = new FormData(e.currentTarget).get('jwt') as string;
                setJwt(v.trim());
                setJwtState(v.trim());
                qc.invalidateQueries();
              }}
              style={{ marginTop: 12 }}
            >
              <label
                htmlFor="jwt"
                style={{ display: 'block', font: `400 10px/1.5 ${FONT.mono}`, color: 'rgba(255,255,255,0.45)', marginBottom: 5 }}
              >
                Rad.FM JWT
              </label>
              <input
                id="jwt"
                name="jwt"
                type="password"
                defaultValue={jwt}
                placeholder="eyJhbGciOi…"
                autoComplete="off"
                style={{
                  width: '100%',
                  height: 28,
                  padding: '0 8px',
                  borderRadius: 6,
                  background: 'rgba(255,255,255,0.045)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#fff',
                  font: `400 11px/1 ${FONT.mono}`
                }}
              />
            </form>
          )}
        </div>
      </aside>

      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 20,
            background: 'rgba(10,12,13,0.92)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            borderBottom: LINE.edge
          }}
        >
          <div
            style={{
              padding: '16px clamp(16px,2.4vw,28px)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 14,
              alignItems: 'flex-start'
            }}
          >
            <div style={{ flex: '1 1 min(100%,320px)', minWidth: 0 }}>
              <h1 style={{ font: `600 20px/1.2 ${FONT.display}`, letterSpacing: '-0.022em', margin: '0 0 5px' }}>{title}</h1>
              <p style={{ font: `400 12.5px/1.5 ${FONT.text}`, color: 'rgba(255,255,255,0.5)', margin: 0, maxWidth: '72ch' }}>
                {sub}
              </p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <div
                role="group"
                aria-label="Time range"
                style={{
                  display: 'flex',
                  gap: 1,
                  padding: 2,
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.05)',
                  border: LINE.edge
                }}
              >
                {(['6h', '24h', '3d', '7d'] as Range[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRange(r)}
                    aria-pressed={range === r}
                    style={{
                      padding: '6px 11px',
                      borderRadius: 6,
                      border: 'none',
                      cursor: 'pointer',
                      font: `500 11.5px/1.2 ${FONT.mono}`,
                      background: range === r ? 'rgba(63,179,166,0.16)' : 'transparent',
                      color: range === r ? C.ok : 'rgba(255,255,255,0.5)'
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={refresh}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  height: 34,
                  padding: '0 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.04)',
                  cursor: 'pointer'
                }}
              >
                <span style={dot(stale ? C.warn : C.ok, !stale)} />
                <span style={{ font: `400 11.5px/1 ${FONT.mono}`, color: 'rgba(255,255,255,0.62)', whiteSpace: 'nowrap' }}>
                  {freshLabel}
                </span>
              </button>
            </div>
          </div>

          {rangeExceedsRetention && (
            <div
              style={{
                padding: '9px clamp(16px,2.4vw,28px)',
                background: 'rgba(224,160,48,0.08)',
                borderTop: '1px solid rgba(224,160,48,0.2)',
                display: 'flex',
                alignItems: 'center',
                gap: 10
              }}
            >
              <span style={{ color: C.warnText, display: 'flex', flex: 'none' }}>
                <Icon name="exclamationmark.triangle" size={13} />
              </span>
              <span style={{ font: `400 12px/1.45 ${FONT.text}`, color: C.warnText }}>
                Workers Observability retains 3 days. Log panels below are capped at 3d regardless of the range selected —
                anything longer needs a rollup into Analytics Engine or D1.
              </span>
            </div>
          )}

          {demo && (
            <div
              style={{
                padding: '9px clamp(16px,2.4vw,28px)',
                background: 'rgba(224,160,48,0.12)',
                borderTop: '1px solid rgba(224,160,48,0.28)',
                font: `500 12px/1.45 ${FONT.text}`,
                color: C.warnText
              }}
            >
              Demo data — every number on this page is a fixture, not the live system.{' '}
              <a href={window.location.pathname}>Switch to live</a>
            </div>
          )}
        </header>

        <main style={{ flex: 1, padding: 'clamp(16px,2.4vw,28px)', minWidth: 0 }}>
          {view === 'overview' && <Overview ctx={ctx} />}
          {view === 'traffic' && <Traffic ctx={ctx} />}
          {view === 'logs' && <Logs ctx={ctx} />}
          {view === 'rad' && <Rad ctx={ctx} />}
          {view === 'recs' && <Recs ctx={ctx} />}
          {view === 'users' && <Users ctx={ctx} />}
          {view === 'stations' && <Stations ctx={ctx} />}
          {view === 'config' && <Config ctx={ctx} />}
          {view === 'audit' && <Audit ctx={ctx} />}
        </main>

        <footer
          style={{
            padding: '14px clamp(16px,2.4vw,28px)',
            borderTop: LINE.edge,
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px 20px',
            alignItems: 'center'
          }}
        >
          <span style={{ font: `400 11px/1.5 ${FONT.mono}`, color: 'rgba(255,255,255,0.3)' }}>
            radfm-ops · read-only · no D1 binding
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ font: `400 11px/1.5 ${FONT.mono}`, color: 'rgba(255,255,255,0.3)' }}>
            {session.state === 'ok' && !session.data.accessConfigured
              ? 'Access NOT configured — dev bypass active'
              : 'Access SSO + admin_users role check'}
          </span>
        </footer>
      </div>
    </div>
  );
}

const initials = (email: string) => {
  const name = email.split('@')[0] ?? '';
  const parts = name.split(/[._-]/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
};
