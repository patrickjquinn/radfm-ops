import { Hono } from 'hono';
import type { Ctx } from './types';

/**
 * The BFF's entire reason to exist: the Cloudflare API token cannot go in a
 * browser bundle, so something server-side must hold it.
 *
 * Every route here is a NAMED QUERY built on this side. It is deliberately not a
 * generic passthrough - a passthrough that forwards a client-supplied GraphQL
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
 * Absence of a token is a first-class, named state - not an error to swallow and
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
   * A grouped telemetry query returns a capped number of groups - measured at TEN,
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
 * rows - `/apple/v1/me/library/playlists/p.9oDKOAatN4QNJbm/tracks` is not a
 * different problem from the same call with another playlist id. Without this the
 * table fragments the real signal across a long tail and every share percentage
 * is computed against the wrong denominator. Same reasoning as the warning
 * normalisation; the design's own mock shows `/stations/art/:key`, already collapsed.
 */
export function normalisePath(p: string): string {
  return (
    p
      // Drop the query string, encoded or not. Observability records the literal
      // path, and a client that sends `?stationId=` percent-encoded produces
      // `/user/3/stations/add%3FstationId=323` - a distinct row per station id.
      // Two of those were already visible in the live 4xx table as separate
      // routes, which is precisely the fragmentation this function exists to
      // prevent, arriving through a door it was not watching.
      .replace(/(%3[Ff]|\?).*$/, '')
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
      share: denom ? `${((r.count / denom) * 100).toFixed(1)}%` : '-',
      bad: r.status === '401' || r.status === '429'
    }))
  };
}

/**
 * Warnings grouped by normalised message - numbers and hex stripped, matching
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
   * first - the setlist failure arrives once per artist name, and collapsing it is
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
  /**
   * Errors are normalised too. They were not, and there was no reason for it.
   *
   * The warnings panel exists because one failure mode arrived once per artist
   * name and occupied twelve of the top twenty rows at a count of one each. The
   * error path had the identical problem and none of the fix: it returned up to
   * 100 raw lines and the view rendered one row per line, so a single orchestrator
   * fault repeating every few minutes read as a hundred separate incidents and
   * its actual frequency was invisible. That is the more severe level getting the
   * worse treatment.
   *
   * The raw events still ship alongside, because for an error the exact text and
   * the path are what you debug from - the grouping answers "how often", the
   * lines answer "what exactly".
   */
  const groups = groupNormalised(events);
  const sampled = groups.reduce((a, b) => a + b.count, 0);
  // A failed count query must not silently become 0 warnings, so it degrades to
  // null and the UI reads it as unavailable rather than as quiet.
  const total = totalOut.ok === false ? null : exactTotal(totalOut.data?.result);

  return c.json({
    ok: true,
    hours,
    level,
    retentionHours: RETENTION_HOURS,
    /** Exact count for the window. Null means unavailable - never render as 0. */
    total,
    /** How many events the breakdown below was actually built from. */
    sampled,
    covered: total == null ? false : sampled >= total,
    groups,
    events: level === 'error' ? events.slice(0, 100).map(toErrorRow) : null
  });
});

/**
 * Numbers and hex, as scripts/logs.ts does - plus quoted literals, which it does
 * not.
 *
 * Verified against live warnings: the setlist lookup failure arrives as
 * `[setlists] last.fm fallback failed for "ursula harrison quartet": ...` once per
 * artist, so a single failure mode occupied twelve of the top twenty rows at one
 * count each while the real story - that this is the biggest source of warnings -
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
 * reading it produced an empty string for every event - so the warning panel
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

/**
 * Probe a GraphQL analytics dataset and report what came back.
 *
 * GraphQL INTROSPECTION IS DISABLED on Cloudflare's analytics API - `__type` and
 * `__schema` both return empty, for Viewer and for every account type. So the
 * dataset names cannot be discovered, only tried. A wrong name returns an error
 * naming the unknown field, which is more informative than introspection would
 * have been, but only if it is surfaced rather than swallowed.
 *
 * Kept permanently: the next person adding a cost or usage panel needs exactly
 * this, and the alternative is a redeploy per guess.
 */
app.get('/dataset', async (c) => {
  const gate = requireToken(c.env);
  if (gate) return c.json(gate);
  const name = c.req.query('name');
  const fields = c.req.query('fields') ?? 'count';
  if (!name) return c.json(fail('bad_request', 'pass ?name=<dataset>&fields=<selection>'));

  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const res = await cfJson(`${API}/graphql`, {
    method: 'POST',
    headers: auth(c.env),
    body: JSON.stringify({
      query: `query P($a: String!, $since: Time!) {
        viewer { accounts(filter: { accountTag: $a }) {
          rows: ${name}(limit: 20, filter: { datetime_geq: $since }) { ${fields} }
        } }
      }`,
      variables: { a: c.env.CF_ACCOUNT_ID, since }
    })
  });
  if (res.ok === false) return c.json(res);

  const errors = res.data?.errors?.map((e: any) => e.message) ?? [];
  return c.json({
    ok: errors.length === 0,
    dataset: name,
    errors,
    rows: res.data?.data?.viewer?.accounts?.[0]?.rows ?? []
  });
});

/**
 * Who is listening right now, and what Rad is playing them.
 *
 * PER LISTENER, because that is what the product is. Rad.FM is not one
 * broadcast: every user gets their own station and their own AI DJ, built from
 * what they love, skip and replay. There is no single transmission to be on or
 * off, so "is the station on air" is not a question this system can be asked.
 *
 * The question it CAN be asked is how many people are currently being served,
 * and that is the one a control room for this product actually needs. A single
 * listener's station can fail while every other station is fine, and total
 * silence across all listeners means the whole system has stopped.
 *
 * Neither is visible anywhere else in this dashboard: nothing throws when a
 * listener stops being played to.
 */
app.get('/ae/onair', async (c) => {
  const gate = requireToken(c.env);
  if (gate) return c.json(gate);

  /**
   * One query per window rather than conditional aggregation.
   *
   * `count(DISTINCT if(cond, index1, null))` fails: Analytics Engine requires
   * both IF branches to share a type and returns `422 the 2nd and 3rd arguments
   * to IF() must have the same type but instead had String and Null`. Three
   * plain queries are unambiguous, run in parallel, and cost nothing at this
   * cardinality.
   */
  const windows = [
    { key: 'last30m', sql: "30' MINUTE" },
    { key: 'last3h', sql: "3' HOUR" },
    { key: 'last24h', sql: "24' HOUR" }
  ] as const;

  const [w30, w3h, w24h, plays, recent] = await Promise.all([
    ...windows.map((w) =>
      ae(
        c.env,
        `SELECT count(DISTINCT index1) AS n FROM rad_fm_events
         WHERE blob1 = 'play' AND timestamp > now() - INTERVAL '${w.sql}`
      )
    ),
    ae(
      c.env,
      `SELECT count() AS n FROM rad_fm_events
       WHERE blob1 = 'play' AND timestamp > now() - INTERVAL '24' HOUR`
    ),
    ae(
      c.env,
      `SELECT index1 AS listener, blob4 AS artist, blob5 AS title, timestamp
       FROM rad_fm_events WHERE blob1 = 'play' AND timestamp > now() - INTERVAL '3' HOUR
       ORDER BY timestamp DESC LIMIT 12`
    )
  ]);
  // Every query, not just the first. A silent partial failure here would report
  // zero listeners, which is the exact false zero this panel exists to catch.
  for (const q of [w30, w3h, w24h, plays, recent]) if (q.ok === false) return c.json(q);

  const n = (q: any) => Number(q?.data?.data?.[0]?.n ?? 0);
  const rows = recent.data?.data ?? [];
  const lastAt = rows[0]?.timestamp ? Date.parse(String(rows[0].timestamp).replace(' ', 'T') + 'Z') : null;

  return c.json({
    ok: true,
    listeners: { last30m: n(w30), last3h: n(w3h), last24h: n(w24h) },
    plays24h: n(plays),
    /** Minutes since the last play by ANY listener. Null means none in 3h. */
    quietFor: lastAt ? Math.round((Date.now() - lastAt) / 60_000) : null,
    /**
     * One line per DISTINCT listener, newest first. Showing three consecutive
     * plays from the same person would read as a single station's queue, which
     * is exactly the wrong mental model for a product where everyone has their
     * own.
     */
    nowPlaying: dedupeByListener(rows).slice(0, 4)
  });
});

export function dedupeByListener(rows: any[]) {
  const seen = new Set<string>();
  const out: { listener: string; artist: string; title: string; at: string }[] = [];
  for (const r of rows) {
    const listener = String(r?.listener ?? '');
    if (!listener || seen.has(listener)) continue;
    seen.add(listener);
    out.push({
      listener,
      artist: String(r?.artist ?? ''),
      title: String(r?.title ?? ''),
      at: String(r?.timestamp ?? '')
    });
  }
  return out;
}

/**
 * Activation: when each listener played for the FIRST time.
 *
 * The backend deliberately omitted `firstPlays` from /admin/metrics/growth and
 * said why: `past_plays` is delete-then-inserted on replay, so MIN(created_at)
 * per user is the oldest SURVIVING row and moves every time someone replays a
 * track. It would have rendered as a clean activation curve and been fiction.
 * Refusing to ship it was the right call, and they pointed here instead.
 *
 * The play log can answer it, because it is append-only. Aggregation is done in
 * the Worker rather than in SQL: Analytics Engine has no nested aggregates, so
 * "min per user, then bucket by day" cannot be one query. At this cardinality
 * that costs nothing.
 */
app.get('/ae/activation', async (c) => {
  const gate = requireToken(c.env);
  if (gate) return c.json(gate);
  const days = Math.min(Math.max(Number(c.req.query('days') ?? 30), 1), 90);

  const out = await ae(
    c.env,
    `SELECT index1 AS listener, min(timestamp) AS firstPlay
     FROM rad_fm_events WHERE blob1 = 'play' AND timestamp > now() - INTERVAL '${days}' DAY
     GROUP BY listener`
  );
  if (out.ok === false) return c.json(out);
  return c.json({ ok: true, days, byDay: bucketFirstPlays(out.data?.data ?? []) });
});

/**
 * One row per day with the number of listeners whose first play landed on it.
 *
 * "First" is only first WITHIN THE WINDOW. A listener active before it looks
 * like a new activation the moment the window slides past their real first play,
 * so the caller has to state the window - which the view does.
 */
export function bucketFirstPlays(rows: any[]): { day: string; activated: number }[] {
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const day = String(r?.firstPlay ?? '').slice(0, 10);
    if (!day) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return [...byDay.entries()].map(([day, activated]) => ({ day, activated })).sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Station artwork generations, with the cost the backend estimates per image.
 *
 * AI Gateway prices by token, so image models report $0 however many calls are
 * made - not free, NOT COUNTED. The backend now writes this event with its own
 * estimate so the spend is countable here rather than waiting for the gateway.
 */
app.get('/ae/artwork', async (c) => {
  const gate = requireToken(c.env);
  if (gate) return c.json(gate);
  const days = Math.min(Math.max(Number(c.req.query('days') ?? 30), 1), 90);
  const out = await ae(
    c.env,
    `SELECT count() AS images, sum(double1) AS cost
     FROM rad_fm_events WHERE blob1 = 'artwork' AND timestamp > now() - INTERVAL '${days}' DAY`
  );
  if (out.ok === false) return c.json(out);
  const row = out.data?.data?.[0] ?? null;
  return c.json({
    ok: true,
    days,
    images: Number(row?.images ?? 0),
    cost: Number(row?.cost ?? 0)
  });
});

/**
 * Published per-token rates for the models this system actually calls.
 *
 * TRANSCRIBED, not read. Same status as the scoring weights: a rate here can
 * drift the moment a provider changes their price list, and nothing will tell
 * us. Every figure derived from this table is labelled as an independent
 * estimate rather than as billing.
 *
 * It exists because AI Gateway's own `cost` is documented as "best-effort
 * estimation... refer to your provider's dashboard for exact billing amounts".
 * One estimate is a number you have to trust. Two estimates that agree is
 * evidence, and two that disagree is a finding - which is the same reason the
 * entitlement panel shows local and RevenueCat side by side.
 *
 * Verified 6 Aug 2026 against each provider's own documentation.
 */
export const MODEL_RATES: Record<string, { in: number; out: number; cached?: number; source: string }> = {
  // console.groq.com/docs/model/openai/gpt-oss-120b
  'openai/gpt-oss-120b': { in: 0.15, out: 0.6, cached: 0.075, source: 'Groq' },
  // console.groq.com/docs/model/openai/gpt-oss-20b
  'openai/gpt-oss-20b': { in: 0.075, out: 0.3, cached: 0.037, source: 'Groq' },
  // developers.cloudflare.com/workers-ai/platform/pricing
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { in: 0.293, out: 2.253, source: 'Workers AI' },
  '@cf/baai/bge-m3': { in: 0.012, out: 0, source: 'Workers AI' },
  '@cf/zai-org/glm-4.7-flash': { in: 0.06, out: 0.4, source: 'Workers AI' }
};

/**
 * Models billed PER IMAGE, not per token.
 *
 * The gateway's cost model is token-based, so for these it reports $0 however
 * many calls are made. A dashboard that totals that column and calls it "spend"
 * is understating by an unknown amount - and image generation is expensive
 * enough that it can be the largest line while reading as free.
 */
const PER_IMAGE_MODELS = /image|dall-e|flux|stable-diffusion/i;

export function priceModel(model: string, tokensIn: number, tokensOut: number) {
  const rate = MODEL_RATES[model];
  if (!rate) return { computed: null as number | null, rate: null };
  return {
    // Deliberately priced at the UNCACHED input rate. Cached tokens are cheaper
    // and we cannot see how many were cached, so this is an upper bound - which
    // is the safe direction for a cost estimate to be wrong in.
    computed: (tokensIn / 1e6) * rate.in + (tokensOut / 1e6) * rate.out,
    rate
  };
}

/**
 * What this system costs to run, per model, with two independent estimates.
 */
app.get('/cost', async (c) => {
  const gate = requireToken(c.env);
  if (gate) return c.json(gate);
  const hours = Math.min(Math.max(Number(c.req.query('hours') ?? 24), 1), 720);
  const since = new Date(Date.now() - hours * 3600_000).toISOString();

  const out = await cfJson(`${API}/graphql`, {
    method: 'POST',
    headers: auth(c.env),
    body: JSON.stringify({
      query: `query Cost($a: String!, $since: Time!) {
        viewer { accounts(filter: { accountTag: $a }) {
          ai: aiGatewayRequestsAdaptiveGroups(limit: 100, filter: { datetime_geq: $since }) {
            count
            dimensions { gateway model provider }
            sum { tokensIn tokensOut cost }
          }
        } }
      }`,
      variables: { a: c.env.CF_ACCOUNT_ID, since }
    })
  });
  if (out.ok === false) return c.json(out);
  const errors = out.data?.errors?.map((e: any) => e.message) ?? [];
  if (errors.length) return c.json(fail('api_error', errors.join('; ')));

  return c.json({ ok: true, hours, models: costRows(out.data?.data?.viewer?.accounts?.[0]?.ai ?? []) });
});

export function costRows(rows: any[]) {
  return rows
    .map((r: any) => {
      const model = String(r?.dimensions?.model ?? 'unknown');
      const tokensIn = Number(r?.sum?.tokensIn ?? 0);
      const tokensOut = Number(r?.sum?.tokensOut ?? 0);
      const reported = Number(r?.sum?.cost ?? 0);
      const { computed, rate } = priceModel(model, tokensIn, tokensOut);
      const perImage = PER_IMAGE_MODELS.test(model);
      return {
        model,
        provider: String(r?.dimensions?.provider ?? '-'),
        gateway: String(r?.dimensions?.gateway ?? '-'),
        requests: Number(r?.count ?? 0),
        tokensIn,
        tokensOut,
        reported,
        computed,
        rateSource: rate?.source ?? null,
        /**
         * The gateway prices by token, so a per-image model reports 0 no matter
         * how many calls were made. That is not "free", it is "not counted", and
         * conflating them is how a cost dashboard understates without ever
         * looking wrong.
         */
        unpriced: perImage && reported === 0,
        perImage
      };
    })
    .sort((a, b) => Math.max(b.reported, b.computed ?? 0) - Math.max(a.reported, a.computed ?? 0));
}

/**
 * Listening, from the append-only play log.
 *
 * This is the ONLY source that can answer historical questions about listening.
 * `past_plays` in D1 cannot: its primary key collapses to (user_id, song), so a
 * replay overwrites rather than appends. It is current state wearing a log's
 * clothes, which is why the Scale panel labels its counts "current state" and
 * why 24h activity is explicitly NOT called DAU.
 *
 * blobs [play, trackId, isrc, artist, title], doubles [1], index = userId. One
 * row per play, so count() is the play count and count(DISTINCT index1) is
 * listeners. `uniq()` is NOT in the Analytics Engine SQL subset - it returns
 * `422 unknown function call: UNIQ` - and neither is `toDate()`; bucketing uses
 * `toStartOfDay()`.
 *
 * History starts at the deploy date and CANNOT be backfilled - the events were
 * never recorded anywhere before. Any window that predates it is genuinely empty
 * rather than quiet, and the UI has to say which.
 */
app.get('/ae/plays', async (c) => {
  const gate = requireToken(c.env);
  if (gate) return c.json(gate);
  const days = Math.min(Math.max(Number(c.req.query('days') ?? 30), 1), 90);

  const [totals, daily, artists, tracks] = await Promise.all([
    ae(
      c.env,
      `SELECT count() AS plays, count(DISTINCT index1) AS listeners, count(DISTINCT blob2) AS tracks
       FROM rad_fm_events WHERE blob1 = 'play' AND timestamp > now() - INTERVAL '${days}' DAY`
    ),
    ae(
      c.env,
      `SELECT toStartOfDay(timestamp) AS day, count() AS plays, count(DISTINCT index1) AS listeners
       FROM rad_fm_events WHERE blob1 = 'play' AND timestamp > now() - INTERVAL '${days}' DAY
       GROUP BY day ORDER BY day`
    ),
    ae(
      c.env,
      `SELECT blob4 AS artist, count() AS plays, count(DISTINCT index1) AS listeners
       FROM rad_fm_events WHERE blob1 = 'play' AND blob4 != '' AND timestamp > now() - INTERVAL '${days}' DAY
       GROUP BY artist ORDER BY plays DESC LIMIT 15`
    ),
    ae(
      c.env,
      `SELECT blob5 AS title, blob4 AS artist, count() AS plays
       FROM rad_fm_events WHERE blob1 = 'play' AND blob5 != '' AND timestamp > now() - INTERVAL '${days}' DAY
       GROUP BY title, artist ORDER BY plays DESC LIMIT 15`
    )
  ]);
  for (const q of [totals, daily, artists, tracks]) if (q.ok === false) return c.json(q);

  return c.json({
    ok: true,
    days,
    totals: totals.data?.data?.[0] ?? null,
    daily: daily.data?.data ?? [],
    artists: artists.data?.data ?? [],
    tracks: tracks.data?.data ?? []
  });
});

/** DJ line outcomes. blob3 is degeneracyReason, or 'ok'. */
app.get('/ae/dj', async (c) => {
  const gate = requireToken(c.env);
  if (gate) return c.json(gate);
  const hours = clampHours(c.req.query('hours'), 24);
  /**
   * `fellBack` is the only DJ number with direct listener impact.
   *
   * The guard rejecting a take costs nothing if the retry succeeds - the listener
   * hears a good line either way. `fellBack` means it was rejected TWICE and the
   * listener got a stock line instead. Ranking by rejection volume points at the
   * wrong thing, and the backend proved it over three days:
   *
   *   simile   43 rejections, 0 reached a listener
   *   stutter   4 rejections, 4 reached a listener - every one
   *
   * Simile is ten times the volume and harmless. Stutter was rare and fell back
   * 100% of the time, because it was rejecting SONG TITLES - "Gone Gone Gone",
   * "Easy Easy" - and the retry has to announce the same record, so it tripped
   * identically and fell through to stock every time. This panel showed simile at
   * the top and stutter near the bottom, which is exactly backwards.
   *
   * double3 = regenerated, double4 = fellBack, appended 6 Aug as new positional
   * slots so historical rows keep their meaning. Rows written before then have
   * 0 in both, which is indistinguishable from "did not fall back" - hence the
   * coverage note the view renders.
   */
  const out = await ae(
    c.env,
    `SELECT blob3 AS reason, count() AS n,
            sum(double3) AS regenerated, sum(double4) AS fellBack
     FROM rad_fm_events
     WHERE blob1 = 'dj' AND timestamp > now() - INTERVAL '${hours}' HOUR
     GROUP BY reason ORDER BY n DESC`
  );
  if (out.ok === false) return c.json(out);
  return c.json({ ok: true, rows: groupDjReasons(out.data?.data ?? []) });
});

/**
 * What Rad actually said, which until 6 Aug could not be answered at all.
 *
 * `trackDjLine` recorded `textLength` - a number - so the only record of the
 * words was the RAD_SAYS KV, which caps at 10 entries per session and shifts the
 * oldest off: measured across three days it held 184 of 579 lines, 32%. The
 * other 395 were simply gone. blob4 is the line itself and has no per-key cap.
 *
 * `/ai/text` is deliberately NOT instrumented - it is the internal
 * character-judging harness, and hundreds of synthetic lines go through it. A
 * count that looks low against request volume is that, not a gap.
 */
app.get('/ae/dj-lines', async (c) => {
  const gate = requireToken(c.env);
  if (gate) return c.json(gate);
  const hours = clampHours(c.req.query('hours'), 24);
  const out = await ae(
    c.env,
    `SELECT blob4 AS text, blob2 AS style, blob3 AS reason,
            double4 AS fellBack, double1 AS len, timestamp
     FROM rad_fm_events
     WHERE blob1 = 'dj' AND blob4 != ''
       AND timestamp > now() - INTERVAL '${hours}' HOUR
     ORDER BY timestamp DESC
     LIMIT 30`
  );
  if (out.ok === false) return c.json(out);
  const rows = (out.data?.data ?? []).map((r: any) => ({
    text: String(r.text ?? ''),
    style: String(r.style ?? ''),
    // Same normalisation as the grouped panel, so a reason reads identically in
    // both places rather than carrying its parameters in one and not the other.
    reason: String(r.reason ?? 'ok').replace(/\s*\(.*$/, '').trim() || 'ok',
    fellBack: Number(r.fellBack ?? 0) > 0,
    len: Number(r.len ?? 0),
    at: String(r.timestamp ?? '')
  }));
  return c.json({ ok: true, rows });
});

/**
 * `degeneracyReason` carries its parameters - the live values include
 * `too-short(20w < 24)`, `too-short(18w < 24)`, `wrong-track("a-ha")`. Those are
 * one failure mode each, not six, and left raw they scatter a real regression
 * across a long tail of one-count rows while the share column divides by a
 * meaningless denominator.
 *
 * Stripping the parenthetical is the same normalisation the warning panel applies
 * to log messages, for the same reason: one failure, one row.
 */
export function groupDjReasons(rows: any[]) {
  const byReason = new Map<string, { n: number; fellBack: number; regenerated: number }>();
  for (const r of rows) {
    const reason = String(r.reason ?? 'ok').replace(/\s*\(.*$/, '').trim() || 'ok';
    const hit = byReason.get(reason) ?? { n: 0, fellBack: 0, regenerated: 0 };
    hit.n += Number(r.n ?? 0);
    hit.fellBack += Number(r.fellBack ?? 0);
    hit.regenerated += Number(r.regenerated ?? 0);
    byReason.set(reason, hit);
  }
  return (
    [...byReason.entries()]
      .map(([reason, v]) => ({ reason, ...v }))
      /*
        `ok` first, then by LISTENER IMPACT, then by volume.
        
        This sorted by volume alone, which put a 43-rejection reason that reached
        nobody above a 4-rejection reason that reached every listener it touched.
        Ranking is a claim about what matters, and volume was the wrong claim.
      */
      .sort((a, b) =>
        a.reason === 'ok' ? -1 : b.reason === 'ok' ? 1 : b.fellBack - a.fellBack || b.n - a.n
      )
  );
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
   *      expected ~2%, NOT a code fault) from `error:validation` (a caller bug -
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
      // successful path at 79.7% of a panel headed "why the pool collapsed" -
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

  /**
   * Group by the OUTCOME rather than testing it against a guessed success token.
   *
   * This counted `sum(if(blob4 = 'ok', 0, 1)) AS fail`, which assumed the backend
   * writes the literal string 'ok'. It does not, so every call counted as a
   * failure and the panel read "9 calls, 9 fail" for a provider that is plainly
   * working - the DJ produced 210 good lines in the same window on that provider.
   *
   * The slot mapping was never the problem. blobs are [event, provider, model,
   * outcome] and doubles [attempts, latencyMs], exactly as queried. The bug was
   * inventing a value for the outcome field and then reporting the mismatch as
   * a provider failure.
   *
   * So: return the outcomes as they are written. The UI shows what the provider
   * actually reported, which cannot be wrong about a token it never has to guess.
   */
  const out = await ae(
    c.env,
    `SELECT blob2 AS provider, blob4 AS outcome, count() AS calls,
            avg(double2) AS latency, avg(double1) AS attempts
     FROM rad_fm_events
     WHERE blob1 = 'upstream' AND timestamp > now() - INTERVAL '${hours}' HOUR
     GROUP BY provider, outcome ORDER BY calls DESC`
  );
  if (out.ok === false) return c.json(out);
  return c.json({ ok: true, rows: groupUpstream(out.data?.data ?? []) });
});

/**
 * Fold the per-outcome rows into one row per provider, keeping the outcome
 * breakdown rather than collapsing it to a pass/fail count we cannot justify.
 *
 * Analytics Engine returns counts as STRINGS. Adding them without Number() gives
 * string concatenation, which produces a plausible-looking total - the worst kind
 * of wrong number.
 */
export function groupUpstream(rows: any[]) {
  const byProvider = new Map<string, { provider: string; calls: number; outcomes: Record<string, number>; latency: number; attempts: number }>();

  for (const r of rows) {
    const provider = String(r?.provider ?? 'unknown');
    const outcome = String(r?.outcome ?? '').trim() || '(not recorded)';
    const calls = Number(r?.calls ?? 0);
    const hit = byProvider.get(provider) ?? { provider, calls: 0, outcomes: {}, latency: 0, attempts: 0 };
    // Weighted so a provider's average is not skewed by a rare outcome.
    hit.latency = (hit.latency * hit.calls + Number(r?.latency ?? 0) * calls) / (hit.calls + calls || 1);
    hit.attempts = (hit.attempts * hit.calls + Number(r?.attempts ?? 0) * calls) / (hit.calls + calls || 1);
    hit.calls += calls;
    hit.outcomes[outcome] = (hit.outcomes[outcome] ?? 0) + calls;
    byProvider.set(provider, hit);
  }

  return [...byProvider.values()].sort((a, b) => b.calls - a.calls);
}

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
 * the state of a safety control without reading it is worse than no panel - it
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
  // across redeploys is the loop this pattern exists to end - it is what turned
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
 * reported as unavailable - deliberately NOT as "no limit", because guessing
 * wrong in that direction invents reassurance.
 */
export function spendLimit(result: any): { limits: { budget: number; window: string; enabled: boolean }[] | null } {
  if (!result || typeof result !== 'object') return { limits: null };

  const raw = result.spend_limits ?? result.spendLimits ?? null;
  if (raw == null) return { limits: [] }; // read fine, carries no rules

  // Recorded live 6 Aug 2026 - an OBJECT, not the array the first guess assumed:
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
