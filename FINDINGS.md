# Findings — the live system as of 5 August 2026

Checked against live D1, live `wrangler.jsonc`, and the `rad-fm-backend` source. Numbers are real,
pulled the day this was written.

---

## Three things to fix before or during the build

These came out of the research rather than being the point of it. The first two change what the
dashboard is able to honestly display, so they are not "nice to haves" — they gate Phase 2.

### 1. `past_plays.played_at` is NULL on every row — there is no play history

```
SELECT COUNT(*) FROM past_plays;                          -- 34,870
SELECT COUNT(*) FROM past_plays WHERE played_at NOT NULL; --      0
```

The column is part of the primary key, `PRIMARY KEY(user_id, song, played_at)`, and it is NULL
throughout. There are **zero** duplicate `(user_id, song)` groups, so in practice the key has
collapsed to `(user_id, song)` and re-plays overwrite rather than append.

**Consequences, and they are not small:**

- The table stores **current state, not history**. "Plays per day", "most played track", "listening
  hours", "skip rate" are all unanswerable from it as it stands.
- `created_at` holds the real timestamp and is what every ops query must use. `played_at` looks
  authoritative and is a trap.
- DAU/WAU are computable but mean "users who played a song they had not played before, or replayed
  one" — not "users who listened". Label the panel accordingly rather than calling it DAU.

Verified working numbers using `created_at`: **DAU 15, WAU 44** (against 631 registered users).

**Recommendation:** treat play history as a new Analytics Engine event rather than trying to repair
the table. `writeDataPoint` is built for exactly this — high volume, append-only, cheap — and the
plumbing already exists in `src/lib/analytics.ts`. Backfill is not possible; the data was never
written. Do not let anyone promise a historical listening chart.

### 2. There is no admin role anywhere in the codebase

Covered in `README.md` §3. Summarised here because it is a finding, not a design choice: no `role`
column, no `is_admin`, no permission check. The de facto admin credential is `DEV_TKN_KEY`, one
shared static string checked in seven places, not tied to any user and not attributable in logs.

### 3. Analytics Engine is instrumented but never read

`src/lib/analytics.ts` writes three rich event types into `rad_fm_events` from live code paths.
Nothing queries it. This is the best data in the system and it is currently write-only.

**Unverified:** I could not confirm datapoints are actually landing, because that needs a
Cloudflare API token that does not exist yet. Day-one check:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/49b85a65aa7b9cd658945400b972d2b7/analytics_engine/sql" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -d "SELECT count() AS n FROM rad_fm_events WHERE timestamp > now() - INTERVAL '1' DAY"
```

If that returns 0, check the binding deployed before assuming the code path is cold.

---

## Live inventory

### D1 — `RAD_USERS`, id `073f767d-2eda-4d81-ac96-61f0e55f4a4f`

| Table | Rows | Notes |
|---|---:|---|
| `users` | 631 | `id, username, email, created_at, updated_at`. No role, no status, no soft-delete |
| `premium_users` | 18 | Cache of RevenueCat state. **Not a source of truth** — see below |
| `premium_meta` | — | `premium_since`, `last_source`, `rc_subscriber_id`, `app_id` |
| `premium_audit` | — | Append-only entitlement audit. **Copy this pattern for admin actions** |
| `stations` | 341 | All 341 are user-generated (`is_user_generated = 1`) |
| `user_stations` | — | Join table |
| `past_plays` | 34,870 | See finding 1 |
| `liked_songs` | 4,507 | Every row has an ISRC; 15% of `past_plays` do not |
| `liked_artists` / `disliked_songs` / `disliked_artists` | — | Same shape |
| `otps` | — | `attempts` column added for the OTP hardening work |
| `tokens` / `refresh_tokens` | — | Keyed by email |
| `d1_migrations` | — | Only `0002_user_preferences` is tracked |

**The migrations directory is stale.** `migrations/0002_user_preferences.sql` does not describe the
live schema — `premium_*`, `stations`, `user_stations`, `refresh_tokens` and `otps.attempts` all
exist in production without a tracked migration. Earlier migrations `0001`, `0003`–`0006` were
removed along with an abandoned self-hosted recommender, and their tables may still linger. **Read
the live schema, never the migrations directory.**

`premium_users` deserves particular care: it is a cache populated by a RevenueCat webhook that had
never fired, which silently stripped paid segments from real subscribers. The backend now confirms
negatives against RevenueCat live before denying. Any dashboard panel showing entitlement must show
**both** the local row and the RevenueCat answer, or it will confidently display the same stale
state that caused the incident.

### KV namespaces

| Binding | ID | Ops relevance |
|---|---|---|
| `RATE_LIMIT_KV` | `a2c9ec21e17447f6b37bae1412a0cd73` | Holds `deny:ip:<ip>` denylist — edit surface |
| `RAD_SAYS` | `e26bd55a7f9d4ff681c67417f8d71e9a` | DJ speech history — useful for "what did he say?" |
| `ASK_RAD_SAYS` | `4878183c09d54d0da78ea900f14b7918` | Per-user Ask Rad memory — **contains user content, gate it** |
| `GIG_CACHE` | `15ed9064fd2243ceb420b5628a269540` | Setlists by city-country — purge surface |
| `MUSIC_CACHE` | `9d69eff7337346adbfd0c204185e58b6` | Apple/ReccoBeats caches |
| `AUTH_CACHE` | `117c4855387246b88af8960583b83dfb` | Entitlement cache, 300s TTL |
| `TEXT_TO_RAD_KV` | `ce6235843c50462bbf06572618f282e0` | Listener messages — **user content** |
| `USER_STATIONS` | `f5d0f789b9a04e0ead81dd19b7cf4e6a` | |

Two of these hold user-generated content. A dashboard that lists KV keys will expose it, so those
two want `owner`-only reads and an audit row per access.

### Other bindings

- **R2** `STATION_ART_BUCKET` → bucket `rad-fm-station-art`. Stations Plus artwork, ~74KB objects,
  served through the Worker at `/stations/art/:key`.
- **Analytics Engine** `ANALYTICS` → dataset `rad_fm_events`.
- **Rate limit** (unsafe binding) `RAD_FM_RATELIMIT`, namespace `145493`, 100 requests / 60s.
- **Cron** `0 */6 * * *` — RevenueCat reconcile. The only server-initiated revocation path; without
  it a lapsed subscriber keeps Rad+ until they next open the app. Worth a "last run / last outcome"
  panel, because it was previously configured empty and nothing ran.
- **Observability** enabled, `head_sampling_rate: 1`, persisted logs on.
- **Placement** `smart`.

### Routes and exposure

- `api.rad-fm.com` — custom domain, DNS and cert provisioned by Cloudflare.
- `workers_dev: true` — **`rad-fm-backend.veme.workers.dev` is also live and publicly reachable.**
  Any protection applied to the custom domain does not cover it. Decide deliberately whether the ops
  Worker sets this to `false`; it should.

---

## Reference values for the dashboard

Snapshot taken 5 Aug 2026, useful as a sanity baseline when panels first light up.

```
users                  631
new users (7d)          13
premium_users           18        (2.9% of registered)
stations               341        (100% user-generated)
past_plays          34,870        played_at NULL on all
liked_songs          4,507
DAU  (created_at, 24h)  15
WAU  (created_at, 7d)   44
setlist fill rate      75%        measured on a live 100-event London listing
```

Two ratios worth watching from day one, because both have already gone wrong silently:

- **Premium as a fraction of active users**, cross-checked against RevenueCat. Local-vs-remote
  disagreement is the entitlement bug reappearing.
- **Setlist fill rate.** It sat around 65% while looking healthy, because failures logged as
  warnings and warnings are not errors.
