# Rad.FM Ops Dashboard - build spec

Build spec for the ops dashboard, and the dashboard itself.

**The dashboard is now built** - every view from the design plus a Stations browser, a Worker BFF,
and Cloudflare Access verification. The backend half of Phase 0 was already built and deployed: admin RBAC, an
audit trail, and four read-only `/admin/*` endpoints. §3a is the contract the client codes against;
`FINDINGS.md` records what was wrong and what is now fixed.

Everything in the spec sections was checked against the live system on 5 August 2026 - live D1, live
`wrangler.jsonc`, live source. Where a claim is inferred rather than verified, it says so.

| File | What it is |
|---|---|
| `README.md` | This - architecture, RBAC, build phases |
| `FINDINGS.md` | What the live system actually looks like today, including three problems to fix first |
| `RUNBOOK.md` | **Start here on day one** - setup steps, health checks, known time-wasters |
| `SECURITY-REVIEW.md` | Red-team of the admin surface, run against production. **§5 is a finding in the ops Worker itself** |
| `queries/d1.sql` | Ops queries, run against live D1 and annotated with real numbers |
| `.dev.vars.example` | Every secret and token needed, with provenance |
| `worker/` | The BFF: Access gate, Cloudflare API named queries, `/admin/*` proxy |
| `src/` | The React SPA - `views/` is one file per view, `lib/health.ts` derives the verdict |
| `docs/BACKEND-HANDOVER.md` | The four `/admin/*` routes still needed, with contracts and SQL |

## Running it

```bash
npm install
cp .dev.vars.example .dev.vars    # fill in CLOUDFLARE_API_TOKEN
npm run dev                       # workerd locally, so dev matches prod
```

Without a Cloudflare API token every panel renders **"unavailable"** with the reason - that is
correct behaviour, not a broken build, and it is the state the tool ships in until the token in
`RUNBOOK.md` §0.2 exists. To review the design with data in it:

- `http://localhost:5173/?demo=healthy`
- `http://localhost:5173/?demo=incident`

Demo mode is opt-in via the URL, banners itself on every page, and is **never** a fallback when a
live source fails. A dashboard that quietly shows fixtures when it cannot reach the real thing is
worse than one that shows nothing.

## Owner token - making /admin/* just work

Half the dashboard reads `/admin/*` on the Rad.FM backend, which needs a Rad.FM
**owner JWT**. The ops Worker holds no Rad.FM credential of its own by design, so that
token has to come from somewhere. Two ways:

**Per-browser (zero setup).** Paste a token into the "Rad.FM JWT" field at the bottom of
the sidebar. It lives in `localStorage`, so it survives tabs and restarts - one paste per
machine, not per tab.

**Worker-held (recommended for the sole operator).** Set it once and no one pastes anything:

```bash
npx wrangler secret put OPS_BACKEND_JWT     # paste the owner JWT when prompted
```

`OPS_OWNER_EMAIL` in `wrangler.jsonc` guards it: the Worker attaches that token **only**
for that one Access identity. Add a second person to the Access policy and they do not
inherit it - they supply their own, so `admin_audit` still attributes actions to a person.
A pasted token always wins over the Worker-held one, for the same reason.

To mint a token (from `~/Developer/rad-fm-backend`, which has `JWT_SECRET`):

```bash
node --input-type=module -e "
import { sign } from '@tsndr/cloudflare-worker-jwt'; import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.dev.vars','utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => [l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]));
const exp = Math.floor(Date.now()/1000) + 30*24*3600;
console.log(await sign({ email:'patrick.jm.quinn@gmail.com', userId:3, typ:'access', exp }, env.JWT_SECRET));
"
```

**It expires.** Whatever lifetime you mint, the panels go back to "unavailable" when it
lapses - the message says so rather than showing stale numbers. The permanent fix is for
the backend to accept the Cloudflare Access JWT for `/admin/*` directly, mapping the
verified email onto `admin_users`. That removes the second credential entirely and is the
single highest-value item left in `docs/BACKEND-HANDOVER.md`.

## Deployed

**Live at `ops.rad-fm.com` since 5 August 2026.** Version `3799d514`.

| | |
|---|---|
| Access application | `Rad.FM Ops`, self-hosted, destination `ops.rad-fm.com` |
| Policy | `Owner only` - Emails == `patrick.jm.quinn@gmail.com` |
| Team domain | `long-wildflower-f4fb.cloudflareaccess.com` (auto-generated) |
| Secret | `CLOUDFLARE_API_TOKEN`, scoped read-only |
| Zero Trust | Free plan, 50 seats |

Verified after deploy: an anonymous request to `/api/session`, `/api/cf/ae/probe` and `/` all return
**302 to the Access login** for the correct AUD. Nothing - not even the SPA shell - is served
without authenticating.

Redeploying: `npm run deploy`. **Never revert `ACCESS_AUD` to the placeholder** - that re-enables
the local-dev bypass, and while `worker/access.ts` refuses to serve on a non-local host if it
happens, relying on that is not the same as configuring it.

---

## 1. What this is for

Today, answering "is Rad.FM healthy?" means running `wrangler` by hand, reading the Workers Logs
dashboard, and writing one-off scripts. That has already cost real incidents:

- A stale `premium_users` row silently stripped paid segments from live subscribers. Invisible for
  months.
- 1,094 warnings in three days, ~60% of them one bug that had disabled setlists for a third of gigs.
  Nothing threw, so nothing surfaced it.
- An auth-refresh retry storm that read as **"0 Errors"** on the dashboard, because the headline
  error count includes only 5xx and uncaught exceptions - never 4xx.

The dashboard's job is to make that class of failure *visible by default*. It is an internal tool
for one to three people, not a product surface. Optimise for "answers a question in ten seconds",
not for looking impressive.

---

## 2. Architecture

**Recommendation: a separate Worker, with the backend owning all privileged logic.**

```
   Browser ──► Cloudflare Access (SSO gate)
                      │
                      ▼
             ops.rad-fm.com  (new Worker: radfm-ops)
             ├── static assets - React SPA
             └── BFF routes   - /api/cf/*  proxy to Cloudflare APIs, holds the CF token
                      │
                      ▼
             api.rad-fm.com/admin/*   (NEW routes in the existing backend)
             └── everything touching D1, KV, R2, entitlement
```

**Why this split rather than one Worker, or a pure SPA:**

- The ops Worker never holds `JWT_SECRET`, never holds Apple/Groq/Postmark keys, and cannot write
  to D1. Its blast radius if compromised is a read-only Cloudflare token.
- The Cloudflare API token cannot go in a browser bundle, so *something* server-side must proxy it.
  That is the BFF's entire job.
- Admin mutations (grant premium, delete user, purge cache) live next to the code that already
  understands those invariants, and get the existing rate limiting and audit trail for free.
  Reimplementing entitlement logic in a second codebase is how the two drift apart.

**Do not** give the ops Worker a D1 binding "just to make dashboards easier". The moment it has one,
it needs its own migrations, its own understanding of `premium_users` semantics, and it becomes a
second source of truth.

---

## 3. RBAC

> **STATUS: BUILT AND DEPLOYED.** The RBAC foundation described below now exists in the backend
> (`src/lib/auth/admin.ts`, `src/users/routes/admin.ts`, `migrations/0003`). This section is kept as
> the rationale. What you need to know to build against it is in §3a.

### What existed before this work

**There was no admin role. None.** Verified by grep across `src/`: no `role` column, no `is_admin`,
no permission check anywhere. The two privileged mechanisms were:

1. **`DEV_TKN_KEY`**, checked as the `X-API-Key` header in 7 places
   (`src/rad/services/llm/index.ts`, `src/music/index.ts`, `src/users/routes/auth.ts`,
   `src/rad/services/llm/listener.ts`). One shared static string. It gates prompt debug output,
   forced re-auth, and segment forcing. It is not tied to a user, is not rotatable without a
   redeploy, and nothing logs who used it.
2. **`REVIEW_ACCOUNT_EMAIL` / `REVIEW_ACCOUNT_OTP`** - the App Store reviewer account with a fixed
   OTP. Not an admin, but it is a second credential path worth knowing about.

So "reuse the existing admin" means **reuse the existing user auth** (email → OTP → JWT), because
that is what exists. There is no admin system to reuse.

### Proposed model - deliberately small

Three roles, stored in D1, seeded with **user 3 (patrick.jm.quinn@gmail.com) as `owner`**:

```sql
CREATE TABLE admin_users (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id),
  role       TEXT NOT NULL CHECK (role IN ('owner','operator','viewer')),
  granted_by INTEGER,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);
INSERT INTO admin_users (user_id, role, granted_by) VALUES (3, 'owner', 3);
```

| Role | Can |
|---|---|
| `viewer` | Read everything: metrics, logs, user lookup, config values |
| `operator` | Everything above, plus cache purge, re-run reconcile, resend OTP, requeue a job |
| `owner` | Everything above, plus grant/revoke premium, delete a user, change admin roles |

Rules that matter more than the table:

- **Role is resolved server-side on every request**, from the JWT's `userId` against `admin_users`.
  Never trust a role claim baked into a token - tokens outlive grants.
- **`owner` cannot demote itself** if it is the last owner. A dashboard that can lock you out of
  itself is a dashboard you will eventually be locked out of.
- **Every mutation writes an audit row** - actor, action, target, before/after, timestamp.
  `premium_audit` already does exactly this for entitlement and is the pattern to copy.
- **Two independent gates.** Cloudflare Access in front (SSO, so a lost laptop is revoked centrally)
  *and* the `admin_users` check in the backend. Access alone protects the UI but not the API;
  the role check alone means a leaked JWT is full access.

### Retire `DEV_TKN_KEY` as part of this

Once `adminAuth()` exists, the seven `X-API-Key` checks should move behind it. Right now one leaked
string grants prompt-debug and forced re-auth across the whole API, with no attribution. That is a
worse credential than anything the dashboard will introduce, and the dashboard is the natural moment
to kill it.

---

## 3a. What is already built - the contract you code against

Deployed to production. `admin_users` and `admin_audit` are created by
`migrations/0003_admin_rbac_and_played_at.sql` in the backend repo.

### Endpoints

All under `https://api.rad-fm.com`, all gated by `adminAuth('viewer')`, all read-only.

| Endpoint | Returns |
|---|---|
| `GET /admin/me` | `{userId, email, role, can:{read, operate, administer}}` - call this first and shape the nav from `can` |
| `GET /admin/stats` | Headline counters + `dataQuality.pastPlaysMissingPlayedAt` |
| `GET /admin/audit?limit=50` | Recent admin actions, newest first |
| `GET /admin/users/:id/entitlement` | User, local premium row, `premium_meta`, and last 20 `premium_audit` rows |
| `GET /admin/users/lookup?q=` | **operator only.** `{matches:[…]}` - id / email / RevenueCat subscriber id, branch decided server-side |
| `GET /admin/stations?limit=&offset=&q=` | `{stations:[…], total}` - `subscribers: 0` is an orphan |
| `GET /admin/metrics/setlists?hours=` | `{fillRate, sampled, filled, cities, source, truncated}` |
| `GET /admin/config` | `{values:[…]}` with `source`, `default`, `min`, `max`, `location`, `help` |
| `PUT /admin/config/:key` | **operator only.** Body `{"value":"400"}`; returns the updated entry |

All four handover routes are live. Notes that differ from the requested contract, or that the UI
needs to account for:

- **`/admin/metrics/setlists` returns `cities` and `truncated`; `windowHours` is echoed but cannot
  widen the window.** It is a snapshot of what `GIG_CACHE` currently holds (6h TTL), not a time
  series - the field is named `source: "gig_cache_snapshot"` so the panel cannot imply otherwise. The
  durable trend is the new Analytics Engine `setlist` event, which the dashboard should query
  directly with its own token. Production currently reads **0.7806** across 9 cities / 620 events.
- **`/admin/config` entries carry `min`, `max` and `help`.** Use them for client-side hints, but the
  server validates regardless - `detail` on a 400 is written for an operator to act on.
- **A config change takes up to 30 seconds to be globally visible.** `cfg()` memoises per isolate; the
  writing isolate resets immediately, so the dashboard shows the new value at once while other
  isolates serve the old one briefly. **Say so in the UI**, or someone will change a dial during an
  incident and conclude the backend ignored them.
- **Rate limiting on `/admin/*` denies with 404**, same as "not an admin", to keep the no-oracle
  property. If pages start 404ing for someone who was working a minute ago, suspect the limiter.
- **`/admin/users/lookup` is now `operator`, not `viewer`** (changed on request after the security
  review). Email prefix search is a directory walk in 20-row pages - bulk access to personal data,
  not "reading the dashboard" - and `viewer` exists so someone can watch metrics without being handed
  the user list.

  **This needs a client change.** `worker/backend.ts` passes 404 through untouched, and the UI renders
  a 404 as *"this backend route has not been built yet"*. A `viewer` opening Users will now be told
  the route does not exist, which is both wrong and alarming. The API deliberately will not
  distinguish "not allowed" from "not found", so **gate the search box on `can.operate` from
  `/admin/me`** - you already fetch it - and do not render a lookup a viewer cannot perform.

  Everything else on the surface stays viewer-readable, including `/admin/users/:id/entitlement`:
  looking up ONE user you already have an id for is support work, enumerating them all is not.

Auth is the user's existing JWT as `Authorization: Bearer <token>`. There is no separate admin
login - that is what "reuse the existing admin" resolved to.

### Behaviours you must design around

- **Unauthorised means 404, not 403.** Deliberate: a 403 confirms the surface exists and that the
  caller merely lacks a role. Do not build UI that distinguishes "not allowed" from "not found" -
  the API will not tell you, on purpose.
- **Role is resolved server-side per request.** Do not cache it beyond a page load, and never read a
  role from the token.
- **It fails closed.** Before the migration is applied, every `/admin/*` route 404s for everyone,
  including the owner. Verified in production. If the dashboard sees 404 for a known admin, check
  the migration before debugging the client.
- **`-1` is a "query failed" sentinel** in `/admin/stats`, not a real count. `premiumPct` is `null`
  rather than a number derived from a sentinel. Render both as "unavailable".
- **`activeUsers24h` / `activeUsers7d` are NOT listener counts.** Label them "users with play
  activity". See `FINDINGS.md`.
- **`/admin/users/:id/entitlement` degrades per-field**: `meta` or `audit` can be `null` while the
  rest succeeds. Do not treat a null section as "no entitlement".

### Mutations do not exist yet - by design

`adminAuth('operator')`, `adminAuth('owner')` and `auditAdminAction()` are implemented and tested;
no route uses them yet. The dashboard should earn trust on reads first. When you add the first
mutation, it must write an audit row in the same handler - that is the whole point of the table.

---

## 4. Cloudflare APIs available

All verified against current docs. Base: `https://api.cloudflare.com/client/v4`.
Account ID: `49b85a65aa7b9cd658945400b972d2b7`.

| Need | API | Endpoint | Token permission |
|---|---|---|---|
| Logs, error/warning search | Workers Observability | `POST /accounts/{acct}/workers/observability/telemetry/query` | Workers Observability : Read |
| Custom metrics (recs, DJ, upstream) | Analytics Engine SQL | `POST /accounts/{acct}/analytics_engine/sql` | Account Analytics : Read |
| Requests, errors, CPU/wall p50-p99 | GraphQL Analytics | `POST /graphql`, dataset `workersInvocationsAdaptive` | Account Analytics : Read |
| Ad-hoc SQL against D1 | D1 REST | `POST /accounts/{acct}/d1/database/{id}/query` | D1 : Edit |
| KV inspect / purge | KV REST | `/accounts/{acct}/storage/kv/namespaces/{id}/...` | Workers KV Storage : Edit |
| Deploy history, **rollback** | Workers Scripts | `/accounts/{acct}/workers/scripts/{name}/versions` | Workers Scripts : Edit |
| Artwork objects | R2 | S3-compatible API on `rad-fm-station-art` | Workers R2 Storage : Read |

Caveats worth knowing before you design around them:

- **Observability retains 3 days.** Anything you want beyond that must be copied into Analytics
  Engine or D1. This is the single biggest argument for the dashboard doing its own rollups.
- **The D1 REST API is rate-limited by the global Cloudflare API limit**, and Cloudflare's own docs
  say it is "best suited for administrative use". Fine for a dashboard; do not build a polling loop
  on it.
- **Rollback is limited to the 100 most recent versions**, and rolling back across a secret change
  requires `?force=true`.
- GraphQL analytics: up to one month per query, for dates up to three months old.

---

## 5. Data sources and what to show

### Analytics Engine - already instrumented, use this first

`src/lib/analytics.ts` is live and wired into the real code paths. Dataset `rad_fm_events`,
binding `ANALYTICS`. Three event types already emitting:

- `trackRecommendations` - source, timeOfDay, scene, poolSource, trackCount, poolSize, processingMs,
  meanEnergy, maxSwing, targetEnergy, degraded
- `trackDjLine` - style, textLength, llmMs, **degeneracyReason**, regenerated, fellBack
- `trackUpstream` - provider, model, outcome, attempts, latencyMs

This is the highest-value source in the system and nothing reads it yet. `degeneracyReason` alone
answers "is the DJ getting worse?" - a question currently answered by listening to the radio.

> **Blob and double slots are positional and Analytics Engine has no schema.** The field order in
> `src/lib/analytics.ts` is a contract. Append only; never reorder or repurpose a slot, or every
> historical row silently changes meaning. Put this in the dashboard's query layer as a comment too.

**Day-one task:** confirm data is actually landing. I could not verify this - it needs an API token
that does not exist yet. Run `SHOW TABLES`, then
`SELECT count() FROM rad_fm_events WHERE timestamp > now() - INTERVAL '1' DAY`.

### D1 - see `queries/d1.sql`

Live counts as of 5 Aug 2026: **631 users, 18 premium, 341 stations (all user-generated),
34,870 past plays, 4,507 liked songs, 13 new users in 7 days, DAU 15 / WAU 44.**

Read `FINDINGS.md` before writing any query involving play history. `past_plays.played_at` is
**NULL on all 34,870 rows** and the table stores current state, not history.

### Observability - the 4xx blind spot

The single most important panel in the whole dashboard: **4xx by route and status, over time.**
The headline "Errors" metric on Cloudflare's own dashboard excludes 4xx entirely, which is how a
total auth outage displayed as "0 Errors". Any ops tool for this system that does not surface 4xx
prominently has reproduced the bug it exists to prevent.

Second: **warning volume by normalised message.** Group by message with numbers and hex stripped -
`scripts/logs.ts` in the backend repo already implements exactly this grouping and is worth reading
before reimplementing it.

---

## 6. Config: what is set by hand today

This is the "stop editing constants and redeploying" section. Three tiers, and they should be
treated differently.

### Tier 1 - safe to make editable at runtime (KV-backed, with an audit row)

| Value | Location | Today |
|---|---|---|
| `FREE_DAILY_SPEAK` = 100, `PREMIUM_DAILY_SPEAK` = 1000 | `src/lib/entitlement/index.ts:34` | redeploy |
| `PREMIUM_TTL_S` = 300 | `src/lib/entitlement/index.ts:22` | redeploy |
| `MAX_OTP_ATTEMPTS` = 5, `OTP_TTL_MS` = 10min | `src/users/services/auth/index.ts:125` | redeploy |
| `MAX_ENRICH` = 25, `CONCURRENCY` = 6, subrequest budget 600 | `src/events/**` | redeploy |
| `TRANSITION_MIN_WORDS` / `GREETING_MIN_WORDS` = 24 | `src/rad/constants/index.ts:164` | redeploy |
| Rate limit 100 req / 60s | `wrangler.jsonc` unsafe binding | redeploy |
| IP denylist `deny:ip:<ip>` | `RATE_LIMIT_KV` | manual KV edit |

### Tier 2 - expose read-only, edit via PR

The recommendation weights (`W_ENERGY` 0.28, `W_VALENCE` 0.18, `W_ACOUSTIC` 0.17, `W_TEMPO` 0.17,
`W_HARMONIC` 0.20 in `PlaylistOptimizer.ts`), `MAX_PER_ARTIST`, `MIN_ARTIST_SEPARATION`,
`POP_ANTHEM_PCT`. These interact - they are a tuned system, not independent dials, and the weights
are meant to sum sensibly. A dashboard slider here produces confident nonsense. Show the current
values next to the outcome metrics so you can *see* the effect of a change; make the change in code.

### Tier 3 - never expose

Prompt pools and exemplars (`src/rad/constants/golden.ts`, `src/rad/services/llm/station.ts`).
These are version-controlled creative assets with a test suite asserting their properties. Editing
them through a web form loses review, loses history, and loses the tests.

**Suggested mechanism for Tier 1:** a single `config:<key>` KV namespace read through a helper with
a hard-coded default, so a missing or malformed KV value falls back to today's constant rather than
to zero. Cache with a short TTL. The default must live in code - a config system that fails to an
empty value is worse than no config system.

---

## 7. Recommended stack

Chosen for a two-person internal tool that must be cheap to maintain, not for maximum capability.

| Layer | Pick | Why |
|---|---|---|
| Runtime | **Cloudflare Workers + Static Assets** | Same platform, same deploy story, Access integrates natively |
| Build | **Vite + `@cloudflare/vite-plugin`** | Runs the Worker in `workerd` locally, so dev matches prod |
| BFF | **Hono** | Same framework as the backend - one mental model, and the team already knows it |
| UI kit | **shadcn/ui** | Copy-in components, no lock-in, matches how the backend is written |
| Charts | **Tremor** | Purpose-built for analytics dashboards, pairs with shadcn, Vercel-backed |
| Tables | **TanStack Table** | Headless; the user/station browsers need sorting and filtering over a few hundred rows |
| Data fetching | **TanStack Query** | Polling, cache invalidation and stale-while-revalidate for free |
| Auth | **Cloudflare Access** + backend role check | Two gates, no password handling of our own |

Deliberately **not** recommending Grafana or Retool: both mean another system to run and pay for,
and neither can express the domain checks that make this dashboard worth building (entitlement
drift, DJ degeneracy rate, setlist fill rate). Start with a single Worker; revisit only if the ops
team grows past a handful of people.

---

## 8. Secrets

See `.dev.vars.example` for the full annotated list.

**I have deliberately not copied any live secret values into this repo.** Two reasons, and I would
push back if asked again:

1. The ops dashboard should not reuse the backend's credentials. Its Cloudflare token should be a
   **new, scoped, mostly read-only** one - that way a compromise of an internal tool cannot rewrite
   DNS or deploy Workers. Copying the existing token across throws that away.
2. It should never hold `JWT_SECRET`, `OPENAI_API_KEY`, `APPLE_MUSIC_DEV_TOKEN`, `POSTMARK_TOKEN`
   or `GROQ_API_KEY`. Under the architecture in §2 it has no use for any of them, and every one
   copied in is a new place to leak from.

There is also live history here: a `.dev.vars.bak` containing production secrets was committed to
the backend repo, and the decision was taken not to rotate. That is exactly the failure mode worth
not repeating in a fresh repo - so `.gitignore` ships with `.dev.vars*` on day zero.

**Patrick - you need to create one thing before the team can start:** a Cloudflare API token with
the permissions listed in `.dev.vars.example` §1. Everything else in this build is derivable from
what is already in the backend repo.

---

## 9. Build phases

Sequenced so each phase is independently useful and the risky part comes after the cheap wins.

**Phase 0 - foundations.** ✅ **Done.** Backend: `admin_users`, `admin_audit`, `adminAuth()`, the
audit helper and four read-only `/admin/*` routes, with 24 tests covering forged, expired,
refresh-as-bearer, smuggled-role and missing-table cases. See §3a. Ops Worker: scaffolded, with
Access JWT verification against the team JWKS in `worker/access.ts`. **That file is the
security-relevant part of the build and has not been reviewed by anyone but its author - get it
reviewed.** It pins RS256, checks `aud` and `exp`, and fails closed, but it is hand-rolled crypto
glue and deserves a second pair of eyes.

**Phase 1 - read-only health.** ✅ **Built and now validated against the live APIs.** Requests / CPU
from GraphQL, **4xx by route** from Observability, grouped warnings, deploy history. Every query
shape was wrong when written from the documentation, and each failure was silent rather than loud -
see `CLAUDE.md` § "Cloudflare API response shapes". The worst: `dimensions.status` in the GraphQL
dataset is an invocation outcome (`success`), not an HTTP code, so the 4xx and 5xx tiles read **0
forever** - this dashboard reproducing the precise bug it exists to expose.

**Phase 2 - domain panels.** ✅ **Built**, same caveat, plus one specific to it: only the `recs` and
`dj` Analytics Engine slot mappings are confirmed (RUNBOOK validates them). The `upstream` mapping
is read from source and never checked against real rows, so the Rad view labels that table as
unconfirmed rather than presenting it as fact. Setlist fill rate is **not** built - it needs a
backend metric that does not exist yet.

**Phase 3 - user operations.** ✅ **Built.** Entitlement with the local row and RevenueCat side by
side, lookup by user id / email / RevenueCat id, and the Stations browser. The RevenueCat side
renders "unavailable" rather than "no subscription" when the backend does not return it.

**Phase 4 - runtime config.** ✅ **Built**, capability-gated. The Config view shows each Tier 1 value
with whether it came from KV or from the constant in code, and the inline editor enables only when
the backend serves `/admin/config` *and* the caller is `operator`. Until then it is the design's
disabled control, with the reason in its `title`.

**Backend delivered, 5 Aug 2026.** All four requested routes shipped, plus the scoped Cloudflare
API token. Two things changed on the way in and the client had to follow:

- **`/admin/users/lookup` is `operator`, not `viewer`.** Email prefix search is a directory walk in
  20-row pages - bulk access to personal data rather than dashboard reading. The Users view no
  longer calls it for a viewer, and explains why instead of showing a bare 404.
- **Config writes take up to 30s to go global.** `cfg()` memoises per isolate, so this page shows
  the new value immediately while other isolates serve the old one. The Config view says so after a
  save; without it an operator changes a dial mid-incident and concludes the backend ignored them.

The interim "this route is not built yet" messaging has been **removed**. It inferred that from a
404, which is now wrong: a 404 means the rate limiter, an insufficient role, or a missing migration.
Keeping it would have misdiagnosed all three.

Deliberately last: anything that writes. The dashboard earns trust by being right about reads before
it is allowed to change anything. `worker/backend.ts` rejects non-GET methods as well as the UI
omitting the controls, so enabling the first mutation is a deliberate act in two places.

---

## 10. Gotchas found the hard way

- **D1 rejects `too many terms in compound SELECT`.** A stats query stacking `UNION ALL` counts
  across ~10 tables fails with `SQLITE_ERROR 7500`. Run them as separate queries or use
  `d1.batch()`. Hit while writing `queries/d1.sql`.
- **D1 `bind()` accepts only null, number, string and ArrayBuffer.** Not booleans, not `undefined`.
  Passing a boolean throws at runtime; `JSON.stringify(undefined)` returns `undefined`, not
  `"undefined"`. This has already caused a production 500 in `saveStation`.
- **The wrangler OAuth token does not work against `api.cloudflare.com/client/v4`.** It returns
  `10000 Authentication error` regardless of freshness. You need a real API token. This wastes an
  hour if you do not know it.
- **`workers_dev: true`** means `rad-fm-backend.veme.workers.dev` is publicly reachable and bypasses
  any custom-domain protection. Worth deciding whether that stays true for the ops Worker - it
  should not.
- **Observability retains 3 days**, so any trend longer than that must be rolled up and stored.
- **Analytics Engine writes are fire-and-forget** - no acknowledgement, no await. Absence of a
  datapoint is not proof an event did not happen.
