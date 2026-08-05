/**
 * The prototype's Healthy and Incident scenarios, kept verbatim.
 *
 * These drive `?demo=healthy` and `?demo=incident` — nothing else. They exist for
 * two honest reasons and no others:
 *
 *   1. The Cloudflare API token does not exist yet, so live mode legitimately
 *      renders "unavailable" everywhere. Reviewing the design needs data.
 *   2. The Incident scenario is the only way to see the failure-state layouts
 *      without waiting for a real incident.
 *
 * Demo mode is loud about itself — a persistent banner, never the default, never
 * a silent fallback when a live source fails. A dashboard that quietly shows
 * fixtures when it cannot reach the real thing is worse than one that shows
 * nothing, and this whole tool exists because of a metric that lied by omission.
 */

export type Scenario = 'healthy' | 'incident';

export const scaleRows = [
  { label: 'Registered users', value: '631', note: '+13 in 7d' },
  { label: 'Premium', value: '18', note: '2.9%' },
  { label: 'Users with play activity, 24h', value: '15', note: 'not DAU' },
  { label: 'Users with play activity, 7d', value: '44', note: 'not WAU' },
  { label: 'Stations', value: '341', note: '100% user-gen' },
  { label: 'Past plays', value: '34,870', note: 'current state' },
  { label: 'Liked songs', value: '4,507', note: 'all have ISRC' }
];

export const deploys = [
  { id: 'a3f81c2', msg: 'admin rbac + played_at write path', age: '4h', current: true },
  { id: '7b20e94', msg: 'trackPlay instrumentation', age: '1d', current: true },
  { id: 'c19d550', msg: 'otp attempts hardening', age: '3d', current: true },
  { id: 'e884a13', msg: 'setlist enrich concurrency', age: '6d', current: false }
];

export const fourxx = (s: Scenario) =>
  s === 'incident'
    ? [
        { route: '/users/auth/refresh', status: '401', count: 2847, share: '71.2%', bad: true },
        { route: '/users/auth/verify', status: '429', count: 612, share: '15.3%', bad: true },
        { route: '/music/search', status: '404', count: 291, share: '7.3%' },
        { route: '/rad/ask', status: '400', count: 118, share: '3.0%' },
        { route: '/stations/art/:key', status: '404', count: 87, share: '2.2%' },
        { route: '/users/me', status: '401', count: 41, share: '1.0%' }
      ]
    : [
        { route: '/music/search', status: '404', count: 214, share: '46.8%' },
        { route: '/stations/art/:key', status: '404', count: 129, share: '28.2%' },
        { route: '/rad/ask', status: '400', count: 62, share: '13.6%' },
        { route: '/users/auth/verify', status: '429', count: 31, share: '6.8%' },
        { route: '/users/me', status: '401', count: 21, share: '4.6%' }
      ];

export const redStats = (s: Scenario) =>
  s === 'incident'
    ? [
        { label: 'Requests', value: '184k', context: 'vs 176k prior 24h', tone: 'plain' as const },
        { label: '4xx', value: '3,996', context: '2.17% of requests · was 0.26%', tone: 'bad' as const },
        { label: '5xx', value: '0', context: 'this is why 4xx leads', tone: 'plain' as const },
        { label: 'CPU p99', value: '48ms', context: 'vs 44ms prior', tone: 'plain' as const },
        { label: 'Wall p99', value: '890ms', context: 'vs 410ms prior', tone: 'warn' as const }
      ]
    : [
        { label: 'Requests', value: '176k', context: 'vs 171k prior 24h', tone: 'plain' as const },
        { label: '4xx', value: '457', context: '0.26% of requests · flat', tone: 'plain' as const },
        { label: '5xx', value: '0', context: 'this is why 4xx leads', tone: 'plain' as const },
        { label: 'CPU p99', value: '44ms', context: 'vs 45ms prior', tone: 'plain' as const },
        { label: 'Wall p99', value: '410ms', context: 'vs 402ms prior', tone: 'plain' as const }
      ];

/** Deterministic: the prototype's shape, without Math.random making it flicker. */
export const volume = (s: Scenario) =>
  Array.from({ length: 32 }, (_, i) => {
    const base = 60 + Math.round(38 * Math.sin(i / 3.2) + 20 * Math.sin(i / 1.7));
    const errPct = s === 'incident' && i > 19 ? 0.34 + (i - 19) * 0.02 : 0.03;
    const err = Math.round(base * errPct);
    return { total: base, err, ok: base - err, hot: s === 'incident' && i > 19 };
  });

export const warnings = (s: Scenario) =>
  s === 'incident'
    ? [
        { count: 1094, msg: 'setlist enrich failed for gig <n> — falling back to empty', window: 'first 3d ago · last 2m ago', bad: true },
        { count: 318, msg: 'apple music lookup returned no isrc for <n>', window: 'first 3d ago · last 6m ago' },
        { count: 96, msg: 'rate limit near threshold for ip <hex>', window: 'first 2d ago · last 41m ago' },
        { count: 44, msg: 'premium check fell back to cached value', window: 'first 3d ago · last 1h ago' },
        { count: 12, msg: 'reccobeats timeout, retrying', window: 'first 2d ago · last 3h ago' }
      ]
    : [
        { count: 287, msg: 'apple music lookup returned no isrc for <n>', window: 'first 3d ago · last 8m ago' },
        { count: 64, msg: 'setlist enrich failed for gig <n> — falling back to empty', window: 'first 3d ago · last 22m ago' },
        { count: 38, msg: 'rate limit near threshold for ip <hex>', window: 'first 3d ago · last 1h ago' },
        { count: 9, msg: 'reccobeats timeout, retrying', window: 'first 2d ago · last 5h ago' }
      ];

export const errors = [
  { time: '09:44:12Z', msg: 'TypeError: cannot read properties of undefined (reading ‘token’)', route: '/users/auth/refresh' },
  { time: '09:41:58Z', msg: 'D1_ERROR: too many terms in compound SELECT', route: '/admin/stats' },
  { time: '09:22:04Z', msg: 'Error: subrequest budget exceeded', route: '/events/enrich' }
];

export const djReasons = (s: Scenario) =>
  s === 'incident'
    ? [
        { reason: 'ok', n: 4120, share: '82.0%' },
        { reason: 'repetition', n: 512, share: '10.2%' },
        { reason: 'too_short', n: 287, share: '5.7%' },
        { reason: 'banned_phrase', n: 78, share: '1.6%' },
        { reason: 'empty', n: 27, share: '0.5%' }
      ]
    : [
        { reason: 'ok', n: 4712, share: '94.1%' },
        { reason: 'repetition', n: 174, share: '3.5%' },
        { reason: 'too_short', n: 88, share: '1.8%' },
        { reason: 'banned_phrase', n: 24, share: '0.5%' },
        { reason: 'empty', n: 8, share: '0.2%' }
      ];

export const upstream = (s: Scenario) => {
  const inc = s === 'incident';
  return [
    { provider: 'groq · llama-3.3-70b', calls: '3,884', fail: inc ? '214' : '18', p50: inc ? '1,240ms' : '680ms', attempts: inc ? '1.42' : '1.03', bad: inc },
    { provider: 'openai · gpt-4o-mini', calls: '1,140', fail: '6', p50: '910ms', attempts: '1.01', bad: false },
    { provider: 'apple music · catalog', calls: '22,410', fail: '84', p50: '210ms', attempts: '1.00', bad: false },
    { provider: 'reccobeats · features', calls: '8,902', fail: inc ? '412' : '61', p50: '340ms', attempts: inc ? '1.18' : '1.02', bad: inc }
  ];
};

export const recStats = (s: Scenario) => {
  const inc = s === 'incident';
  return [
    { label: 'Sets built', value: '1,284', context: 'last 24h', tone: 'plain' as const },
    { label: 'Degraded', value: inc ? '17.4%' : '2.1%', context: inc ? 'orchestrator falling back' : 'within normal band', tone: inc ? ('warn' as const) : ('plain' as const) },
    { label: 'Pool size avg', value: inc ? '212' : '486', context: inc ? 'below the 400 floor' : 'healthy', tone: inc ? ('warn' as const) : ('plain' as const) },
    { label: 'Processing p50', value: '312ms', context: 'flat vs prior', tone: 'plain' as const }
  ];
};

export const recSources = (s: Scenario) => {
  const inc = s === 'incident';
  return [
    { source: 'library', pool: inc ? '198' : '512', ms: '286', degraded: inc ? '184' : '12', low: inc },
    { source: 'catalog', pool: inc ? '241' : '461', ms: '341', degraded: inc ? '38' : '9', low: inc },
    { source: 'station_seed', pool: '390', ms: '298', degraded: '4', low: false },
    { source: 'ask_rad', pool: '412', ms: '402', degraded: '1', low: false }
  ];
};

export const auditRows = [
  { at: '09:41:02Z', actor: 'user 3', action: 'admin.role.grant', target: 'user 3', tone: 'plain' as const },
  { at: '09:12:44Z', actor: 'system', action: 'revenuecat.reconcile', target: '18 rows', tone: 'dim' as const },
  { at: '03:12:41Z', actor: 'system', action: 'revenuecat.reconcile', target: '18 rows', tone: 'dim' as const },
  { at: 'yesterday', actor: 'user 3', action: 'migration.0003.apply', target: 'RAD_USERS', tone: 'ok' as const },
  { at: 'yesterday', actor: 'user 3', action: 'past_plays.backfill', target: '34,870 rows', tone: 'ok' as const },
  { at: 'yesterday', actor: 'user 3', action: 'admin.bootstrap', target: 'admin_users', tone: 'dim' as const }
];

export const entitlement = (s: Scenario) => {
  const drift = s === 'incident';
  return {
    drift,
    local: [
      { k: 'premium', v: 'true', tone: 'ok' as const },
      { k: 'since', v: '2026-03-14', tone: 'dim' as const },
      { k: 'last_source', v: 'webhook', tone: 'dim' as const },
      { k: 'cache_age', v: drift ? '41h — TTL is 300s' : '112s', tone: drift ? ('warn' as const) : ('dim' as const) }
    ],
    rc: [
      { k: 'entitlement', v: drift ? 'expired' : 'active', tone: drift ? ('bad' as const) : ('ok' as const) },
      { k: 'expires', v: drift ? '2026-08-03' : '2026-09-14', tone: drift ? ('bad' as const) : ('dim' as const) },
      { k: 'subscriber', v: 'rc_1f4a…c2', tone: 'dim' as const },
      { k: 'checked', v: 'live, just now', tone: 'dim' as const }
    ],
    audit: [
      { at: '2026-03-14', action: 'granted via RevenueCat webhook', source: 'webhook' },
      { at: '2026-03-14', action: 'premium_meta written', source: 'webhook' },
      { at: '2026-06-02', action: 'renewal confirmed', source: 'reconcile' },
      { at: '2026-08-03', action: drift ? 'expiry seen upstream, local not updated' : 'renewal confirmed', source: 'reconcile' }
    ]
  };
};

export const signals = (s: Scenario) =>
  s === 'incident'
    ? [
        { title: '4xx spike on /users/auth/refresh', evidence: '401 responses, sustained 42 min. Headline Errors still reads 0 — 4xx is excluded from it.', metric: '2,847', source: 'Observability', sev: 'bad' as const, go: 'traffic' as const },
        { title: 'Setlist fill rate below baseline', evidence: 'Failures log as warnings, so nothing throws and nothing alerts. This is the 1,094-warning bug’s signature.', metric: '62%', source: 'D1 · setlists', sev: 'warn' as const, go: 'logs' as const },
        { title: 'DJ degeneracy rising', evidence: 'Non-ok share up from 6% to 18% over 24h. Guard is rejecting more takes.', metric: '18%', source: 'Analytics Engine', sev: 'warn' as const, go: 'rad' as const },
        { title: 'Analytics Engine never read', evidence: 'Instrumented and writing, but no query has ever confirmed datapoints land. Needs a scoped API token.', metric: 'unverified', source: 'day-one check', sev: 'info' as const, go: 'rad' as const }
      ]
    : [
        { title: 'Analytics Engine never read', evidence: 'Instrumented and writing, but no query has ever confirmed datapoints land. Needs a scoped API token.', metric: 'unverified', source: 'day-one check', sev: 'info' as const, go: 'rad' as const }
      ];

export const tier1 = [
  { key: 'FREE_DAILY_SPEAK', loc: 'src/lib/entitlement/index.ts:34', value: '100' },
  { key: 'PREMIUM_DAILY_SPEAK', loc: 'src/lib/entitlement/index.ts:34', value: '1000' },
  { key: 'PREMIUM_TTL_S', loc: 'src/lib/entitlement/index.ts:22', value: '300' },
  { key: 'MAX_OTP_ATTEMPTS', loc: 'src/users/services/auth/index.ts:125', value: '5' },
  { key: 'MAX_ENRICH', loc: 'src/events/**', value: '25' },
  { key: 'TRANSITION_MIN_WORDS', loc: 'src/rad/constants/index.ts:164', value: '24' }
];

/**
 * Tier 2. These interact — a tuned system, not independent dials, and they are
 * meant to sum sensibly. A slider here produces confident nonsense, so they are
 * shown beside the outcome metrics and changed in code.
 */
export const weights = [
  { name: 'W_ENERGY', value: '0.28' },
  { name: 'W_HARMONIC', value: '0.20' },
  { name: 'W_VALENCE', value: '0.18' },
  { name: 'W_ACOUSTIC', value: '0.17' },
  { name: 'W_TEMPO', value: '0.17' }
];
