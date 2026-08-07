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
import Listening from './views/Listening';
import Cost from './views/Cost';
import Growth from './views/Growth';
import Users from './views/Users';
import Stations from './views/Stations';
import Config from './views/Config';
import Audit from './views/Audit';

export type ViewId =
  | 'overview'
  | 'traffic'
  | 'logs'
  | 'listening'
  | 'growth'
  | 'cost'
  | 'rad'
  | 'recs'
  | 'users'
  | 'stations'
  | 'config'
  | 'audit';
export type Range = '6h' | '24h' | '3d' | '7d' | '30d' | '90d';

export const RANGE_HOURS: Record<Range, number> = {
  '6h': 6,
  '24h': 24,
  '3d': 72,
  '7d': 168,
  '30d': 720,
  '90d': 2160
};

/**
 * The ranges each view can honestly answer, not one set for the whole product.
 *
 * The engineering views read Observability, which retains 3 days, so offering
 * 30d there would be a control that silently returns less than it promises. The
 * data views read D1 and an append-only log where a 6h window is too short to
 * mean anything - Listening was quietly widening 24h to "the last 7 days" and
 * saying so in the panel, which is honest about the result but leaves the
 * control implying a precision it never had.
 *
 * A control that cannot do what it says is worse than a missing control: it is
 * the same failure as a number you cannot stand behind, wearing a button.
 */
const DATA_VIEWS: ViewId[] = ['listening', 'growth', 'cost'];
const ENG_RANGES: Range[] = ['6h', '24h', '3d', '7d'];
const DATA_RANGES: Range[] = ['7d', '30d', '90d'];

/**
 * Views with no time dimension at all, and what they ARE scoped to.
 *
 * The range control rendered on every page. On these four nothing reads
 * `ctx.hours` - they are current-state or newest-first views - so the chips
 * highlighted, the selection persisted, and not one number moved. A control that
 * responds to being clicked and changes nothing is worse than no control: it
 * teaches you that the range does not work, and then you carry that belief onto
 * the pages where it does.
 *
 * They get a label instead of a selector. Stating the window a page is fixed to
 * is more use than an inert widget, and it is the same habit as every other
 * scope note in this product.
 */
const FIXED_SCOPE: Partial<Record<ViewId, string>> = {
  users: 'current state',
  stations: 'current state',
  config: 'current state',
  audit: 'newest first'
};

/**
 * Views where a panel is capped by Workers Observability's 3 day retention, and
 * which panel it is.
 *
 * Logs is not in here because it no longer OFFERS 7d - every panel on it is
 * Observability-backed, so 3d and 7d returned byte-identical numbers and the
 * chip was a control that could not do what it says. Traffic keeps 7d because
 * half of it (volume, CPU, wall) comes from GraphQL analytics and genuinely
 * answers a week; only the 4xx table is capped.
 *
 * The banner used to fire on every engineering view at 7d, which over-warned on
 * Rad and Recommendations - they read Analytics Engine and have no such cap -
 * and taught you to ignore it before you reached a page where it was true.
 */
const RETENTION_CAPPED: Partial<Record<ViewId, string>> = {
  traffic: 'The 4xx table below is capped at 3d; request volume and the percentiles are not.',
  overview: 'The setlist fill rate below is capped at 3d; every other panel here is not.'
};

export const rangesFor = (view: ViewId): Range[] =>
  FIXED_SCOPE[view]
    ? []
    : DATA_VIEWS.includes(view)
      ? DATA_RANGES
      : // Logs is entirely Observability-backed, so a week is not on offer.
        view === 'logs'
        ? (['6h', '24h', '3d'] as Range[])
        : ENG_RANGES;

const TITLES: Record<ViewId, [string, string]> = {
  overview: ['Overview', 'The ten-second answer. Signals are ranked by blast radius, not by recency.'],
  traffic: ['Traffic and 4xx', 'Rate, errors and duration. 4xx leads because the platform’s own error metric excludes it.'],
  logs: ['Logs', 'Warnings grouped by normalised message. Errors are the smaller half of the problem.'],
  listening: [
    'Listening',
    'What people actually played. The only source that can answer this - past_plays overwrites on replay.'
  ],
  growth: ['Growth', 'Signups, activation and subscriptions. Each from the only source that can honestly answer it.'],
  cost: ['Cost', 'What this system costs to run. Two independent estimates per model, because one is a number you have to trust.'],
  rad: ['Rad', 'DJ line quality and the upstream providers behind it.'],
  recs: ['Recommendations', 'Pool health and fallback rate. Degradation here is silent by design.'],
  users: ['Users and entitlement', 'Local state and RevenueCat shown side by side. Disagreement is the bug returning.'],
  stations: ['Stations', 'A content browser, not a leaderboard - every station is user-generated and subscriber counts are flat.'],
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
    // Product questions, not engineering ones. Everything above this group is
    // "is it broken"; this is "is anyone using it, and for what".
    group: 'Data',
    items: [
      { id: 'listening', label: 'Listening', icon: 'chart.bar' },
      { id: 'growth', label: 'Growth', icon: 'chart.line.uptrend' },
      { id: 'cost', label: 'Cost', icon: 'gauge' }
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
  /**
   * Two windows, held separately, because they are two different questions.
   *
   * There was one `range` for both families and a "snap to nearest" rule when
   * you crossed between them. Opening Listening pushed 24h to 7d, and because
   * the nav badges are engineering counts computed over whatever `range` said,
   * Traffic silently went from 149 to 2.1k and Overview grew a red `2` while
   * the Overview page itself still read "Healthy - no signals open". Two counts
   * of the same thing disagreeing on one screen is the exact failure this tool
   * exists to prevent, and it was the shell doing it.
   *
   * Engineering keeps its own window. Data keeps its own. Neither moves the
   * other, so the badges mean one fixed thing no matter where you are standing.
   */
  const [engRange, setEngRange] = useState<Range>('24h');
  const [dataRange, setDataRange] = useState<Range>('7d');
  const [jwt, setJwtState] = useState(getJwt());
  const [refreshedAt, setRefreshedAt] = useState(() => Date.now());
  const [, setTick] = useState(0);

  // Demo mode is opt-in via the URL and never a fallback. See lib/fixtures.ts.
  const demo = useMemo<Scenario | null>(() => {
    const p = new URLSearchParams(window.location.search).get('demo');
    return p === 'incident' || p === 'healthy' ? p : null;
  }, []);

  const session = useSession();
  /**
   * Can the Worker reach /admin/* as this caller, by any route?
   *
   * Access forwarding leads, because it is now the ONLY route in production - the
   * hand-minted owner token has been deleted. When this was gated on a bearer
   * alone, deleting that bearer left every /admin/* panel rendering correctly
   * while the sidebar read NO ROLE and asked for a credential that is no longer
   * needed: /admin/me was the one call never made.
   *
   * DEV_BACKEND_JWT still counts, so local dev resolves a role rather than
   * disabling every role-gated control for a reason that is not the real one.
   */
  const workerHoldsToken =
    session.state === 'ok' &&
    (session.data.accessForwarding || session.data.ownerTokenForCaller || session.data.devBackendJwt);
  const hasBackendToken = Boolean(jwt) || workerHoldsToken;
  const me = useAdminMe(!demo && hasBackendToken);

  // Relative age only. If this interval never runs the label stays at its
  // initial value, which is visible and correct-at-load - it never blanks.
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
   * Shaped from `can`, exactly as /admin/me returns it - and never from a role
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
  const email = demo ? 'patrick.jm.quinn@gmail.com' : session.state === 'ok' ? session.data.email : '-';

  // Observability retains 3 days - surfaced rather than silently truncated.
  // Observability retains 3 days. Only the engineering views read it, so the
  // banner belongs to them - the data views reach further by design.
  const isData = DATA_VIEWS.includes(view);
  // Named per view, so it says which panel is capped rather than "log panels".
  const retentionNote = !isData && engRange === '7d' ? RETENTION_CAPPED[view] : undefined;

  const ownerTokenExpiresInDays =
    session.state === 'ok' ? session.data.ownerTokenExpiresInDays : null;
  /**
   * The window this view is actually showing.
   *
   * Clamped to what the view offers WITHOUT writing back to state: engRange is
   * what the nav badges are counted over, and having a view silently rewrite it
   * on mount is how opening one page used to change every badge on the page.
   * Pick the longest window this view can honestly answer instead.
   */
  const allowed = rangesFor(view);
  const activeRange = isData
    ? dataRange
    : allowed.length === 0 || allowed.includes(engRange)
      ? engRange
      : allowed[allowed.length - 1];
  const ctx: Ctx = {
    view,
    go: setView,
    range: activeRange,
    hours: RANGE_HOURS[activeRange],
    demo,
    can,
    ownerTokenExpiresInDays
  };
  // Always the engineering window, never the data one. A badge that changes
  // meaning because you opened a different page is not a health indicator.
  const health = useHealth(RANGE_HOURS[engRange], demo, ownerTokenExpiresInDays);
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
            <div style={{ font: `400 10.5px/1.4 ${FONT.mono}`, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.04em' }}>
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
                  color: C.t3,
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
          <div style={{ font: `400 10px/1.5 ${FONT.mono}`, color: C.t3 }}>
            role resolved server-side
            <br />
            per request
          </div>

          {/*
            Not in the prototype, and needed: there is no separate admin login -
            "reuse the existing admin" resolved to reusing the existing user auth,
            so the dashboard carries the operator's own Rad.FM JWT. It persists in
            localStorage; see lib/api.ts for why that beat sessionStorage.

            It only appears when the Worker cannot reach /admin/* on the caller's
            behalf, so in the normal deployed case nobody ever sees it.
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
              {/* No selector where there is nothing to select. The scope is stated instead. */}
              {FIXED_SCOPE[view] && (
                <span
                  style={{
                    padding: '7px 11px',
                    borderRadius: 8,
                    border: LINE.edge,
                    background: 'rgba(255,255,255,0.03)',
                    font: `400 11.5px/1.2 ${FONT.mono}`,
                    color: C.t3,
                    whiteSpace: 'nowrap'
                  }}
                >
                  {FIXED_SCOPE[view]}
                </span>
              )}
              {rangesFor(view).length > 0 && (
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
                {rangesFor(view).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => (isData ? setDataRange(r) : setEngRange(r))}
                    aria-pressed={activeRange === r}
                    style={{
                      padding: '6px 11px',
                      borderRadius: 6,
                      border: 'none',
                      cursor: 'pointer',
                      font: `500 11.5px/1.2 ${FONT.mono}`,
                      background: activeRange === r ? 'rgba(63,179,166,0.16)' : 'transparent',
                      color: activeRange === r ? C.ok : C.t3
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
              )}
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

          {retentionNote && (
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
                Workers Observability retains 3 days. {retentionNote} Anything longer needs a rollup into Analytics
                Engine or D1.
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
              Demo data - every number on this page is a fixture, not the live system.{' '}
              <a href={window.location.pathname}>Switch to live</a>
            </div>
          )}
        </header>

        <main style={{ flex: 1, padding: 'clamp(16px,2.4vw,28px)', minWidth: 0 }}>
          {view === 'overview' && <Overview ctx={ctx} />}
          {view === 'traffic' && <Traffic ctx={ctx} />}
          {view === 'logs' && <Logs ctx={ctx} />}
          {view === 'listening' && <Listening ctx={ctx} />}
          {view === 'growth' && <Growth ctx={ctx} />}
          {view === 'cost' && <Cost ctx={ctx} />}
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
          <span style={{ font: `400 11px/1.5 ${FONT.mono}`, color: C.t3 }}>
            radfm-ops · read-only · no D1 binding
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ font: `400 11px/1.5 ${FONT.mono}`, color: C.t3 }}>
            {session.state === 'ok' && !session.data.accessConfigured
              ? 'Access NOT configured - dev bypass active'
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
