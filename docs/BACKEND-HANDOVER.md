# Backend handover — four routes the ops dashboard needs

**For:** whoever owns `rad-fm-backend`
**From:** the `radfm-ops` build, 5 August 2026
**Status:** the dashboard is built and deployed-ready. Four panels are wired, rendering, and waiting
on routes that do not exist yet. Nothing here is speculative UI — each one has a client already
written against the contract below, so shipping a route lights up its panel with no frontend change.

Until then those panels render **"this backend route has not been built yet"**, naming the route.
That is deliberate: the dashboard's whole premise is that a silent gap is how the last three
incidents stayed invisible, so it will not quietly show nothing.

---

## Ground rules that apply to all four

These are not style preferences. Each one is a bug this system has already had.

1. **Gate with `adminAuth('viewer')`** for reads, `adminAuth('operator')` for the one write.
   Unauthorised returns **404, not 403** — that is what `adminAuth` already does, don't work around
   it. The dashboard never distinguishes "not allowed" from "not found", on purpose.
2. **`bind()` accepts only null, number, string and ArrayBuffer.** Not booleans, not `undefined`.
   Passing a boolean throws at runtime; `JSON.stringify(undefined)` returns `undefined`, not
   `"undefined"`. This has already caused a production 500 in `saveStation`.
3. **Do not stack ~10 `UNION ALL` counts.** D1 fails with `SQLITE_ERROR 7500`, "too many terms in
   compound SELECT". `/admin/stats` already runs separate statements for this reason.
4. **Degrade per field, not per request.** `/admin/users/:id/entitlement` already does this with its
   `soft()` helper — copy it. A support engineer asking "why does this account think it's premium?"
   should get the answer even if one auxiliary table is missing.
5. **Failed sub-queries return `-1`, never 0.** That is the existing "query failed" sentinel and the
   dashboard renders it as "unavailable". A zero that means "I couldn't ask" is the exact failure
   mode this tool exists to prevent.
6. **Timestamps:** D1 columns are TEXT `'YYYY-MM-DD HH:MM:SS'`. `premium_meta.premium_since` is
   ISO-8601 with a `Z`. Do not join or compare the two without normalising.

---

## 1. `GET /admin/users/lookup?q=<string>`

**Why:** the design's search box says "user id, email or RevenueCat id". Only numeric ids resolve
today, via `/admin/users/:id/entitlement`. Support requests arrive as an email address roughly
always and as a RevenueCat subscriber id whenever billing is involved.

**Auth:** `adminAuth('viewer')`.

**Request:** `q` is a free string. Decide the branch server-side:

- matches `/^\d+$/` → treat as user id (the client resolves these directly and won't call you, but
  handle it anyway rather than returning nothing)
- contains `@` → email
- otherwise → RevenueCat subscriber id, matched against `premium_meta.rc_subscriber_id`

**Response 200:**

```json
{
  "matches": [
    { "id": 3, "email": "patrick.jm.quinn@gmail.com", "username": "patrick", "created_at": "2025-11-02 09:14:22" }
  ]
}
```

Always an array, even for one hit. **Return all matches rather than auto-selecting the best one** —
the client lists them and makes the operator choose. Two accounts sharing an email prefix is exactly
the case where guessing produces a confident support answer about the wrong person.

**Suggested SQL:**

```sql
-- email (exact first, then prefix — exact match must win)
SELECT id, email, username, created_at FROM users WHERE email = ?1
UNION
SELECT id, email, username, created_at FROM users WHERE email LIKE ?1 || '%' LIMIT 20;

-- revenuecat subscriber id
SELECT u.id, u.email, u.username, u.created_at
FROM premium_meta m JOIN users u ON u.id = m.user_id
WHERE m.rc_subscriber_id = ?1;
```

**Cap the result set** (20 is plenty) and **do not support bare-substring search on email.** An
unbounded `LIKE '%x%'` over `users` is a full scan, and this is an admin surface on a shared D1
instance.

---

## 2. `GET /admin/stations?limit=&offset=&q=`

**Why:** Phase 3 station browser. All 341 stations are user-generated and subscriber counts sit at
roughly one each, so this is a **content browser, not a leaderboard** — the client renders it as
such and deliberately does not rank by popularity, because that signal does not exist.

**Auth:** `adminAuth('viewer')`.

**Response 200:**

```json
{
  "stations": [
    { "id": "st_8f21", "name": "Rainy Sunday Soul", "mood": "mellow", "genres": "soul, r&b",
      "created_at": "2026-08-02 11:02:44", "subscribers": 1, "is_user_generated": 1 }
  ],
  "total": 341
}
```

**Suggested SQL** (already validated in `queries/d1.sql`):

```sql
SELECT s.id, s.name, s.mood, s.genres, s.created_at, s.is_user_generated,
       COUNT(us.user_id) AS subscribers
FROM stations s
LEFT JOIN user_stations us ON us.station_id = s.id
GROUP BY s.id
ORDER BY s.created_at DESC
LIMIT ?1 OFFSET ?2;
```

`subscribers = 0` is an **orphan** — nothing references it and its artwork is still occupying R2.
The client badges these. They are cleanup candidates, not an error, so don't filter them out.

`q`, when present, should match `name`, `mood` or `genres`. Same caution as above: bound it.

---

## 3. `GET /admin/metrics/setlists?hours=<n>`

**Why:** this is the one that matters most. **Setlist fill rate sat around 65% while looking
perfectly healthy**, because the enrichment failures logged as warnings and warnings are not errors
— 1,094 of them in three days, none of which threw, and it had disabled setlists for a third of all
gigs. A dashboard for this system that cannot show this number has not learned the lesson.

**Auth:** `adminAuth('viewer')`.

**Response 200:**

```json
{ "fillRate": 0.75, "sampled": 100, "filled": 75, "windowHours": 24 }
```

`fillRate` is a **fraction between 0 and 1**, not a percentage — the client formats it. Baseline is
**0.75**, measured on a live 100-event London listing; the dashboard raises a signal below **0.70**.

**How to compute it is your call, and it is the real work here.** The shape of the question is:
"of the gigs we served in this window, what proportion came back with a non-empty setlist?" Two
routes:

- **Cheapest:** count over `GIG_CACHE` KV — entries are keyed by city-country and hold the enriched
  result. A cached entry with an empty setlist array is a miss.
- **Better:** emit an Analytics Engine event from the enrichment path (`trackSetlist`, with
  `filled` as a double) and aggregate it there. This survives beyond KV TTL and gives you the trend
  the 3-day Observability retention cannot.

**If you take the Analytics Engine route, append a new blob/double slot — never reorder or
repurpose an existing one.** The slots are positional and Analytics Engine has no schema, so
reordering silently changes the meaning of every historical row already written.

Return `-1` for `sampled` if the source is unreachable, so the client says "unavailable" rather than
reporting a 0% fill rate, which reads as a total outage.

---

## 4. `GET /admin/config` and `PUT /admin/config/:key`

**Why:** Phase 4, Tier 1 runtime config. The values in the table below currently require a redeploy
to change. Note `PREMIUM_TTL_S` in particular: the stale-cache incident would have been a one-line
KV write instead of a deploy.

**Auth:** `adminAuth('viewer')` to read, **`adminAuth('operator')` to write.**

### The Tier 1 set — and nothing else

| Key | Location | Default |
| --- | --- | --- |
| `FREE_DAILY_SPEAK` | `src/lib/entitlement/index.ts:34` | 100 |
| `PREMIUM_DAILY_SPEAK` | `src/lib/entitlement/index.ts:34` | 1000 |
| `PREMIUM_TTL_S` | `src/lib/entitlement/index.ts:22` | 300 |
| `MAX_OTP_ATTEMPTS` | `src/users/services/auth/index.ts:125` | 5 |
| `MAX_ENRICH` | `src/events/**` | 25 |
| `TRANSITION_MIN_WORDS` | `src/rad/constants/index.ts:164` | 24 |

**Treat this as an allowlist.** A generic "write any KV key" endpoint behind an admin role is a much
larger surface than this feature needs, and the recommendation weights (Tier 2) and prompt pools
(Tier 3) must never become reachable this way — they are a tuned system and version-controlled
creative assets respectively. See `README.md` §6.

### `GET /admin/config` → 200

```json
{
  "values": [
    { "key": "PREMIUM_TTL_S", "value": 300, "source": "default", "default": 300,
      "location": "src/lib/entitlement/index.ts:22", "updatedAt": null, "updatedBy": null },
    { "key": "MAX_ENRICH", "value": 40, "source": "kv", "default": 25,
      "location": "src/events/**", "updatedAt": "2026-08-05 09:12:44", "updatedBy": "user 3" }
  ]
}
```

**`source` is not optional.** The dashboard shows whether each number came from KV or from the
constant in code, because `100` looks identical whether someone set it deliberately or nobody has
ever touched it, and an operator debugging behaviour needs to know which.

### `PUT /admin/config/:key` → 200

Body: `{ "value": "400" }` (string; coerce and validate server-side).

Returns the updated entry in the same shape as one element of `values` above.

**Four things this handler must do:**

1. **Validate against the allowlist and a per-key type/range.** `MAX_OTP_ATTEMPTS = 0` locks every
   user out of the product. `PREMIUM_TTL_S = 0` hammers RevenueCat on every request. Bound them.
2. **Write the `admin_audit` row in the same handler**, with actor, key, before and after. Not in a
   wrapper, not in middleware, not afterwards — a write that succeeds while its audit row fails is
   an unattributable production change. This is the entire reason the table exists.
3. **Return 4xx on validation failure with a `detail` string.** The client renders `detail`
   verbatim under the field, so make it a sentence an operator can act on.
4. **Reject anything not in the allowlist with 404**, consistent with the rest of `/admin/*`.

### The read helper — the part that is easy to get wrong

```ts
// The default MUST live in code. A config system that fails to an empty value is
// worse than no config system: a malformed KV entry silently becoming 0 turns
// MAX_OTP_ATTEMPTS into a lockout and PREMIUM_DAILY_SPEAK into a dead product.
async function cfg(env: Env, key: Tier1Key): Promise<number> {
  const fallback = TIER1_DEFAULTS[key]
  try {
    const raw = await env.CONFIG_KV.get(`config:${key}`)
    if (raw === null) return fallback
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : fallback
  } catch {
    return fallback
  }
}
```

Cache with a short TTL — every request reading KV for six keys is six extra reads on a hot path.

---

## What the dashboard already does, so you don't rebuild it

- **Proxying and auth.** `worker/backend.ts` in `radfm-ops` allowlists exactly these paths and
  forwards the operator's own Rad.FM JWT as `Authorization: Bearer`. It permits `GET` on all four
  and `PUT` only on `/admin/config/:key`. Nothing else can cross that boundary.
- **The role check that matters is yours.** The dashboard's allowlist controls the *shape* of what
  can be asked for, never *who* may ask. Enforce `operator` on the PUT handler regardless of what
  the client believes.
- **Rendering, empty states and error text** are done. You do not need to shape messages for the UI
  — return the contract and a `detail` string on failure.

## How to verify each one landed

With an owner JWT, from the ops dashboard, live mode:

| Route | Where it shows up |
| --- | --- |
| `users/lookup` | Users → search an email → a "Matches" list appears |
| `stations` | Stations → the table populates, orphans badged |
| `metrics/setlists` | Overview → the fifth health card, and a signal below 70% |
| `config` | Config → source column reads `kv`/`default`, Edit enables for operators |

Each panel names the missing route until then, so "did it ship?" is answerable by looking.

## These contracts were tested, not just written

All four were exercised against a throwaway stub implementing exactly the shapes above, including
the config write path end to end: `PUT` → validation rejection → valid write → audit row → the
Audit view updating. Two real client bugs came out of that and are fixed. So the contracts are
known to work — if your implementation matches what is written here, the dashboard will render it.

One naming detail that bit us, worth matching exactly: the existing `/admin/audit` returns
`{ entries: [...] }` with columns `actor_id` and `actor_email` (not `actor_user_id`). The client now
reads `actor_email` first and falls back to `user <actor_id>`. Use the same columns for the config
write's audit row and the Audit view will attribute it correctly with no further work.
