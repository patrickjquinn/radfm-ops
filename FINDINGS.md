# Findings — the live system as of 5 August 2026

Checked against live D1, live `wrangler.jsonc`, and the `rad-fm-backend` source. Numbers are real,
pulled the day this was written.

---

## Three things to fix before or during the build

These came out of the research rather than being the point of it. The first two changed what the
dashboard could honestly display, so they gated Phase 2.

**Status: all three FIXED, deployed and VERIFIED IN PRODUCTION (5 Aug 2026).**

| # | Finding | Status |
|---|---|---|
| 1 | `past_plays.played_at` NULL on every row | **Fixed** — write path, ordering, index; migration 0003 backfills |
| 2 | No admin role anywhere | **Fixed** — `admin_users`, `admin_audit`, `adminAuth()`, 24 tests |
| 3 | Analytics Engine written but never read | **Closed** — token created, dataset confirmed live with 1,074+ rows |

### 1. `past_plays.played_at` is NULL on every row — there is no play history  ✅ FIXED

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

**What was done.** The insert now writes `played_at`, and ordering plus the index moved to
`created_at` unconditionally — the old code *probed* for the column to decide what to order by, and
the probe SUCCEEDED in production because the column exists and is merely empty. Detection was the
bug, not a guard against it.

Dedup was verified unaffected: it is done by an explicit `DELETE` on `json_extract(song,'$.id')`,
not by the primary key, so a real timestamp cannot turn the table into an append-only log. Three
plays of one track still leave exactly one row.

`trackPlay()` in `src/lib/analytics.ts` now records the append-only history D1 structurally cannot
hold. **Backfill of the events themselves is impossible** — they were never recorded anywhere — so a
historical listening chart can start from the deploy date and no earlier. Do not let anyone promise
otherwise.

Migration `0003` backfilled `played_at` from `created_at`. **Applied and verified in production:**
0 rows still NULL, 34,871 populated, and **0 duplicate `(user_id, song)` groups** — the real risk was
that updating a primary-key column across 34,871 rows would collide or fragment the table, and it did
not. A recommendations call afterwards returned 10 unique tracks in 4s.

Track `dataQuality.pastPlaysMissingPlayedAt` from `/admin/stats`: currently 0. If it climbs, the
insert has regressed.

### 2. There is no admin role anywhere in the codebase  ✅ FIXED

Covered in `README.md` §3 and §3a. Summarised here because it was a finding, not a design choice: no
`role` column, no `is_admin`, no permission check. The de facto admin credential was `DEV_TKN_KEY`,
one shared static string checked in seven places, not tied to any user and not attributable in logs.

**What was done.** `admin_users` (viewer/operator/owner, seeded with user 3), `admin_audit`
(append-only), and `adminAuth(minimum)` resolving the role from D1 on every request. 24 tests cover
forged, expired, refresh-as-bearer, smuggled-role and missing-table cases.

**Verified against production**, every case:

| Credential | Result |
|---|---|
| user 3, valid | `200` — `role: owner` |
| user 99, valid but not an admin | `404` |
| refresh token as bearer | `404` |
| expired owner token | `404` |
| token signed with the wrong secret | `404` |
| `role: "owner"` smuggled into the JWT body | `404` |

It also failed closed before the migration ran: every route 404'd for everyone, owner included.

`isPrivilegedRequest()` accepts an admin JWT **or** the legacy dev key, so existing tooling keeps
working. Retiring the dev key is now deleting a single branch in `src/lib/auth/admin.ts`.

### 3. Analytics Engine is instrumented but never read  ✅ CLOSED

`src/lib/analytics.ts` writes into `rad_fm_events` from live code paths, and nothing queried it. It
was the best data in the system and effectively write-only.

**Now confirmed receiving data.** A read-only API token was created and the dataset queried directly:
`recs` 732, `dj` 307, `play` 33, `upstream` 2 over 7 days, plus `setlist`. `play` first appears at
the exact deploy that introduced it, which is as good a confirmation as the pipeline can give.

Two events were added during this work: `trackPlay` (the listening history D1 structurally cannot
hold) and `trackSetlist` (fill rate per served listing). `trackSetlist` initially fired only on a
fresh upstream fetch, so cache hits and the stale fallback — the dominant serving paths — recorded
nothing; it now records on all three and tags each with `served`.

Full detail and the baselines worth alerting on are in `RUNBOOK.md` §0.3. The original check, for
reference:

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
