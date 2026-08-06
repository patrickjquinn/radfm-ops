# Backend work for the ops dashboard — 6 August 2026

**For:** whoever owns `rad-fm-backend`
**From:** `radfm-ops`, live at `ops.rad-fm.com`
**Replaces** `Ops-Dashboard-Backend-Handover-2026-08-05.md`. Parts 1 and 2 are unchanged and still
outstanding. **Part 3 is rewritten** — the previous version asked you to verify Access JWTs by hand;
Cloudflare has a purpose-built feature for it, and the dashboard side is already done.

---

## Part 3 (rewritten) — Access Linked App Token, not a shared secret

### The problem this closes

The dashboard authenticates twice: Cloudflare Access at the perimeter, then a Rad.FM JWT to reach
`/admin/*`. That second credential is currently a 90-day token minted by hand and held as a Worker
secret. It expires, and when it does half the dashboard goes dark.

The tempting fix — put `JWT_SECRET` in the ops Worker so it can mint its own — was rejected. That
key signs and verifies every access and refresh token for all 632 users. Moving it into a dashboard
that proxies third-party APIs turns any proxy bug there into "forge any user's identity". Worker
secrets are encrypted properly; the objection is scope, not storage.

### The actual answer

[**Access Linked App Token**](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/linked-app-token/)
does exactly this, with no secret anywhere:

1. A user authenticates to Application A (`ops.rad-fm.com`). Access sends the signed JWT in
   `Cf-Access-Jwt-Assertion`.
2. Application A forwards it to Application B as `Cf-Access-Token`.
3. Access validates the token was issued for A, mints a new JWT scoped to B's AUD, and
   **attributes the request to the original user in the audit log**.

Mapped onto us:

| | |
| --- | --- |
| Application A | `ops.rad-fm.com` — exists |
| Application B | `api.rad-fm.com/admin` — **you create this** |
| Forwarding | **already done** — the ops Worker sends `Cf-Access-Token` on every `/admin/*` call |

**Path scoping is confirmed supported**, so Application B covers `api.rad-fm.com/admin` only. The
API the iOS client uses is untouched — that was the open question and it checks out.

### What you need to do

1. **Create a self-hosted Access application** for `api.rad-fm.com/admin`.
2. **Add a Linked App Token policy** to it, with `app_uid` set to the ops dashboard's application
   id. The rule type requires a `non_identity` decision, like service tokens:

   ```bash
   curl "https://api.cloudflare.com/client/v4/accounts/49b85a65aa7b9cd658945400b972d2b7/access/policies" \
     --request POST --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
     --json '{
       "name": "Allow requests from the ops dashboard",
       "decision": "non_identity",
       "include": [{ "linked_app_token": { "app_uid": "<ops app uid>" } }]
     }'
   ```

   The ops application's uid is `acafcec7-e506-4674-a0f4-06dbfdc1c101`. Its AUD, which you will
   need if you verify manually rather than relying on Access, is
   `b01e1140660d0a36b16f6e988774ac57e1c456bac1d36cb79108cee28450fe88`.

3. **Have `adminAuth` accept the resulting `Cf-Access-Jwt-Assertion`**, mapping the verified email
   onto `admin_users` exactly as it maps `userId` today. Role still resolves from D1 per request.

Once that is live, delete `OPS_BACKEND_JWT` from the ops Worker and the hand-minted token is gone.

### One trap that will cost you an hour — it cost me one

**Access pins an application's `iss` at creation and does not update it when the Zero Trust team is
renamed.**

The ops application was created while the team was auto-named `long-wildflower-f4fb`. The team was
later renamed to `radfm`. Tokens are *still* issued with:

```
iss: https://long-wildflower-f4fb.cloudflareaccess.com
```

Verified by renaming, logging out, logging back in, and reading the claim off a live request. The
JWKS lives at the **current** team domain (`radfm.cloudflareaccess.com`); the issuer is the **old**
one. Every code sample conflates them, because on an account that has never been renamed they are
the same string.

The failure mode is nasty: valid signature, correct `aud`, rejected on `iss` alone, presenting as
"Access auth is broken" rather than as a config mismatch. If you verify manually, keep the JWKS
domain and the expected issuer as separate settings. `radfm-ops/worker/access.ts` does this and is a
working reference — about 40 lines using `jose`:

```ts
const { payload } = await jwtVerify(token, keySet(TEAM_DOMAIN), {
  issuer: ACCESS_ISSUER,        // NOT `https://${TEAM_DOMAIN}`
  audience: ACCESS_AUD,
  algorithms: ['RS256']
});
```

Use `jose` with `createRemoteJWKSet` rather than hand-rolling — it covers signature, alg, `exp`,
`nbf`, `aud` and `iss` in one call and handles key rotation. Our hand-rolled version passed a
security review and still had two holes and no `iss` check at all.

---

## Part 1 (unchanged) — Two gaps that keep panels dark

### 1.1 `/admin/users/:id/entitlement` has no RevenueCat side — HIGH

Still the most valuable item. The panel renders **"NOT CROSS-CHECKED"** because only the local row
is available, so it cannot detect the stale cache it was built to detect.

Add to the existing response:

```json
"revenueCat": { "active": true, "expires": "2026-09-14", "productId": "...", "checkedAt": "..." }
```

`revenueCat: null` on failure is correct and already handled. **Never return `active: false` when
you mean "could not reach RevenueCat"** — that is the stale-cache bug in a new costume. Timeout it
and degrade to null; the rest of the payload must still return.

### 1.2 No RevenueCat cron status — MEDIUM

The reconcile cron is the only server-initiated revocation path and has been silently misconfigured
before. The card reads **"Not instrumented"** — deliberately not "unavailable", because nothing is
being read and so nothing has failed.

Suggested: `GET /admin/metrics/cron` → `{ lastRunAt, outcome, rowsReconciled, durationMs }`.
Cheapest source is an `admin_audit` row written by the cron itself, which also makes a run that
fails to write its row visible as a gap.

---

## Part 2 (updated numbers) — Production findings

None of these throw. Live 24h window at time of writing: **666 4xx, 0 5xx.**

### 2.1 The recommender is falling back, and it is getting worse — HIGH

| source | pool avg | proc ms | degraded |
| --- | ---: | ---: | ---: |
| `live` | 96 | 5505 | **0** |
| `fallback` | **0** | 6624 | **21** |

**Fallback rate has climbed 13% → 15.8% → 20% across today.** Pool average 48 against a 400 floor.
The `fallback` pool size is *zero* — the live pipeline returns nothing at all, then the user is
served their own library. Corroborated by a warning in the same window:

```
Recommendations degraded → source=fallback tracks=<n>
(live pipeline returned no tracks; served from user library)
```

Worth determining whether the Apple candidate stage or the ReccoBeats feature stage returns empty,
and whether the 6624ms fallback path is hitting a timeout that *causes* the empty result.

### 2.2 setlist.fm artist lookups dominate the warnings — MEDIUM

`[setlists] last.fm fallback failed for "…": The artist you supplied could not be found` — the
largest single warning group. Fill rate is **89% (72/81 gigs)**, so not on fire, but it is a
known-bad shape and the biggest source of noise.

### 2.3 `premium_meta` provenance — LOW

User 3 has `rc_subscriber_id` = `3` (a user id where a RevenueCat subscriber id belongs) and an
empty `premium_since`. The "premium rows with no provenance" case from `queries/d1.sql`.

---

## Part 4 — Contracts the dashboard depends on

Verified against live responses and now covered by tests in `src/lib/contract.test.ts`. A renamed
field reads as `undefined`, which renders as **"unavailable"** — a false "unavailable" is the same
class of lie as a false zero, and it shipped once already. If you rename one, say so.

| Route | Fields read |
| --- | --- |
| `/admin/stats` | `users`, `premium`, `premiumPct`, `stations`, `plays`, `liked`, `activeUsers24h`, `activeUsers7d`, `newUsers7d`, `dataQuality.pastPlaysMissingPlayedAt` |
| `/admin/audit` | `{ entries: [...] }` with `actor_id`, `actor_email`, `action`, `target`, `outcome`, `created_at` |
| `/admin/users/:id/entitlement` | `user`, `local.isPremium`, `local.grantedAt`, `meta`, `audit` |
| `/admin/config` | `{ values: [{ key, value, source, default, location, updatedAt, updatedBy }] }` |
| `/admin/metrics/setlists` | `fillRate` (0–1, not a percentage), `sampled`, `filled`, `windowHours` |
| `/admin/stations` | `{ stations: [...], total }` |
| `/admin/users/lookup` | `{ matches: [...] }` — operator-gated |

Please keep: `-1` as the query-failed sentinel, `premiumPct` null rather than derived from one,
404-not-403 for unauthorised, and per-field degradation on entitlement.

---

## Part 5 — Already working

Migration 0003 applied, all nine `/admin/*` routes responding, Analytics Engine receiving,
`past_plays` missing `played_at` at **0 rows**, setlist fill **89%**, DJ pass rate **~86%** (the
healthy baseline — the dashboard does not warn until non-`ok` exceeds 25%), 632 users / 19 premium /
342 stations / 35,104 plays / 4,509 liked.
