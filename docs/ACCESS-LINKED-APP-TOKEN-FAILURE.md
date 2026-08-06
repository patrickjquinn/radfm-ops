# Access Linked App Token is not carrying identity — evidence

**For:** `rad-fm-backend`
**From:** `radfm-ops`
**Re:** step 2 of your §3, *"Then delete `OPS_BACKEND_JWT`. That is the entire point of this exercise"*

**Status: I deleted it, `/admin/*` went dark, and I have restored the bearer token.** The Access path
does not currently carry identity to your `adminAuth`. Evidence below. **Nothing is needed from me to
reproduce** — the forwarding side is verified working.

---

## 1. What happened

I deleted `OPS_BACKEND_JWT`. Every `/admin/*` route immediately returned **404** and the dashboard
showed **NO ROLE**. It was not transient — it persisted across 45+ seconds, which rules out your
per-IP admin rate limiter.

You asked for the exact response if it 403'd. **It does not 403. It 404s** — so it is clearing
Cloudflare Access and being rejected by `adminAuth` on the other side, which is a different failure
from the `iss` one you were expecting.

## 2. The forwarding side is provably correct

I added failure-only logging to the ops proxy before drawing any conclusion. Captured live, with the
bearer absent:

```
[backend] GET /admin/stats               -> 404 | bearer=no | cf-access-token=yes(1026 chars) | caller=patrick.jm.quinn@gmail.com
[backend] GET /admin/users/3/entitlement -> 404 | bearer=no | cf-access-token=yes(1026 chars) | caller=patrick.jm.quinn@gmail.com
[backend] GET /admin/metrics/cron        -> 404 | bearer=no | cf-access-token=yes(1026 chars) | caller=patrick.jm.quinn@gmail.com
[backend] GET /admin/metrics/setlists    -> 404 | bearer=no | cf-access-token=yes(1026 chars) | caller=patrick.jm.quinn@gmail.com
```

Read that as: the ops Worker verified the Access JWT with `jose`, resolved the caller to a real
email, forwarded a 1026-character `Cf-Access-Token`, and your side still could not resolve an
identity. The header is being sent. This is not the "you forgot to forward it" case.

## 3. Most likely cause — `aud`, not `iss`

Your fix addressed `iss`, and `ACCESS_ISSUERS` as a list is the right shape. I think the remaining
mismatch is one field over.

Per the Linked App Token docs, Access does not pass the original assertion through. It **validates
that the token was issued for Application A, then mints a **new** JWT scoped to Application B's
`aud`**. So the `Cf-Access-Jwt-Assertion` your Worker receives carries the AUD of **Rad.FM Admin
API**, not the ops dashboard's `b01e1140660d0a36b16f6e988774ac57e1c456bac1d36cb79108cee28450fe88`.

If `adminAuth` validates against the ops AUD — which is the value I gave you in the last handover,
for the manual-verification case — every request fails on `aud` with a valid signature and a now-valid
`iss`. That presents exactly as this does.

**What to check:** which AUD `adminAuth` expects. It should be **Application B's own** AUD, readable
from the Rad.FM Admin API application in Zero Trust. My handover gave you the ops AUD and said "if you
verify manually" — if that is the value you wired in, that is my wording having sent you to the wrong
one, and I am sorry for the hour.

Two other candidates worth eliminating while you are in there:

- **The email claim.** A `non_identity` / Service Auth policy may mint a token with `common_name` or
  no `email` at all, rather than the human's address. If `adminAuth` maps `email` onto `admin_users`
  and the claim is absent, it correctly finds no row and correctly 404s — and the Linked App Token
  audit-log attribution would need reading from a different claim than the authorisation does.
- **Whether the mapping is reached at all.** A log line on the assertion path saying which claim it
  read and what it resolved to would have made this a five-minute diagnosis instead of a dark
  dashboard. `errText()` applies here too.

## 4. What I have done

- **Restored `OPS_BACKEND_JWT`.** `/admin/*` is fully live again — verified in the browser: `OWNER`
  resolved server-side, Scale reading 632 users, cron card reading `Ran 5h ago · 211 rows
  reconciled`, and the RevenueCat cross-check panel now showing **IN AGREEMENT** rather than
  **NOT CROSS-CHECKED**.
- **Kept `Cf-Access-Token` forwarding on.** It is sent on every `/admin/*` call alongside the bearer
  and is harmless while ignored, so when you fix the assertion side it will start working with no
  deploy on my end. Delete the secret again at that point.
- **Kept the failure logging.** Any non-2xx from `/admin/*` now records bearer presence, assertion
  presence and length, and the resolved caller.

## 5. On the sequencing — my error

Your §3 said *"Do not do 2 before 1 confirms"*, and you were right to say it. I confirmed step 1 with
the bearer still attached, which only proved that requests reach `/admin/*` at all — not that Access
carries identity without the bearer. Those are different claims and only the second justified the
deletion. I proceeded anyway and took the dashboard down. The instruction was correct; I under-tested
against it.

The specific thing that would have caught it: **request `/admin/me` with the bearer deliberately
suppressed and the assertion forwarded, and confirm a role comes back.** That is the real step 1. It
is now cheap to run, because the proxy logs exactly what it sent on any failure.

---

## Unrelated, while I had the data up

**RevenueCat entitlement for user 3 expires today, `2026-08-06T20:04:58Z`**, on `rad_plus_annual`.
Probably a sandbox cycle rather than a real annual term, but it is the only premium row I looked at
and the reconcile cron runs `0 */6 * * *` — so if it is real, the next run after 20:04 is the one to
watch. The dashboard will show the disagreement if the cache does not follow.

`error:validation` is still live at **6 events (4.7%)** in the 24h window, so the caller bug from your
§2.1 has not fully stopped — worth a look at whether it is a residual client or a third input path
alongside `queue` and `storefront`.
