# Backend work the ops dashboard needs — 5 August 2026

**For:** whoever owns `rad-fm-backend`
**From:** `radfm-ops`, live at `ops.rad-fm.com` behind Cloudflare Access
**Supersedes nothing** — this is the second round. The four routes requested in the first
handover (`users/lookup`, `stations`, `metrics/setlists`, `config`) all shipped and all work.

The dashboard is now running against production with real data. Everything below is either a
gap it hit, or a production finding it surfaced that nothing else would have shown you.

Numbers are from a live 24h window on 5 Aug and will have moved by the time you read this.

---

## Part 1 — Two gaps that stop panels working

### 1.1 `/admin/users/:id/entitlement` has no RevenueCat side — HIGH

**This is the most valuable item on the list.** The entitlement panel exists for exactly one
reason: `premium_users` is a cache of RevenueCat that once went stale and silently stripped
paid segments from live subscribers. The panel is built to show the local row **and** the live
remote answer side by side, because agreement is the only way to know the cache is sound.

Right now the handler returns only the local half, so the panel renders **"NOT CROSS-CHECKED"**
and says plainly that it cannot detect the thing it was built to detect. It is not showing a
wrong answer — it is admitting it has no answer, which is the correct behaviour and also a
permanent state until this is fixed.

**What to add** to the existing response:

```json
{
  "user": { "...": "unchanged" },
  "local": { "isPremium": true, "grantedAt": "2026-08-05 16:14:51" },
  "meta": { "...": "unchanged" },
  "audit": ["...unchanged"],

  "revenueCat": {
    "active": true,
    "expires": "2026-09-14",
    "productId": "rad_fm_plus_monthly",
    "checkedAt": "2026-08-05T16:20:11Z"
  }
}
```

- `revenueCat: null` is fine and expected when the lookup fails — the client already renders
  a null section as "unavailable" rather than as "no subscription". **Do not return `active:
  false` when you mean "could not reach RevenueCat".** That is the stale-cache bug wearing a
  different hat.
- Reuse whatever live-confirmation path already exists — the backend added one when it stopped
  trusting a negative from `premium_users` alone. This is surfacing that, not building it.
- Timeout it (the existing live check uses 2.5s) and degrade to `null` rather than failing the
  whole request. The rest of the payload must still return.

Once this lands the panel flips itself to "In agreement" or "Drift detected" with no frontend
change.

### 1.2 No RevenueCat cron status — MEDIUM

The reconcile cron (`0 */6 * * *`) is **the only server-initiated revocation path**. Without it
a lapsed subscriber keeps Rad+ until they next open the app. It has been configured empty
before, and nothing ran, and nobody knew.

There is no way to ask whether it ran. The dashboard card currently reads **"Not instrumented"**
— deliberately not "unavailable", because nothing is being read and so nothing has failed.

**Suggested:** `GET /admin/metrics/cron` (viewer)

```json
{ "lastRunAt": "2026-08-05T12:00:04Z", "outcome": "ok", "rowsReconciled": 19, "durationMs": 1840 }
```

Cheapest source is an `admin_audit` row written by the cron handler itself on each run — which
also means a run that fails to write its row is itself visible as a gap.

---

## Part 2 — Production findings the dashboard surfaced

None of these threw. All three are invisible in Cloudflare's own error metric, which counts only
5xx and uncaught exceptions. **Live 4xx in the same window: 423. Live 5xx: 0.**

### 2.1 The recommender is falling back, and its fallback pools are empty — HIGH

Last 24h, from Analytics Engine `trackRecommendations`:

| source | pool avg | proc ms | degraded |
| --- | ---: | ---: | ---: |
| `live` | 96 | 5505 | **0** |
| `fallback` | **0** | 6624 | **21** |

**21 of 133 sets built (15.8%) were served from fallback, and the fallback pool size is zero.**
Overall pool average is **48** against a documented 400 floor. Corroborated by a warning in the
same window:

```
Recommendations degraded → source=fallback tracks=<n>
(live pipeline returned no tracks; served from user library)
```

That is the live pipeline returning **nothing** — not a small pool, not a degraded pool, an empty
one — roughly one request in six, and then the user being served their own library instead. It
degrades gracefully, so nothing throws, nothing alerts, and no error metric moves. This table is
the only place it is visible.

Worth checking first: whether the Apple candidate stage or the ReccoBeats feature stage is the
one returning empty, and whether the 6624ms fallback path is hitting a timeout that then
produces the empty result rather than the other way round.

### 2.2 setlist.fm artist lookups are the dominant warning — MEDIUM

Top warning by a wide margin in the last 24h, **32 of 61 total**:

```
[setlists] last.fm fallback failed for "…": last.fm error <n>: The artist you supplied could not be found
```

The dashboard collapses quoted literals when grouping, which is why this shows as one row with a
real count. Ungrouped it arrives once per artist name and reads like 32 unrelated one-off blips —
which is precisely how the 1,094-warning setlist bug stayed invisible for three days.

Current fill rate is **88% (123/140 gigs enriched)**, comfortably above the 0.70 line, so this is
not on fire. But it is the single largest source of warnings and it is a known-bad shape.

### 2.3 `premium_meta` provenance looks wrong — LOW, data quality

For user 3, the panel shows:

- `rc_subscriber_id` = **`3`** — that is a user id where a RevenueCat subscriber id belongs
- `premium_since` = **empty**
- `last_source` = `api`

This is the "premium rows with no provenance" case from `queries/d1.sql`. There is also a run of
~8 identical `api · Rad.FM+` rows in `premium_audit` on a single date. Some of that is our
end-to-end testing of the config write path, but the subscriber id is not.

---

## Part 3 — The change that removes a whole class of friction

### Accept the Cloudflare Access JWT for `/admin/*`

Today the dashboard authenticates the operator twice: once through Cloudflare Access at the
perimeter, and then again with a Rad.FM user JWT that a human has to obtain and supply. The ops
Worker deliberately holds no Rad.FM credential of its own, so that token has to come from
somewhere — currently a 90-day token minted by hand and stored as a Worker secret, guarded so it
is only ever attached for one named Access identity.

That works, and it expires, and when it expires half the dashboard goes dark until someone mints
another one.

**The fix:** have `adminAuth` also accept a verified `Cf-Access-Jwt-Assertion` header, mapping
the verified email onto `admin_users` exactly as it maps `userId` today.

- Verify against the team JWKS at `https://radfm.cloudflareaccess.com/cdn-cgi/access/certs`
- **Check the `aud` claim** equals `b01e1140660d0a36b16f6e988774ac57e1c456bac1d36cb79108cee28450fe88`
  — a token minted for a different Access application in the same team is signed by the same JWKS
  and will otherwise validate
- Resolve the role from `admin_users` by email, server-side, per request — same rule as now
- Reject anything without a valid `aud`, `exp`, and an RS256 header

`radfm-ops/worker/access.ts` already does exactly this verification and is a working reference —
it is about 60 lines. Once it lands, the Worker secret and the hand-minted token both go away.

---

## Part 4 — Contracts the dashboard now depends on

These were all verified against live responses. Changing them breaks panels silently, because a
missing field reads as `undefined`, which the client renders as **"unavailable"** — a false
"unavailable" is the same class of lie as a false zero, and we have already been bitten by it
once. If you rename a field, say so.

| Route | Fields the client reads |
| --- | --- |
| `/admin/stats` | `users`, `premium`, `premiumPct`, `stations`, `plays`, `liked`, `activeUsers24h`, `activeUsers7d`, `newUsers7d`, `dataQuality.pastPlaysMissingPlayedAt` |
| `/admin/audit` | `{ entries: [...] }` with `actor_id`, `actor_email`, `action`, `target`, `outcome`, `created_at` |
| `/admin/users/:id/entitlement` | `user`, `local.isPremium`, `local.grantedAt`, `meta`, `audit` |
| `/admin/config` | `{ values: [{ key, value, source, default, location, updatedAt, updatedBy }] }` |
| `/admin/metrics/setlists` | `fillRate` (0–1, not a percentage), `sampled`, `filled`, `windowHours` |
| `/admin/stations` | `{ stations: [{ id, name, mood, genres, created_at, subscribers, is_user_generated }], total }` |
| `/admin/users/lookup` | `{ matches: [{ id, email, username, created_at }] }` — operator-gated |

Also load-bearing, please keep: `-1` as the query-failed sentinel in `/admin/stats`, `premiumPct`
being `null` rather than derived from one, 404-not-403 for unauthorised, and per-field degradation
on the entitlement route.

---

## Part 5 — What is already working, so you do not re-do it

Verified live on 5 Aug: migration 0003 applied, `admin_users` readable, all nine `/admin/*` routes
responding, Analytics Engine receiving (`recs`, `dj`, `play`, `setlist`), `past_plays` missing
`played_at` holding at **0 rows**, setlist fill **88%**, DJ pass rate **~86%** (which is the healthy
baseline — the dashboard does not warn until non-`ok` exceeds 25%), 632 users / 19 premium /
342 stations / 35,035 plays / 4,508 liked.

One note on the 4xx panel: `/admin/users/lookup` accounts for **87.6%** of all 4xx (373 × 404 plus
39 × 429 against the admin rate limiter). We believe that is our own testing of the viewer-denial
path. If it is not, something is hammering it and it is worth finding out what.
