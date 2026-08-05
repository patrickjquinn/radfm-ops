# Runbook

Day-one setup, and the checks worth running when something looks wrong.

---

## 0. Before anything works

Two prerequisites, in this order.

### 0.1 Apply migration 0003 — ✅ DONE, 5 August 2026

Applied to production: 7 queries, 34,881 rows read, 104,617 written, 1.7s. Nothing to do here; kept
for reference and for bootstrapping a fresh environment.

Verified afterwards:

```
admin_users                      3 | owner | patrick.jm.quinn@gmail.com
past_plays.played_at IS NULL     0          (was 34,870)
past_plays.played_at present     34,871
duplicate (user_id, song)        0          <- dedup survived the PK-column backfill
GET /admin/me as user 3          200 owner
```

Until it ran, **every `/admin/*` endpoint returned 404 for everyone, including the owner** — the auth
layer fails closed rather than admitting anyone when it cannot read the role table.

```bash
cd ~/Developer/rad-fm-backend
bunx wrangler d1 execute RAD_USERS --remote --file migrations/0003_admin_rbac_and_played_at.sql
```

What it does: creates `admin_users` and `admin_audit`, seeds user 3 as `owner`, backfills
`past_plays.played_at` from `created_at` (~34,870 rows), and adds the ordering index.

It is idempotent — safe to re-run — and was dry-run against a local D1 first. That dry run caught a
foreign-key failure in the owner seed that would have aborted the whole migration on any database
without user 3, so the seed is now `EXISTS`-guarded.

Verify:

```bash
bunx wrangler d1 execute RAD_USERS --remote \
  --command "SELECT a.user_id, a.role, u.email FROM admin_users a LEFT JOIN users u ON u.id = a.user_id"
# expect: 3 | owner | patrick.jm.quinn@gmail.com

bunx wrangler d1 execute RAD_USERS --remote \
  --command "SELECT COUNT(*) AS still_null FROM past_plays WHERE played_at IS NULL"
# expect: 0
```

Then confirm the API agrees, with a real user-3 JWT:

```bash
curl -s https://api.rad-fm.com/admin/me -H "Authorization: Bearer $TOKEN"
# expect: {"userId":3,...,"role":"owner","can":{"read":true,"operate":true,"administer":true}}
```

### 0.2 Create the Cloudflare API token

See `.dev.vars.example` §1 for the exact permissions. Start read-only.

Then confirm Analytics Engine is actually receiving data — this is finding 3 and is still unverified:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/49b85a65aa7b9cd658945400b972d2b7/analytics_engine/sql" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -d "SELECT blob1 AS event, count() AS n FROM rad_fm_events
      WHERE timestamp > now() - INTERVAL '1' DAY GROUP BY event"
```

Expect rows for `recs`, `dj`, `upstream`, and — from the most recent deploy onward — `play`. If it
returns nothing, check that the binding is deployed before assuming the code path is cold. Writes
are fire-and-forget, so an absent datapoint is not proof the event did not happen.

### 0.3 State you are inheriting from verification

Two harmless things that would otherwise look like someone changed production:

- **`MAX_ENRICH` reads `source: kv`, `updatedBy: user 3`, value `25`.** That is the write path being
  verified end to end, then restored. The value is identical to the compiled-in default, so
  behaviour is unchanged. There is deliberately no DELETE endpoint — removing the key means deleting
  `config:MAX_ENRICH` from the `CONFIG_KV` namespace by hand, and it is not worth doing.
- **`admin_audit` has a handful of rows** from the same exercise: `config.write` with outcome `ok`
  and several `denied`. They are real audit records of real requests, so they stay.

Everything else — the other five config keys — reads `source: default`, untouched.

---

## 1. Health checks, in the order worth running

### "Is anything broken right now?"

**Check 4xx first, not errors.** The Cloudflare dashboard's headline "Errors" counts only 5xx and
uncaught exceptions. A total auth outage has already displayed as **"0 Errors"** while every user
was locked out.

```bash
cd ~/Developer/rad-fm-backend
bun scripts/logs.ts --status 4xx --hours 6
bun scripts/logs.ts --level error --hours 24
bun scripts/logs.ts --level warn  --hours 48     # groups by normalised message
```

The warning sweep is not optional. A bug that had disabled setlists for a third of all gigs lived
entirely in warnings — 1,094 of them in three days, none of which threw.

### "Is the DJ still good?"

```sql
-- Analytics Engine
SELECT blob3 AS reason, count() AS n FROM rad_fm_events
WHERE blob1 = 'dj' AND timestamp > now() - INTERVAL '1' DAY
GROUP BY reason ORDER BY n DESC
```

`blob3` is `degeneracyReason`, or `ok`. A rising share of non-`ok` means the guard is rejecting more
takes — regressions here are otherwise only detectable by listening to the radio.

### "Are recommendations healthy?"

```sql
SELECT blob2 AS source, avg(double2) AS pool, avg(double3) AS ms, sum(double7) AS degraded
FROM rad_fm_events WHERE blob1 = 'recs' AND timestamp > now() - INTERVAL '1' DAY
GROUP BY source
```

`degraded` climbing means the orchestrator is falling back. It degrades gracefully, so nothing
throws — this is the only way to see it.

### "Is entitlement drifting?"

`GET /admin/users/:id/entitlement` returns the local row **and** its audit trail. `premium_users` is
a cache of RevenueCat, not a source of truth: it once went stale and silently stripped paid segments
from live subscribers. Cross-check against RevenueCat and show both. Disagreement is that bug
returning.

Standing query — premium rows with no provenance:

```sql
SELECT p.user_id, m.premium_since, m.last_source
FROM premium_users p LEFT JOIN premium_meta m ON m.user_id = p.user_id
WHERE m.user_id IS NULL OR m.premium_since IS NULL;
```

### "Is data quality holding?"

`GET /admin/stats` → `dataQuality.pastPlaysMissingPlayedAt`. Should be 0 after the migration. If it
climbs, the `past_plays` insert has regressed and the recommender's "recently played" exclusion is
becoming arbitrary again.

---

## 2. Things that will waste your time if you do not know them

- **The wrangler OAuth token does not work against `api.cloudflare.com/client/v4`.** It returns
  `10000 Authentication error` regardless of freshness. You need a real API token.
- **D1 rejects `too many terms in compound SELECT`** (`SQLITE_ERROR 7500`) when you stack ~10
  `UNION ALL` counts. Run separately or use `d1.batch()`. `/admin/stats` already does.
- **D1 `bind()` accepts only null, number, string and ArrayBuffer** — not booleans, not `undefined`.
  `JSON.stringify(undefined)` returns `undefined`, not `"undefined"`. This has caused a production
  500 before.
- **Observability retains 3 days.** Longer trends must be rolled up into Analytics Engine or D1.
- **`workers_dev: true`** on the backend means `rad-fm-backend.veme.workers.dev` is publicly
  reachable and bypasses custom-domain protection. Set `false` on the ops Worker.
- **`past_plays` is current state, not history.** Use `created_at`. See `FINDINGS.md` §1.
- **Admin 404s are not bugs.** Unauthorised deliberately returns 404 rather than 403.

---

## 3. Rollback

```bash
bunx wrangler deployments list                    # find the last good version
bunx wrangler rollback --version-id <id>
```

Limited to the 100 most recent versions. Rolling back across a secret change needs `?force=true` via
the API. Migration 0003 is additive — `CREATE TABLE IF NOT EXISTS` plus a backfill — so a code
rollback does not require a schema rollback.
