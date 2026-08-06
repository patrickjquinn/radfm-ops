import { Hono } from 'hono';
import type { Ctx } from './types';

/**
 * The BFF's entire reason to exist: the Cloudflare API token cannot go in a
 * browser bundle, so something server-side must hold it.
 *
 * Every route here is a NAMED QUERY built on this side. It is deliberately not a
 * generic passthrough — a passthrough that forwards a client-supplied GraphQL
 * document or a client-supplied SQL string hands the browser the full authority
 * of the token, which is the one thing this file exists to prevent.
 *
 * Analytics Engine slot mapping (from the backend's src/lib/analytics.ts):
 *
 *   blob1 = event type ('recs' | 'dj' | 'upstream' | 'play')
 *   dj:    blob2 = style,  blob3 = degeneracyReason
 *   recs:  blob2 = source, double2 = poolSize, double3 = processingMs,
 *          double7 = degraded
 *
 * Blob and double slots are POSITIONAL and Analytics Engine has no schema, so
 * that ordering is a contract: append only, never reorder or repurpose a slot,
 * or every historical row silently changes meaning.
 *
 * Writes are fire-and-forget: an absent datapoint is not proof the event did not
 * happen. Empty results surface as "unverified", never as zero.
 */

const app = new Hono<Ctx>();
const API = 'https://api.cloudflare.com/client/v4';

/** Observability retains 3 days. Anything longer must be rolled up first. */
const RETENTION_HOURS = 72;
export const clampHours = (raw: string | undefined, fallback = 24) => {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, RETENTION_HOURS);
};

type Fail = { ok: false; reason: string; detail?: string };
const fail = (reason: string, detail?: string): Fail => ({ ok: false, reason, detail });

/**
 * Absence of a token is a first-class, named state — not an error to swallow and
 * not a zero to render. The UI turns this into "unavailable", which is the whole
 * point: a dashboard that shows 0 when it means "I could not ask" is worse than
 * one that shows nothing.
 */
function requireToken(env: Ctx['Bindings']) {
  if (!env.CLOUDFLARE_API_TOKEN) return fail('no_token', 'CLOUDFLARE_API_TOKEN is not set on this Worker');
  return null;
}

const auth = (env: Ctx['Bindings']) => ({
  Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
  'Content-Type': 'application/json'
});

async function cfJson(url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    return fail('bad_response', `${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok || body?.success === false) {
    const msg = body?.errors?.map((e: any) => `${e.code} ${e.message}`).join('; ') ?? `HTTP ${res.status}`;
    // 10000 is the error the wrangler OAuth token returns against this API. It
    // is the single most common way to lose an hour here, so name it explicitly.
    const reason = /\b10000\b/.test(msg) ? 'bad_token' : 'api_error';
    return fail(reason, msg);
  }
  return { ok: true, data: body };
}

const ae = (env: Ctx['Bindings'], sql: string) =>
  cfJson(`${API}/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'text/plain' },
    body: sql
  });

const obs = (env: Ctx['Bindings'], body: unknown) =>
  cfJson(`${API}/accounts/${env.CF_ACCOUNT_ID}/workers/observability/telemetry/query`, {
    method: 'POST',
    headers: auth(env),
    body: JSON.stringify(body)
  });

/* ── Traffic: requests, statuses and CPU/wall percentiles ──────────────────── */

app.get('/traffic', async (c) => {
  const gate = requireToken(c.env);
  if (gate) return c.json(gate);

  const hours = clampHours(c.req.query('hours'), 24);
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const until = new Date().toISOString();

  const query = `
    query Traffic($account: String!, $script: String!, $since: Time!, $until: Time!) {
      viewer {
        accounts(filter: { accountTag: $account }) {
          series: workersInvocationsAdaptive(
            limit: 1000
            filter: { scriptName: $script, datetime_geq: $since, datetime_leq: $until }
            orderBy: [datetimeHour_ASC]
          ) {
            dimensions { datetimeHour status }
            sum { requests errors }
            quantiles { cpuTimeP99 wallTimeP99 cpuTimeP50 wallTimeP50 }
          }
        }
      }
    }`;

  const out = await cfJson(`${API}/graphql`, {
    method: 'POST',
    headers: auth(c.env),
    body: JSON.stringify({
      query,
      variables: { account: c.env.CF_ACCOUNT_ID, script: c.env.BACKEND_SCRIPT_NAME, since, until }
    })
  });
  if (out.ok === false) return c.json(out);

  const series = out.data?.data?.viewer?.accounts?.[0]?.series ?? [];
  if (out.data?.errors?.length) {
    return c.json(fail('api_error', out.data.errors.map((e: any) => e.message).join('; ')));
  }
  return c.json({ ok: true, hours, series });
});

/* ── Observability: the 4xx blind spot, warnings, errors ───────────────────── */

/**
 * 4xx by route and status. This is the most important query in the tool: the
 * platform's headline "Errors" counts only 5xx and uncaught exceptions, which is
 * how a total auth outage displayed as "0 Errors" while every user was locked out.
 */
app.get('/status4xx', async (c) => {
  const gate = requireToken(c.env);
  if (gate) return c.json(gate);
  const hours = clampHours(c.req.query('hours'), 24);

  /**
   * TWO queries, and the reason is the whole point of this dashboard.
   *
   * A grouped telemetry query returns a capped number of groups — measured at TEN,
   * regardless of the `limit` sent (tried 100 and 1000) and regardless of window
   * width. Summing those groups therefore does not produce a total; it produces
   * "the sum of ten groups the API chose". That number is not monotonic in the
   * window, which is how the bug surfaced: on one instant, 18h reported 54 and 24h
   * reported 29, reproducibly. A 24h window contains the 18h window, so a real
   * total cannot shrink.
   *
   * So the headline count comes from an UNGROUPED query, which returns one exact
   * aggregate, and the grouped query is used only for the breakdown rows. The
   * breakdown being a top-N is fine and expected; the headline silently being a
   * top-N is the failure this tool exists to catch.
   */
  const base = {
    datasets: ['cloudflare-workers'],
    filters: [
      { key: '$metadata.service', operation: 'eq', value: c.env.BACKEND_SCRIPT_NAME, type: 'string' },
      { key: '$workers.event.response.status', operation: 'gte', value: 400, type: 'number' },
      { key: '$workers.event.response.status', operation: 'lt', value: 500, type: 'number' }
    ],
    calculations: [{ operator: 'count', alias: 'count' }]
  };
  const timeframe = { from: Date.now() - hours * 3600_000, to: Date.now() };

  const [totalOut, groupedOut] = await Promise.all([
    obs(c.env, { queryId: 'radfm-ops-4xx-total', timeframe, limit: 1, parameters: base, view: 'calculations' }),
    obs(c.env, {
      queryId: 'radfm-ops-4xx',
      timeframe,
      limit: 1000,
      parameters: {
        ...base,
        groupBys: [
          { type: 'string', value: '$workers.event.request.path' },
          { type: 'number', value: '$workers.event.response.status' }
        ]
      },
      view: 'calculations'
    })
  ]);
  if (totalOut.ok === false) return c.json(totalOut);
  if (groupedOut.ok === false) return c.json(groupedOut);

  return c.json({
    ok: true,
    hours,
    retentionHours: RETENTION_HOURS,
    rows: fourxxRows(groupedOut.data?.result, exactTotal(totalOut.data?.result))
  });
});

/**
 * The one true count, from the ungrouped query.
 *
 * Returns null rather than 0 when the shape is not what we expect. A zero here
 * would render as "no 4xx", which is precisely the false-healthy reading that
 * this dashboard was built because Cloudflare's own console produced.
 */
export function exactTotal(result: any): number | null {
  const aggregates = result?.calculations?.[0]?.aggregates ?? [];
  if (!aggregates.length) return null;
  const n = Number(aggregates[0]?.value ?? aggregates[0]?.count);
  return Number.isFinite(n) ? n : null;
}

/**
 * Collapse the raw paths into routes.
 *
 * Observability groups on the literal request path, so one route arrives as many
 * rows — `/apple/v1/me/library/playlists/p.9oDKOAatN4QNJbm/tracks` is not a
 * different problem from the same call with another playlist id. Without this the
 * table fragments the real signal across a long tail and every share percentage
 * is computed against the wrong denominator. Same reasoning as the warning
 * normalisation; the design's own mock shows `/stations/art/:key`, already collapsed.
 */
export function normalisePath(p: string): string {
  return (
    p
      .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:uuid')
      .replace(/\/p\.[A-Za-z0-9]+/g, '/:id')
      .replace(/\/\d+/g, '/:id')
      .replace(/\/[A-Za-z0-9_-]{22,}/g, '/:id') || '/'
  );
}

/**
 * @param exact the true count from the ungrouped query, or null if it failed.
 *
 * Shares are computed against `exact`, NOT against the sum of the rows. Dividing
 * by the visible rows makes a truncated breakdown add up to a tidy 100%, which
 * reads as complete and is the most convincing way to be wrong. When the rows do
 * not account for everything, `covered` says so and the view shows the remainder
 * rather than letting it vanish.
 */
export function fourxxRows(result: any, exact: number | null) {
  const aggregates = result?.calculations?.[0]?.aggregates ?? [];
  const byKey = new Map<string, { route: string; status: string; count: number }>();

  for (const g of aggregates) {
    const dims: { key: string; value: any }[] = g.groups ?? [];
    const rawPath = String(dims.find((d) => d.key?.includes('request.path'))?.value ?? '/');
    const status = String(dims.find((d) => d.key?.includes('response.status'))?.value ?? '');
    const route = normalisePath(rawPath);
    const key = `${route}|${status}`;
    const hit = byKey.get(key);
    const n = Number(g.value ?? g.count ?? 0);
    if (hit) hit.count += n;
    else byKey.set(key, { route, status, count: n });
  }

  const rows = [...byKey.values()].sort((a, b) => b.count - a.count);
  const shown = rows.slice(0, 15);
  const accounted = shown.reduce((a, b) => a + b.count, 0);
  // Fall back to the rows only when the exact count is unavailable, and say so via
  // `total === null` rather than quietly presenting a floor as a total.
  const denom = exact ?? accounted;
  return {
    total: exact,
    groups: aggregates.length,
    accounted,
    /** False when the listed routes do not account for every 4xx in the window. */
    covered: exact == null ? false : accounted >= exact,
    // 401 and 429 lead the eye: those are the shapes an auth outage and a limiter
    // storm take, and both are invisible in the platform's own error metric.
    rows: shown.map((r) => ({
      ...r,
      share: denom ? `${((r.count / denom) * 100).toFixed(1)}%` : '—',
      bad: r.status === '401' || r.status === '429'
    }))
  };
}

/**
 * Warnings grouped by normalised message — numbers and hex stripped, matching
 * the backend's scripts/logs.ts. A bug that had disabled setlists for a third of
 * all gigs lived entirely in warnings: 1,094 of them in three days, none of which
 * threw. Normalisation happens here because the telemetry API groups on raw
 * message, which would scatter one bug across a thousand distinct strings.
 */
app.get('/logs', async (c) => {
  const gate = requireToken(c.env);
  if (gate) return c.json(gate);
  const hours = clampHours(c.req.query('hours'), 48);
  const level = c.req.query('level') === 'error' ? 'error' : 'warn';

  const timeframe = { from: Date.now() - hours * 3600_000, to: Date.now() };
  const filters = [
    { key: '$metadata.service', operation: 'eq', value: c.env.BACKEND_SCRIPT_NAME, type: 'string' },
    { key: '$metadata.level', operation: 'eq', value: level, type: 'string' }
  ];

  /**
   * Same two-query shape as /status4xx, for the same reason and a different cause.
   *
   * We must fetch raw EVENTS here rather than an aggregation, because the telemetry
   * API groups on the raw message and the whole value of this panel is normalising
   * first — the setlist failure arrives once per artist name, and collapsing it is
   * what turned dozens of 1-count rows into a single row reading 519 in 24h.
   *
   * But the events view does not return every matching event, and what it returns
   * is not a superset as the window widens: measured on one instant, 12h yielded
   * 30 events and 24h yielded 15. So summing the groups gives a sample size, not a
   * warning count, and it was driving both the nav badge and the >500 threshold.
   *
   * The ungrouped count is exact. The groups stay a breakdown of whatever sample
   * came back, and now say so.
   */
  const [totalOut, out] = await Promise.all([
    obs(c.env, {
      queryId: `radfm-ops-${level}-total`,
      timeframe,
      limit: 1,
      parameters: { datasets: ['cloudflare-workers'], filters, calculations: [{ operator: 'count', alias: 'count' }] },
      view: 'calculations'
    }),
    obs(c.env, {
      queryId: `radfm-ops-${level}`,
      timeframe,
      limit: 1000,
      parameters: { datasets: ['cloudflare-workers'], filters },
      view: 'events'
    })
  ]);
  if (out.ok === false) return c.json(out);

  const events: any[] = out.data?.result?.events?.events ?? out.data?.result?.events ?? [];
  const groups = level === 'warn' ? groupNormalised(events) : null;
  const sampled = groups ? groups.reduce((a, b) => a + b.count, 0) : events.length;
  // A failed count query must not silently become 0 warnings, so it degrades to
  // null and the UI reads it as unavailable rather than as quiet.
  const total = totalOut.ok === false ? null : exactTotal(totalOut.data?.result);

  return c.json({
    ok: true,
    hours,
    level,
    retentionHours: RETENTION_HOURS,
    /** Exact count for the window. Null means unavailable — never render as 0. */
    total,
    /** How many events the breakdown below was actually built from. */
    sampled,
    covered: total == null ? false : sampled >= total,
    groups,
    events: level === 'error' ? events.slice(0, 100).map(toErrorRow) : null
  });
});

/**
 * Numbers and hex, as scripts/logs.ts does — plus quoted literals, which it does
 * not.
 *
 * Verified against live warnings: the setlist lookup failure arrives as
 * `[setlists] last.fm fallback failed for "ursula harrison quartet": ...` once per
 * artist, so a single failure mode occupied twelve of the top twenty rows at one
 * count each while the real story — that this is the biggest source of warnings —
 * was invisible. That is the 1,094-warning bug's exact signature, and the panel
 * exists to make it one row with a big number beside it.
 */
export function normalise(msg: string) {
  return msg
    .replace(/"[^"]*"/g, '"…"')
    .replace(/'[^']*'/g, "'…'")
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/\b\d+(\.\d+)?\b/g, '<n>')
    .trim();
}

/**
 * The message lives at `source.message`, verified against a live response on
 * 5 Aug 2026. The documented-looking `$workers.event.message` does not exist, and
 * reading it produced an empty string for every event — so the warning panel
 * rendered "no warnings" while the window genuinely contained them. That is the
 * precise failure this dashboard exists to prevent, produced by the dashboard.
 * The fallbacks are kept in case the shape shifts again.
 */
export function messageOf(e: any): string {
  return String(e?.source?.message ?? e?.$workers?.event?.message ?? e?.message ?? e?.body ?? '').slice(0, 400);
}

export function groupNormalised(events: any[]) {
  const map = new Map<string, { msg: string; count: number; first: number; last: number }>();
  for (const e of events) {
    const raw = messageOf(e);
    if (!raw) continue;
    const key = normalise(raw);
    const ts = Number(e?.timestamp ?? e?.$metadata?.timestamp ?? 0);
    const hit = map.get(key);
    if (hit) {
      hit.count += 1;
      hit.first = Math.min(hit.first, ts || hit.first);
      hit.last = Math.max(hit.last, ts || hit.last);
    } else {
      map.set(key, { msg: key, count: 1, first: ts, last: ts });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 25);
}

function toErrorRow(e: any) {
  return {
    timestamp: Number(e?.timestamp ?? e?.$metadata?.timestamp ?? 0),
    message: messageOf(e),
    route: String(e?.$workers?.event?.request?.path ?? '')
  };
}

/* ── Analytics Engine ──────────────────────────────────────────────────────── */

/**
 * The day-one confirmation query. Analytics Engine has never been read, so the
 * first job is proving datapoints land at all. If this returns nothing, check the
 * binding is deployed before assuming the code path is cold.
 */
app.get('/ae/probe', async (c) => {
  const gate = requireToken(c.env);
  if (gate) return c.json(gate);
  const out = await ae(
    c.env,
    `SELECT blob1 AS event, count() AS n FROM rad_fm_events
     WHERE timestamp > now() - INTERVAL '1' DAY GROUP BY event`
  );
  if (out.ok === false) return c.json(out);
  return c.json({ ok: true, rows: out.data?.data ?? [] });
});

/** DJ line outcomes. blob3 is degeneracyReason, or 'ok'. */
app.get('/ae/dj', async (c) => {
  const gate = requireToken(c.env);
  if (gate) return c.json(gate);
  const hours = clampHours(c.req.query('hours'), 24);
  const out = await ae(
    c.env,
    `SELECT blob3 AS reason, count() AS n FROM rad_fm_events
     WHERE blob1 = 'dj' AND timestamp > now() - INTERVAL '${hours}' HOUR
     GROUP BY reason ORDER BY n DESC`
  );
  if (out.ok === false) return c.json(out);
  return c.json({ ok: true, rows: groupDjReasons(out.data?.data ?? []) });
});

/**
 * `degeneracyReason` carries its parameters — the live values include
 * `too-short(20w < 24)`, `too-short(18w < 24)`, `wrong-track("a-ha")`. Those are
 * one failure mode each, not six, and left raw they scatter a real regression
 * across a long tail of one-count rows while the share column divides by a
 * meaningless denominator.
 *
 * Stripping the parenthetical is the same normalisation the warning panel applies
 * to log messages, for the same reason: one failure, one row.
 */
export function groupDjReasons(rows: any[]) {
  const byReason = new Map<string, number>();
  for (const r of rows) {
    const reason = String(r.reason ?? 'ok').replace(/\s*\(.*$/, '').trim() || 'ok';
    byReason.set(reason, (byReason.get(reason) ?? 0) + Number(r.n ?? 0));
  }
  return [...byReason.entries()]
    .map(([reason, n]) => ({ reason, n }))
    .sort((a, b) => (a.reason === 'ok' ? -1 : b.reason === 'ok' ? 1 : b.n - a.n));
}

/** Recommendation pool health by source. Degraded climbing means silent fallback. */
app.get('/ae/recs', async (c) => {
  const gate = requireToken(c.env);
  if (gate) return c.json(gate);
  const hours = clampHours(c.req.query('hours'), 24);
  const out = await ae(
    c.env,
    `SELECT blob2 AS source, count() AS n, avg(double2) AS pool,
            avg(double3) AS ms, sum(double7) AS degraded
     FROM rad_fm_events
     WHERE blob1 = 'recs' AND timestamp > now() - INTERVAL '${hours}' HOUR
     GROUP BY source ORDER BY n DESC`
  );
  if (out.ok === false) return c.json(out);

  /**
   * Two things `degraded` cannot tell you, both of which the backend added on
   * 6 Aug and both of which matter more than the degraded rate itself:
   *
   *   1. Requests that returned ZERO tracks. Degraded is the seatbelt; zero is the
   *      crash. Zero-track requests are not flagged degraded, so three of them sat
   *      invisible under a "19 degraded" headline. `double1` is trackCount.
   *   2. WHY the pool collapsed. `blob5` (poolSource) used to be the bare string
   *      `error` for everything. It now separates `error:deadline` (upstreams slow,
   *      expected ~2%, NOT a code fault) from `error:validation` (a caller bug —
   *      the listener gets nothing). Those demand opposite responses.
   *
   * Rows written before the backend's 4fa6f58e still read bare `error`; they are
   * reported as `legacy` rather than bucketed with `error:other`, because "cause
   * unknown" and "cause was other" are different claims.
   */
  const [zero, causes] = await Promise.all([
    ae(
      c.env,
      `SELECT count() AS n FROM rad_fm_events
       WHERE blob1 = 'recs' AND double1 = 0 AND timestamp > now() - INTERVAL '${hours}' HOUR`
    ),
    ae(
      c.env,
      // ONLY the error causes. poolSource also carries the healthy pipeline names
      // (`apple-catalog+reccobeats` and friends), and including them put the
      // successful path at 79.7% of a panel headed "why the pool collapsed" —
      // a table that answers a different question than its title asks.
      `SELECT blob5 AS cause, count() AS n FROM rad_fm_events
       WHERE blob1 = 'recs' AND blob5 LIKE 'error%' AND timestamp > now() - INTERVAL '${hours}' HOUR
       GROUP BY cause ORDER BY n DESC`
    )
  ]);

  return c.json({
    ok: true,
    rows: out.data?.data ?? [],
    zeroTrackRequests: zero.ok === false ? undefined : Number(zero.data?.data?.[0]?.n ?? 0),
    causes:
      causes.ok === false
        ? undefined
        : (causes.data?.data ?? []).map((r: any) => ({
            cause: String(r.cause) === 'error' ? 'legacy' : String(r.cause),
            n: Number(r.n ?? 0)
          }))
  });
});

/**
 * Upstream providers.
 *
 * CAVEAT, carried to the UI rather than hidden: only the `recs` and `dj` slot
 * mappings above are confirmed against a live query. The `upstream` doubles are
 * read from src/lib/analytics.ts and have never been verified against real rows,
 * so the numbers are labelled unconfirmed until someone runs the probe.
 */
app.get('/ae/upstream', async (c) => {
  const gate = requireToken(c.env);
  if (gate) return c.json(gate);
  const hours = clampHours(c.req.query('hours'), 24);
  const out = await ae(
    c.env,
    `SELECT blob2 AS provider, count() AS calls,
            sum(if(blob4 = 'ok', 0, 1)) AS fail,
            avg(double2) AS latency, avg(double1) AS attempts
     FROM rad_fm_events
     WHERE blob1 = 'upstream' AND timestamp > now() - INTERVAL '${hours}' HOUR
     GROUP BY provider ORDER BY calls DESC`
  );
  if (out.ok === false) return c.json(out);
  return c.json({ ok: true, rows: out.data?.data ?? [], slotMappingConfirmed: false });
});

/* ── Deploy history ────────────────────────────────────────────────────────── */

/** Rollback is limited to the 100 most recent versions. */
app.get('/versions', async (c) => {
  const gate = requireToken(c.env);
  if (gate) return c.json(gate);
  const out = await cfJson(
    `${API}/accounts/${c.env.CF_ACCOUNT_ID}/workers/scripts/${c.env.BACKEND_SCRIPT_NAME}/versions`,
    { headers: auth(c.env) }
  );
  if (out.ok === false) return c.json(out);
  return c.json({ ok: true, versions: out.data?.result?.items ?? out.data?.result ?? [] });
});

/**
 * The AI Gateway spend limit, READ rather than asserted.
 *
 * The Config view previously stated "not set" as a literal. A panel that claims
 * the state of a safety control without reading it is worse than no panel — it
 * would keep saying whatever it was written to say after someone turned the
 * control off, which is the false-reassurance failure this whole dashboard was
 * built in response to. The other rows on that panel read from /api/session, and
 * this one now reads from here.
 *
 * Three outcomes, and they are genuinely different:
 *   - a rule exists   → show the budget and window
 *   - none exists     → "no limit set", which is a real finding and shown as one
 *   - could not read  → "unavailable", NEVER collapsed into "no limit set"
 *
 * That last distinction is the entire reason this is a Worker route and not a
 * constant: "there is no limit" and "I could not check whether there is a limit"
 * demand different actions from the operator.
 */
app.get('/ai-gateway', async (c) => {
  const gate = requireToken(c.env);
  if (gate) return c.json(gate);

  const id = c.req.query('id') || 'default';
  const out = await cfJson(`${API}/accounts/${c.env.CF_ACCOUNT_ID}/ai-gateway/gateways/${id}`, {
    headers: auth(c.env)
  });
  if (out.ok === false) return c.json(out);

  const parsed = spendLimit(out.data?.result);
  // When the shape is unreadable, say WHICH keys arrived. Guessing field names
  // across redeploys is the loop this pattern exists to end — it is what turned
  // the AI narrative from four blind deploys into one.
  // Kept: if Cloudflare moves this shape again, the next person gets the answer
  // in one request instead of the four redeploys it took to find it this time.
  const shape =
    parsed.limits == null ? JSON.stringify(out.data?.result?.spend_limits ?? null).slice(0, 300) : undefined;
  return c.json({ ok: true, gateway: id, ...parsed, ...(shape ? { shape } : {}) });
});

/**
 * Pull the spend-limit rules out of a gateway record.
 *
 * The field name is not documented and has moved before, so several spellings
 * are accepted. `limits: null` means "the shape was not what we expected" and is
 * reported as unavailable — deliberately NOT as "no limit", because guessing
 * wrong in that direction invents reassurance.
 */
export function spendLimit(result: any): { limits: { budget: number; window: string; enabled: boolean }[] | null } {
  if (!result || typeof result !== 'object') return { limits: null };

  const raw = result.spend_limits ?? result.spendLimits ?? null;
  if (raw == null) return { limits: [] }; // read fine, carries no rules

  // Recorded live 6 Aug 2026 — an OBJECT, not the array the first guess assumed:
  //   { enabled: true, rules: [{ id, enabled, limitType: 'cost',
  //                              limit: 5, window: 86400, technique: 'sliding' }] }
  const rules = Array.isArray(raw) ? raw : Array.isArray(raw?.rules) ? raw.rules : null;
  if (!rules) return { limits: null };

  // A master switch off means no rule is enforced, however many are listed. A
  // rule shown as active under a disabled feature would be the panel asserting
  // protection that is not running.
  const featureOn = Array.isArray(raw) ? true : raw.enabled !== false;

  return {
    limits: rules.map((r: any) => ({
      budget: Number(r?.limit ?? r?.budget ?? r?.amount ?? 0),
      window: windowLabel(r?.window ?? r?.interval ?? r?.period),
      enabled: featureOn && r?.enabled !== false
    }))
  };
}

/**
 * The window arrives in SECONDS (86400), not as a word. Rendering it raw would
 * put "$5 / 86400" on the panel, which is true and unreadable.
 */
export function windowLabel(w: unknown): string {
  if (typeof w === 'string' && w.trim() && !/^\d+$/.test(w)) return w;
  const n = Number(w);
  if (!Number.isFinite(n) || n <= 0) return 'unknown';
  const named: Record<number, string> = { 60: 'minute', 3600: 'hour', 86_400: 'day', 604_800: 'week' };
  if (named[n]) return named[n];
  if (n % 86_400 === 0) return `${n / 86_400} days`;
  if (n % 3600 === 0) return `${n / 3600} hours`;
  return `${n}s`;
}

export { app as cf };
