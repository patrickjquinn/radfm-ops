import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Every source in this dashboard is fetched into the same three-state shape.
 *
 * `unavailable` is a first-class state, not an error to swallow. The rule that
 * makes this tool trustworthy: when we could not ask, say so. Rendering 0, or a
 * plausible-looking chart, from a source that failed is the worst thing this
 * dashboard could do — it is exactly how a total auth outage displayed as
 * "0 Errors" while every user was locked out.
 */
export type Loaded<T> =
  | { state: 'loading' }
  | { state: 'unavailable'; reason: string; detail?: string }
  | { state: 'ok'; data: T };

/** Reasons the BFF names explicitly, turned into words an operator can act on. */
export const reasonText = (reason: string, detail?: string) => {
  switch (reason) {
    case 'no_token':
      return 'No Cloudflare API token on this Worker. See RUNBOOK §0.2 — this is the one blocking prerequisite.';
    case 'bad_token':
      return 'Cloudflare rejected the token (10000). The wrangler OAuth token does not work against api.cloudflare.com — a real scoped API token is required.';
    case 'no_backend_token':
      return 'This panel reads /admin/* on the Rad.FM backend, which needs a Rad.FM owner token. Paste one into the "Rad.FM JWT" field at the bottom of the sidebar — it is stored in this browser and persists, so this is a one-time step. To stop needing it entirely, set the OPS_BACKEND_JWT secret on the Worker (see README § Owner token).';
    case 'not_found':
      // 404 on /admin/* has THREE causes and the API will not tell you which.
      // Ordered by how likely each is to be the answer in practice — the rate
      // limiter leads because it is the one that makes a working page start
      // failing, which reads as a broken token and sends people down the wrong path.
      return (
        'Backend returned 404, which on /admin/* means one of three things and the API deliberately will not say which: ' +
        'the per-IP admin rate limiter tripped (most likely if this was working a minute ago), ' +
        'your role is below what the route requires, ' +
        'or migration 0003 has not been applied.'
      );
    case 'api_error':
    case 'bad_response':
      return detail ?? 'The upstream API returned an error.';
    default:
      return detail ?? reason;
  }
};

const JWT_KEY = 'radfm.ops.jwt';

/**
 * localStorage, not sessionStorage.
 *
 * sessionStorage was the safer-sounding choice and it was the wrong one: the
 * token died with every tab, so the operator re-pasted an owner credential
 * several times a day. That is not a security win — it is a reason to keep the
 * token somewhere convenient and worse, a reason to stop using the tool.
 *
 * The threat it defended against was someone with the operator's unlocked
 * machine. That person already has their Cloudflare session, which is the key to
 * the whole account. The marginal exposure is close to nil; the friction was not.
 */
export const getJwt = () => localStorage.getItem(JWT_KEY) ?? '';
export const setJwt = (v: string) => {
  if (v) localStorage.setItem(JWT_KEY, v);
  else localStorage.removeItem(JWT_KEY);
};

async function getJson(path: string, init?: RequestInit) {
  const res = await fetch(path, init);
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw Object.assign(new Error('bad_response'), { reason: 'bad_response', detail: text.slice(0, 200) });
  }
  if (!res.ok) {
    const reason = res.status === 404 ? 'not_found' : (body?.error ?? `http_${res.status}`);
    throw Object.assign(new Error(reason), { reason, detail: body?.detail });
  }
  // The BFF reports named failures in-band so a 200 can still mean "could not ask".
  if (body && body.ok === false) {
    throw Object.assign(new Error(body.reason), { reason: body.reason, detail: body.detail });
  }
  return body;
}

const cfGet = (path: string) => getJson(`/api/cf${path}`);
const backendGet = (path: string) =>
  getJson(`/api/backend${path}`, { headers: { 'X-Rad-Jwt': getJwt() } });

/** Wraps a react-query result into the three-state shape the views render. */
function lift<T>(q: { isPending: boolean; error: unknown; data: T | undefined }): Loaded<T> {
  if (q.isPending) return { state: 'loading' };
  if (q.error) {
    const e = q.error as { reason?: string; detail?: string; message?: string };
    return { state: 'unavailable', reason: e.reason ?? e.message ?? 'error', detail: e.detail };
  }
  return { state: 'ok', data: q.data as T };
}

const common = { retry: false, staleTime: 30_000 } as const;

/* ── session ───────────────────────────────────────────────────────────────── */

export type Session = {
  email: string;
  accessConfigured: boolean;
  cfTokenPresent: boolean;
  devBackendJwt: boolean;
  ownerTokenForCaller: boolean;
  /** The proxy is forwarding this caller's Access assertion — the primary identity path. */
  accessForwarding: boolean;
  /** Whether the Workers AI binding is present, and which text model is pinned. */
  aiEnabled: boolean;
  aiModel: string | null;
  ownerTokenExpiresInDays: number | null;
  backendOrigin: string;
  scriptName: string;
  retentionHours: number;
};

export const useSession = () =>
  lift<Session>(useQuery({ queryKey: ['session'], queryFn: () => getJson('/api/session'), ...common }));

/* ── backend /admin/* ──────────────────────────────────────────────────────── */

export type AdminMe = {
  userId: number;
  email: string;
  role: 'viewer' | 'operator' | 'owner';
  can: { read: boolean; operate: boolean; administer: boolean };
};

export const useAdminMe = (enabled = true) =>
  lift<AdminMe>(
    useQuery({ queryKey: ['me'], queryFn: () => backendGet('/admin/me'), enabled, ...common, staleTime: 0 })
  );

/**
 * Field names are the backend's, verified against src/users/routes/admin.ts —
 * `premium`, `plays`, `liked`, NOT premiumUsers/pastPlays/likedSongs.
 *
 * Reading the wrong keys gave `undefined`, which statValue() turns into null,
 * which renders as "unavailable" — so the dashboard reported three counts as
 * unreadable while the backend was returning them perfectly. A false
 * "unavailable" is the same lie as a false zero, just in the other direction,
 * and it is worse here because this tool's entire pitch is that it admits what
 * it could not read. Verify against the handler, not against what reads nicely.
 */
export type AdminStats = {
  users?: number;
  premium?: number;
  premiumPct?: number | null;
  stations?: number;
  plays?: number;
  liked?: number;
  activeUsers24h?: number;
  activeUsers7d?: number;
  newUsers7d?: number;
  dataQuality?: { pastPlaysMissingPlayedAt?: number };
};

export const useAdminStats = (enabled = true) =>
  lift<AdminStats>(
    useQuery({ queryKey: ['stats'], queryFn: () => backendGet('/admin/stats'), enabled, ...common })
  );

export const useAdminAudit = (enabled = true) =>
  lift<{ rows?: any[] } | any[]>(
    useQuery({ queryKey: ['audit'], queryFn: () => backendGet('/admin/audit?limit=50'), enabled, ...common })
  );

export const useEntitlement = (userId: string, enabled: boolean) =>
  lift<any>(
    useQuery({
      queryKey: ['entitlement', userId],
      queryFn: () => backendGet(`/admin/users/${userId}/entitlement`),
      enabled: enabled && /^\d+$/.test(userId),
      ...common
    })
  );

/**
 * `-1` is a QUERY-FAILED SENTINEL in /admin/stats, not a count, and `premiumPct`
 * is null rather than a number derived from one. Both render as "unavailable" —
 * never as 0, and never as "-1".
 */
export const statValue = (n: number | null | undefined): number | null =>
  n === undefined || n === null || n === -1 ? null : n;

/* ── Cloudflare, via the BFF's named queries ───────────────────────────────── */

export const useTraffic = (hours: number) =>
  lift<{ hours: number; series: any[] }>(
    useQuery({ queryKey: ['traffic', hours], queryFn: () => cfGet(`/traffic?hours=${hours}`), ...common })
  );

export type Fourxx = {
  /** Exact count from an ungrouped query. `null` means unavailable — never render it as 0. */
  total: number | null;
  /** How much of `total` the visible rows actually account for. */
  accounted: number;
  /** False when the listed routes do not cover every 4xx in the window. */
  covered: boolean;
  groups: number;
  rows: { route: string; status: string; count: number; share: string; bad: boolean }[];
};

export const useStatus4xx = (hours: number) =>
  lift<{ hours: number; retentionHours: number; rows: Fourxx }>(
    useQuery({ queryKey: ['4xx', hours], queryFn: () => cfGet(`/status4xx?hours=${hours}`), ...common })
  );

export type LogGroup = { msg: string; count: number; first: number; last: number };

export const useLogs = (level: 'warn' | 'error', hours: number) =>
  lift<{
    groups: LogGroup[] | null;
    events: any[] | null;
    retentionHours: number;
    /** Exact count for the window. `null` means unavailable — never render as 0. */
    total: number | null;
    /** How many events the breakdown was built from; the events view returns a sample. */
    sampled: number;
    covered: boolean;
  }>(
    useQuery({
      queryKey: ['logs', level, hours],
      queryFn: () => cfGet(`/logs?level=${level}&hours=${hours}`),
      ...common
    })
  );

export const useAeProbe = () =>
  lift<{ rows: any[] }>(useQuery({ queryKey: ['ae-probe'], queryFn: () => cfGet('/ae/probe'), ...common }));

export const useAeDj = (hours: number) =>
  lift<{ rows: any[] }>(
    useQuery({ queryKey: ['ae-dj', hours], queryFn: () => cfGet(`/ae/dj?hours=${hours}`), ...common })
  );

export const useAeRecs = (hours: number) =>
  lift<{ rows: any[]; zeroTrackRequests?: number; causes?: { cause: string; n: number }[] }>(
    useQuery({ queryKey: ['ae-recs', hours], queryFn: () => cfGet(`/ae/recs?hours=${hours}`), ...common })
  );

export const useAeUpstream = (hours: number) =>
  lift<{ rows: any[]; slotMappingConfirmed: boolean }>(
    useQuery({
      queryKey: ['ae-upstream', hours],
      queryFn: () => cfGet(`/ae/upstream?hours=${hours}`),
      ...common
    })
  );

export const useVersions = () =>
  lift<{ versions: any[] }>(
    useQuery({ queryKey: ['versions'], queryFn: () => cfGet('/versions'), ...common })
  );

/* ── the routes added on 5 Aug 2026 ────────────────────────────────────────── */

/**
 * All four shipped. The interim "route_not_built" inference has been REMOVED
 * deliberately: it turned a 404 into "the backend team has not written this yet",
 * which is now wrong and actively misleading. A 404 here means rate-limited,
 * under-privileged, or migration-missing — and misdiagnosing that is exactly the
 * class of error this dashboard exists to prevent.
 */

export type UserMatch = { id: number; email: string | null; username: string | null; created_at: string | null };

/**
 * Numeric ids resolve directly via the viewer-level entitlement route; email and
 * RevenueCat ids go through lookup, which is **operator**.
 *
 * Prefix search over `users` is a directory walk in 20-row pages — bulk access to
 * personal data rather than dashboard reading. The role check runs before the
 * query server-side, so a viewer cannot drive it at all. The client must not even
 * ask, or a viewer gets a bare 404 and no idea why.
 */
export const useUserLookup = (q: string, canOperate: boolean, enabled: boolean) =>
  lift<{ matches: UserMatch[] }>(
    useQuery({
      queryKey: ['lookup', q],
      queryFn: () => backendGet(`/admin/users/lookup?q=${encodeURIComponent(q)}`),
      enabled: enabled && canOperate && q.length > 2 && !/^\d+$/.test(q),
      ...common
    })
  );

export type Station = {
  id: string;
  name: string;
  mood: string | null;
  genres: string | null;
  created_at: string | null;
  subscribers: number;
  is_user_generated: number;
};

export const useStations = (q: string, enabled: boolean) =>
  lift<{ stations: Station[]; total: number }>(
    useQuery({
      queryKey: ['stations', q],
      queryFn: () => backendGet(`/admin/stations?limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`),
      enabled,
      ...common
    })
  );

export type SetlistFill = {
  fillRate: number;
  sampled: number;
  filled: number;
  windowHours: number;
  cities?: number;
  truncated?: boolean;
  source?: string;
};

export type CronStatus = {
  lastRunAt: string | null;
  outcome?: string;
  rowsReconciled?: number;
  durationMs?: number;
  schedule?: string;
};

/**
 * RevenueCat reconcile status.
 *
 * `lastRunAt: null` means NEVER OBSERVED, not healthy — the backend is explicit
 * about that and the distinction matters here more than most: this cron is the
 * only server-initiated revocation path, and it has been silently misconfigured
 * before. A card that renders null as "fine" would reproduce that exactly.
 */
export const useCron = (enabled: boolean) =>
  lift<CronStatus>(
    useQuery({ queryKey: ['cron'], queryFn: () => backendGet('/admin/metrics/cron'), enabled, ...common })
  );

/**
 * The metric that would have caught the 1,094-warning bug on day one. It sat
 * around 65% while looking healthy, because the failures logged as warnings and
 * warnings are not errors.
 */
export const useSetlistFill = (hours: number, enabled: boolean) =>
  lift<SetlistFill>(
    useQuery({
      queryKey: ['setlists', hours],
      queryFn: () => backendGet(`/admin/metrics/setlists?hours=${hours}`),
      enabled,
      ...common
    })
  );

export type ConfigEntry = {
  key: string;
  value: string | number;
  source: 'kv' | 'default';
  default: string | number;
  location: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
};

export const useConfig = (enabled: boolean) =>
  lift<{ values: ConfigEntry[] }>(
    useQuery({ queryKey: ['config'], queryFn: () => backendGet('/admin/config'), enabled, ...common })
  );

/**
 * Writing a Tier 1 value. The backend must write the `admin_audit` row in the
 * same handler that performs the write — that is the whole point of the table,
 * and a client that writes the audit row separately can fail between the two.
 */
export const useSetConfig = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const res = await fetch(`/api/backend/admin/config/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'X-Rad-Jwt': getJwt(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value })
      });
      const text = await res.text();
      const body = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const reason = res.status === 404 ? 'not_found' : (body?.error ?? `http_${res.status}`);
        throw Object.assign(new Error(reason), { reason, detail: body?.detail });
      }
      return body;
    },
    // The audit view is invalidated too: a write that does not show up there is
    // a write that was not recorded, and seeing it appear is the confirmation.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config'] });
      qc.invalidateQueries({ queryKey: ['audit'] });
    }
  });
};

/* ── Inference ─────────────────────────────────────────────────────────────
 *
 * Both of these degrade to `unavailable` like any other source. That is the whole
 * point: if the model is down the panel says so and every measured panel beside
 * it is untouched, because nothing on this page depends on inference for a number.
 */

const aiPost = (path: string, body: unknown) =>
  getJson(`/api/ai${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

export type Narrative = {
  narrative: string;
  /** Only ids we supplied survive the Worker's filter, so this is safe to render as provenance. */
  citations: string[];
  model: string;
  ms: number;
  neurons: number | null;
};

/**
 * @param signals already-computed by health.ts. The model narrates them; it is
 * never given raw data to aggregate, because a subtly wrong number in fluent
 * prose is harder to catch than an obviously wrong one.
 */
export const useNarrative = (
  signals: { id: string; title: string; evidence: string; metric: string; source: string; sev: string }[],
  verdict: string,
  windowHours: number,
  enabled: boolean
) =>
  lift<Narrative>(
    useQuery({
      // Keyed on the signal ids, so it regenerates when WHAT is open changes and
      // not merely when a count ticks. Narrating the same situation twice costs
      // neurons and gives the operator new prose describing no new fact.
      queryKey: ['ai-narrative', signals.map((s) => s.id).join(','), verdict, windowHours],
      queryFn: () => aiPost('/narrative', { signals, verdict, windowHours }),
      enabled,
      retry: false,
      staleTime: 5 * 60_000
    })
  );

export type ClusterMerge = { members: string[]; total: number };

export const useCluster = (groups: { msg: string; count: number }[] | null, enabled: boolean) =>
  lift<{ merges: ClusterMerge[]; compared: number; model?: string; threshold?: number }>(
    useQuery({
      queryKey: ['ai-cluster', (groups ?? []).map((g) => g.msg).join('|').slice(0, 400)],
      queryFn: () => aiPost('/cluster', { groups }),
      enabled: enabled && Boolean(groups && groups.length > 1),
      retry: false,
      staleTime: 5 * 60_000
    })
  );
