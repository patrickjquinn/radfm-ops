# Backend requests from a page-by-page audit — 6 August 2026

**For:** `rad-fm-backend`
**From:** `radfm-ops`
**Context:** walked all nine views against live data looking for anything rendering that was not
real. Most of what I found was mine and is fixed. Four things need you.

---

## 1. `GET /admin/users` — the directory. HIGH, and it is blocking a whole view.

**The ask:** a paginated, filterable user list.

The Users view is specified in the design as a directory: four stat cards, filter chips, and a table
with local and RevenueCat state side by side. It cannot be built. `/admin/users` returns
`{"message":"Not found"}`.

What exists and works: `/admin/users/:id/entitlement` and `/admin/users/lookup`. So the dashboard can
resolve a user you already have an identifier for, and show their entitlement in full. What it cannot
do is show you the list, which is the case where you do not yet know whose account is wrong.

Suggested shape, matching the routes you already have:

```
GET /admin/users?filter=all|premium|drift|admin&limit=50&cursor=<opaque>
→ { users: [{ id, email, local, revenueCat, lastActive }], total, cursor }
```

- **`local`** — `premium_users.is_premium`, or null if there is no row. Null and false are different
  and the UI renders them differently.
- **`revenueCat`** — the live answer, same as the entitlement route already returns. If a per-row
  RevenueCat call is too expensive for a list, **return `revenueCat: null` and say so** rather than
  echoing `local` into it. A column that silently mirrors the other one makes the cross-check look
  like it agrees, which is worse than not having the column.
- **`filter=drift`** — rows where local and RevenueCat disagree. This is the one that matters most.
  It is the only view of the stale-cache bug that does not require checking users one at a time.
- **Server-side filter and pagination**, please. 634 rows to the client is not a directory, it is a
  download.

**Two counts on that page currently read "unavailable" and will stay that way until this lands:**
entitlement drift, and the admin count. Both need to compare every row. I have deliberately not
estimated either — a drift count of zero is the most reassuring number on that page and it must
never be a guess.

**Role:** `operator` seems right, matching `/admin/users/lookup`, and for the same reason — listing
the directory is bulk access to personal data, not dashboard reading.

---

## 2. `trackUpstream` appears to fire only on the failure path. MEDIUM

The upstream panel showed **"9 calls, 9 fail"** for groq, in a window where the DJ produced **210
good lines** on that same provider. Both cannot be true.

Two separate causes, one mine and one yours.

**Mine, fixed:** the query tested the outcome against the literal string `'ok'`:

```sql
sum(if(blob4 = 'ok', 0, 1)) AS fail
```

You do not write `'ok'`, so every call fell into the else branch and counted as a failure. The slot
mapping was never wrong — blobs are `[event, provider, model, outcome]` exactly as documented. I
invented a success token and then reported the mismatch as your provider failing. The panel now
groups by the outcome as recorded and guesses nothing.

**Yours, and worth a look:** with that fixed, all nine upstream events in 72h carry the same outcome:

```
"400 Failed to generate JSON. Please adjust your prompt. See"
```

Nine events, all failures, over three days, on a provider serving hundreds of successful DJ lines.
So either `trackUpstream` is only called on the error path, or it is only wired into the explorer and
not the DJ. Either way **a success rate is currently uncomputable from this dataset**, which is most
of what the panel is for.

Also: that outcome value is a raw error message, and a truncated one. As a dimension it is
high-cardinality and it changes whenever the upstream reword their errors — which will fragment the
grouping the same way the unnormalised warnings did. A short token (`ok`, `error:400`,
`error:timeout`) with the detail in a separate blob would fix both.

---

## 3. `/auth/refresh-token` 404s are the largest single 4xx route. MEDIUM

Carried over from the last handover because it is still live and still unexplained. **227 of them in
3 days**, the top 4xx route by a wide margin, against a total of 2,522 — which is **19.4% of all
requests**.

A 404 rather than a 401 on a refresh path is odd. If it means "refresh token not found", that is 227
sessions failing to refresh and presumably bouncing users to login.

---

## 4. Two contract notes

- **`/admin/users/lookup` returns `{ matches: [...] }`** and the dashboard depends on that key. Noting
  it because it is not in the original contract table.
- **`/admin/config` writes work and audit correctly** — verified live, `config.write` rows against
  `MAX_OTP_ATTEMPTS`, `MAX_ENRICH` and `PREMIUM_TTL_S` with the right actor. No action needed; this is
  the one mutation path in the product and it behaves exactly as documented.

---

## What the audit found on my side, for completeness

None of these need you. Listed so you know what the dashboard was getting wrong while it was
reporting on you.

| | |
|---|---|
| **5xx in the Overview verdict was the literal `'0'`** | A constant, in the most prominent position in the product, that would have read 0 through a total 500-level outage. Now read from GraphQL; unavailable renders as `-`. |
| **Users defaulted to `userId = '3'`** | Your account. The page always rendered populated, so a missing directory looked like a working screen showing one user. Nothing is selected until something is selected. |
| **Scoring weights rendered live from `fixtures.ts`** | Five hardcoded numbers on two views with no provenance and no unavailable state. Now labelled as transcribed from `src/rad/constants`, not read from the running system. |
| **`ACCESS_ISSUERS` was a single pinned value** | Cloudflare aligned the issuer with the current team domain; a fresh login produced a token this Worker rejected, and every panel then blamed its own source. Now a list, with the current team domain always accepted. **You had already shipped exactly this fix, as a list, for exactly this reason.** I read your note and implemented a single value anyway. |
| **The audit view's empty state claimed no mutations exist yet** | Stale since config writes shipped. It now says an empty table cannot distinguish "quiet" from "not being written". |

---

## Priority

1. **`/admin/users`** — blocks a designed view outright, and blocks the only bulk view of entitlement
   drift.
2. **`trackUpstream` coverage** — the panel cannot answer its own question without it.
3. **`/auth/refresh-token`** — 19.4% of all traffic is 4xx and this is the largest slice.

Everything else on the dashboard is now reading live data or saying plainly that it cannot.
