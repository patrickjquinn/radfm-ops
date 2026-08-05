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
const clampHours = (raw: string | undefined, fallback = 24) => {
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

  const out = await obs(c.env, {
    queryId: 'radfm-ops-4xx',
    timeframe: { from: Date.now() - hours * 3600_000, to: Date.now() },
    limit: 100,
    parameters: {
      datasets: ['cloudflare-workers'],
      filters: [
        { key: '$metadata.service', operation: 'eq', value: c.env.BACKEND_SCRIPT_NAME, type: 'string' },
        { key: '$workers.event.response.status', operation: 'gte', value: 400, type: 'number' },
        { key: '$workers.event.response.status', operation: 'lt', value: 500, type: 'number' }
      ],
      calculations: [{ operator: 'count', alias: 'count' }],
      groupBys: [
        { type: 'string', value: '$workers.event.request.path' },
        { type: 'number', value: '$workers.event.response.status' }
      ]
    },
    view: 'calculations'
  });
  if (out.ok === false) return c.json(out);
  return c.json({ ok: true, hours, retentionHours: RETENTION_HOURS, result: out.data?.result ?? null });
});

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

  const out = await obs(c.env, {
    queryId: `radfm-ops-${level}`,
    timeframe: { from: Date.now() - hours * 3600_000, to: Date.now() },
    limit: 1000,
    parameters: {
      datasets: ['cloudflare-workers'],
      filters: [
        { key: '$metadata.service', operation: 'eq', value: c.env.BACKEND_SCRIPT_NAME, type: 'string' },
        { key: '$metadata.level', operation: 'eq', value: level, type: 'string' }
      ]
    },
    view: 'events'
  });
  if (out.ok === false) return c.json(out);

  const events: any[] = out.data?.result?.events?.events ?? out.data?.result?.events ?? [];
  return c.json({
    ok: true,
    hours,
    level,
    retentionHours: RETENTION_HOURS,
    groups: level === 'warn' ? groupNormalised(events) : null,
    events: level === 'error' ? events.slice(0, 100).map(toErrorRow) : null
  });
});

/** Same normalisation as scripts/logs.ts: strip numbers and hex so one bug is one row. */
function normalise(msg: string) {
  return msg
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/\b\d+(\.\d+)?\b/g, '<n>')
    .trim();
}

function messageOf(e: any): string {
  return String(e?.$workers?.event?.message ?? e?.message ?? e?.body ?? '').slice(0, 400);
}

function groupNormalised(events: any[]) {
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
  return c.json({ ok: true, rows: out.data?.data ?? [] });
});

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
  return c.json({ ok: true, rows: out.data?.data ?? [] });
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

export { app as cf };
