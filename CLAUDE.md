# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`radfm-ops`: an internal ops dashboard (a Cloudflare Worker at `ops.rad-fm.com`) for Rad.FM, an AI radio product whose backend is a separate repo at `~/Developer/rad-fm-backend`. It is **both the app and its own build spec** — `README.md`, `FINDINGS.md` and `RUNBOOK.md` are the research the design is a reaction to, and they are still the authority on why the UI behaves as it does.

The backend half of Phase 0 is built and deployed in that other repo (admin RBAC, audit table, four read-only `/admin/*` routes, migration `0003`). This repo is the dashboard that consumes it.

Everything in the spec documents was verified against the live system on 5 August 2026 — live D1, live `wrangler.jsonc`, live source. Claims that were inferred rather than checked say so explicitly; preserve that distinction when editing them.

**Deployed to `ops.rad-fm.com` on 5 Aug 2026**, behind a Cloudflare Access application (`Rad.FM Ops`, policy `Owner only`). Zero Trust Free is active on the account. `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are real values in `wrangler.jsonc` — reverting either to the placeholder re-enables the dev bypass.

**Backend state, 5 Aug 2026:** all nine `/admin/*` routes exist, including the four requested in `docs/BACKEND-HANDOVER.md`, and the scoped Cloudflare API token has been created. Every `worker/cf.ts` query has since been run against the live APIs and corrected — see § "Cloudflare API response shapes". The one path still unexercised end to end is the operator-JWT flow against the real `/admin/*` (it was verified against a stub, not production).

**`/admin/users/lookup` is `operator`, not `viewer`** — email prefix search is a directory walk, so it is bulk access to personal data rather than dashboard reading. The client must not call it for a viewer; a viewer who did would get a bare 404 indistinguishable from a rate limit. See `SECURITY-REVIEW.md` §4.

## Reading order

1. `RUNBOOK.md` — day-one setup, health checks, known time-wasters
2. `README.md` §3a — the `/admin/*` contract the client codes against
3. `FINDINGS.md` — what the live system actually looks like, including the schema traps
4. `queries/d1.sql` — every query was run against production and is annotated with its real result
5. `.dev.vars.example` — every secret needed, with provenance and a "must never hold" list
6. `SECURITY-REVIEW.md` — the red-team of the admin surface, and the accepted risks the UI has to carry
7. `docs/BACKEND-HANDOVER.md` — historical: the four routes requested on 5 Aug, all since delivered

## Commands

```bash
npm run dev          # Vite + workerd (localhost:5173), so dev matches prod
npm run build        # SPA to dist/client, Worker to dist/radfm_ops
npm run typecheck    # tsc --noEmit
npm run deploy       # vite build && wrangler deploy
npx wrangler deploy --dry-run   # verify bindings without shipping
```

There are no tests yet. `?demo=healthy` and `?demo=incident` render the design against fixtures — that is currently the only way to exercise the populated states, and it is how to check a UI change without a token.

Ops commands that touch the live system live in the **backend repo** (`cd ~/Developer/rad-fm-backend`, which uses `bun`/`bunx`):

```bash
bunx wrangler d1 execute RAD_USERS --remote --command "<sql>"   # ad-hoc D1, one query at a time
bun scripts/logs.ts --status 4xx --hours 6                      # 4xx — check this BEFORE errors
bun scripts/logs.ts --level warn --hours 48                     # groups by normalised message
curl -s https://api.rad-fm.com/admin/me -H "Authorization: Bearer $TOKEN"
```

## Code layout

- `worker/` — the BFF. `access.ts` verifies the Access JWT against the team JWKS (**the security-relevant file**); `cf.ts` exposes *named* Cloudflare queries, never a generic passthrough, because a passthrough hands the browser the token's full authority; `backend.ts` proxies `/admin/*` through a per-method allowlist — reads are broad, and the only write that can cross is a Tier 1 config value.
- `src/views/` — one file per view, matching the nine nav entries.
- `src/lib/health.ts` — **the single derivation of "how is it going"**, feeding both the nav badges and the Overview verdict. Do not compute either independently: two counts of the same thing disagreeing on one screen is the exact failure this tool exists to prevent.
- `src/lib/api.ts` — every source resolves to `Loaded<T>` = loading | unavailable | ok. `unavailable` is a first-class state; never collapse it to 0 or an empty chart.
- `src/lib/fixtures.ts` — demo data. Opt-in by URL, self-announcing, and **never** a fallback when a live source fails.
- `src/theme.ts` — tokens lifted verbatim from the design.
- `src/icons.tsx` — `@carbon/icons-react`, mapped under the SF Symbols names the design used, so views read against the design rather than Carbon's vocabulary. Changing an icon is one line. They render `fill="currentColor"`, which is why there is no separate "teal" icon set as in the prototype.

Styling is inline `style` objects, matching the design's own idiom. There is no CSS framework; `src/styles.css` holds only resets, the pulse keyframe, focus rings and the responsive breakpoint.

## Architecture

Two Workers, with a hard privilege boundary:

```
Browser ─► Cloudflare Access (SSO) ─► ops.rad-fm.com (radfm-ops)
                                       ├── React SPA (static assets)
                                       └── BFF /api/cf/* — holds the Cloudflare API token
                                                 │
                                                 ▼
                                      api.rad-fm.com/admin/*  ─► D1, KV, R2, entitlement
```

Invariants that the whole design rests on — do not quietly relax them:

- **The ops Worker gets no D1 binding.** Not "just for dashboards". The moment it has one it needs its own migrations and its own model of `premium_users` semantics, and becomes a second source of truth.
- **It never holds `JWT_SECRET`**, nor Apple/Groq/OpenAI/Postmark/RevenueCat keys. Admin identity is resolved by the backend from the user's existing JWT. See `.dev.vars.example` §4 for the full never-hold list.
- **Two independent gates**: Cloudflare Access in front *and* the backend's `admin_users` check. Access protects the UI route only — the Worker must verify the `cf-access-jwt-assertion` header against the team JWKS itself, or anything reaching the Worker directly bypasses SSO.
- **New privileged logic goes in the backend**, next to the code that already understands the invariants and already has rate limiting and audit.
- **The Access gate has a dev bypass keyed on `ACCESS_AUD` still being the wrangler.jsonc placeholder.** Configuring Access closes it automatically, which is the point — but a half-configured deploy is an open one. Never key it on `NODE_ENV` instead.
- **There is no admin login, by design.** The operator supplies their own Rad.FM JWT (sidebar field → `sessionStorage` → `X-Rad-Jwt` header → backend `Authorization`). The Worker holds no user credential of its own. `DEV_BACKEND_JWT` is a local-dev convenience and must not become a production secret — that would give every Access user the rights of whoever's token it is, reintroducing exactly the attribution problem `DEV_TKN_KEY` has.

## The `/admin/*` contract

Four read-only endpoints on `https://api.rad-fm.com`, all gated by `adminAuth('viewer')`, authenticated with the user's normal JWT as a bearer token. `GET /admin/me` returns `can:{read, operate, administer}` — call it first and shape the nav from it.

Behaviours that will read as bugs if you don't know them:

- **Unauthorised returns 404, not 403** — deliberate. Never build UI that distinguishes "not allowed" from "not found"; the API won't tell you.
- **It fails closed.** Before migration `0003` runs, every `/admin/*` route 404s for *everyone* including the owner. A 404 for a known admin means check the migration first.
- **`-1` in `/admin/stats` is a "query failed" sentinel**, not a count; `premiumPct` is `null` in that case. Render both as "unavailable".
- **`activeUsers24h`/`activeUsers7d` are not listener counts** — label them "users with play activity" (see the `past_plays` trap below).
- **`/admin/users/:id/entitlement` degrades per field** — `meta` or `audit` can be `null` while the rest succeeds. Null ≠ "no entitlement".
- **Role is resolved server-side per request.** Never read a role from a token; don't cache beyond a page load.
- **A 404 has three causes and the API won't say which**: the per-IP admin rate limiter, a role below the route, or migration 0003 missing. The limiter is the likeliest when something that worked a minute ago stops. `reasonText('not_found')` says all three, in that order — don't shorten it to "unauthorised".
- **Config writes take up to 30s to go global.** `cfg()` memoises per isolate, so the writing isolate (the one this page just read) shows the new value immediately while others serve the old one. The Config view says so after a save; removing that line makes the backend look broken during an incident.

Thresholds in `src/lib/health.ts` are calibrated to measured baselines, not round numbers: the DJ guard rejects ~14% of takes when healthy, so the warn line is 25%, and there is a `MIN_SAMPLE` floor because DJ events run ~44/day and a 6h window is too small to mean anything. Re-check these if the baselines move.

`adminAuth('operator')`, `adminAuth('owner')` and `auditAdminAction()` exist and are tested but no route uses them — mutations are deliberately last. The first mutation must write an audit row in the same handler.

## Data traps

These have each already cost real time or caused a real incident:

- **`past_plays` is current state, not history.** `played_at` is now backfilled, but the primary key collapses to `(user_id, song)` and re-plays overwrite. "Listening hours", "top played" and "skip rate" are not answerable from it — use `created_at`, and get real history from Analytics Engine `trackPlay` events, which start at the deploy date and **cannot be backfilled**.
- **Read the live schema, never `migrations/`.** The backend's migrations directory does not describe production; several live tables have no tracked migration.
- **`premium_users` is a cache of RevenueCat, not truth.** A stale row silently stripped paid segments from live subscribers. Any entitlement panel must show the local row *and* the RevenueCat answer.
- **D1: `SQLITE_ERROR 7500`** on ~10 stacked `UNION ALL` counts. Run separately or `d1.batch()`.
- **D1 `bind()` takes only null/number/string/ArrayBuffer** — not booleans, not `undefined`. This has caused a production 500.
- **Analytics Engine blob/double slots are positional and unschema'd.** Field order in the backend's `src/lib/analytics.ts` is a contract: append only, never reorder or repurpose, or every historical row changes meaning. Writes are fire-and-forget, so an absent datapoint is not proof the event didn't happen.
- **Observability retains 3 days.** Longer trends must be rolled up into Analytics Engine or D1.
- **The wrangler OAuth token does not work against `api.cloudflare.com/client/v4`** (`10000 Authentication error`, however fresh). A real scoped API token is required — creating it is the one blocking prerequisite left.
- **Timestamps: D1 is TEXT `'YYYY-MM-DD HH:MM:SS'`; `premium_meta.premium_since` is ISO-8601 with `Z`.** Normalise before comparing.

## Cloudflare API response shapes — verified live, 5 Aug 2026

Every one of these was wrong when written from the docs, and each produced a plausible-looking but false panel. Do not "correct" them back toward what the documentation implies without re-checking against a real response.

- **`workersInvocationsAdaptive.dimensions.status` is NOT an HTTP status code.** Live values are `success`, `clientDisconnected`, `scriptThrewException`. Parsing it as a number gave `NaN`, so the 4xx and 5xx tiles read **0 forever** — this dashboard reproducing the exact bug it exists to expose. HTTP statuses come from Observability only; `sum.errors` is the exceptions count (the platform's own headline metric).
- **`quantiles.*` are in MICROSECONDS.** A healthy p99 rendered as `157417ms`. Wall time legitimately reaches minutes because Rad streams MP3 audio — a large wall p99 is not on its own a fault.
- **Observability event messages live at `source.message`**, not `$workers.event.message`. Reading the latter returned empty for every event, so the warnings panel showed "no warnings" over a window that contained hundreds.
- **Observability groups on the literal path**, so `/apple/v1/me/library/playlists/p.9oD…/tracks` is its own row. `worker/cf.ts` collapses ids to `:id` — without it the table fragments and every share percentage divides by the wrong denominator.
- **`degeneracyReason` carries parameters**: `too-short(20w < 24)`, `wrong-track("a-ha")`. Grouped raw, one failure mode becomes six one-count rows. Stripped to the bare reason in `worker/cf.ts`.
- **Warning normalisation collapses quoted literals** as well as numbers and hex — beyond what `scripts/logs.ts` does. The setlist lookup failure arrives once per artist name; collapsing turned dozens of 1-count rows into a single row reading **519 in 24h**, which is the whole point of the panel.
- **Analytics Engine `n` values are strings**, and ingestion lags — a datapoint can take over a minute to be queryable, so one empty result is not proof a code path is cold.

## Editorial conventions for the docs

These files are the handover, and their value is that they are honest about uncertainty:

- Distinguish verified from inferred, and date the check. Numbers in `FINDINGS.md` and `queries/d1.sql` are real production values from a stated day, not illustrations — don't invent or refresh them without re-running.
- Record *why* a thing is the way it is (why 404 not 403, why no D1 binding, why no live secrets), not just what it is.
- `.gitignore` ships `.dev.vars*` on day zero because a `.dev.vars.bak` full of production secrets was once committed to the backend repo. No live credential value belongs in this repo — `.dev.vars.example` documents provenance only.

## Build phases

Phase 0 backend ✅ done; still to do here: scaffold the Worker, wire Access, verify the Access JWT — get that part reviewed. Then: **1** read-only health (4xx by route is the single most important panel — Cloudflare's headline "Errors" excludes 4xx, which is how a total auth outage displayed as "0 Errors"), **2** domain panels from Analytics Engine (DJ degeneracy rate, recommendation degraded rate, setlist fill rate), **3** user operations read-only, **4** Tier-1 runtime config in KV with code-side defaults. Anything that writes comes last, by design.
