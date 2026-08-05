# Security review — admin surface

Adversarial review of the `/admin/*` backend surface, 5 August 2026. Attacks were run against
**production**, not a local stub, because the question was "does the deployed thing hold", not "does
the code look right".

I wrote this code, so treat this as a self-review with the bias that implies. Everything below is
reproducible: the attack script is described inline.

**Result: 4 issues found, 4 fixed and re-verified. 1 issue found in the ops dashboard itself, which
is yours to fix — see §5. It is the most serious item in this document.**

---

## 1. What was attacked

`GET /admin/me` with 14 crafted tokens, plus the config write path, both search endpoints, and the
rate limiter. 200 on a forged credential counted as a breach.

| Attack | Before | After |
|---|---|---|
| `alg: none`, no signature | rejected | rejected |
| `alg: none`, junk signature | rejected | rejected |
| Valid token, signature stripped | rejected | rejected |
| Valid token, signature truncated | rejected | rejected |
| Signed with a guessed secret | rejected | rejected |
| Signature replaced with `null` / repeated chars | rejected | rejected |
| Payload swapped, original signature kept | rejected | rejected |
| **Valid signature, no `exp` claim** | **ACCEPTED** | rejected |
| **`userId` as `[3]`** | **ACCEPTED** | rejected |
| `userId` as `true` / `{}` | rejected | rejected |
| Role `owner` smuggled into the token body | rejected | rejected |
| Refresh token presented as a bearer | rejected | rejected |

---

## 2. Issues found and fixed

### 2.1 A token with no `exp` never expired — HIGH

`if (payload?.exp && now > payload.exp) return null` tests `exp` for truthiness before comparing it.
A validly-signed token that simply omits `exp` skips the check entirely and is accepted **forever**.

Not exploitable today: the issuer always sets `exp`, so no such token can be obtained through any
normal path. But this is admin authorization, and "our issuer currently always does X" is a property
that changes without anyone noticing. `exp` is now required and must be a finite number.

### 2.2 `userId` resolved through `Number()` coercion — LOW

`Number([3])` is `3`. `Number("3")` is `3`. So an array or a numeric string in the `userId` claim
resolved to a real user. Again only reachable inside a token we signed, so not exploitable — but
identity resolution is the wrong place for JavaScript coercion rules.

Now shape-checked: a number must be an integer, a string must be all digits. Numeric strings are
still accepted deliberately, so a legacy token carrying `"3"` cannot lock a real admin out of the
tool they need during an incident.

### 2.3 `/admin/*` was not rate limited in practice — MEDIUM

Measured, not assumed:

```
250 concurrent -> /admin/me             404 x250,  429 x0
250 concurrent -> /auth/refresh-token   404 x101,  429 x149
```

Same sub-app, same middleware. The shared limiter is eventually consistent, and `/admin/*` rejects a
bad token fast enough (no database work) that an entire burst lands inside the counter's window.

This matters because `/admin/users/lookup` does **prefix** matching on email. An unbounded caller
holding a leaked `viewer` token can walk the user directory 20 rows at a time. There is now a
dedicated per-IP bucket in front of the role check.

> **Operator-visible consequence, worth knowing before it confuses someone:** the limiter denies with
> **404**, the same as "you are not an admin", to preserve the no-oracle property. So an operator who
> is being rate limited sees `Not found` and will reasonably assume their token is wrong. If admin
> pages start 404ing for someone who was working a minute ago, suspect the limiter before the token.

### 2.4 The setlist metric reported 24% against a true 75% — MEDIUM (correctness)

The first implementation counted every element of every cached array as an event.

`GIG_CACHE` is **shared**. Of 251 live keys, **9** are city event listings; the rest are
`lfm:top:<artist>` per-artist song caches and news entries. So each individually cached *song* was
being counted as a gig with no setlist, and the denominator was ~3× too large.

Had this shipped, the panel would have read 24% against your stated 0.75 baseline, tripped the 0.70
signal permanently, and been dismissed as broken — which is precisely the "alarm that is always on"
failure mode that lets a real regression hide.

Now filtered on both key shape (listings have no `prefix:`) and value shape (an element has an
`event` name and a `songs` array). **Production now reports `0.7806` across 9 cities / 620 events**,
consistent with the 0.75 London baseline you measured.

---

## 3. Properties that held, and why they matter

- **Role is never read from the token.** A token carrying `role: "owner"` for a user who is a
  `viewer` in D1 resolves as `viewer`. Verified in production. This is what makes revocation
  immediate rather than "whenever their token happens to expire".
- **The allowlist is an allowlist.** `W_ENERGY`, `JWT_SECRET`, `MAX_PER_ARTIST`, `SPONSORS` and
  `__proto__` all 404 on write. Recommendation weights and prompt pools are not reachable from a web
  form, by construction rather than by convention.
- **Bounds are enforced on read as well as write.** A value edited straight into the KV dashboard, or
  written before a bound was tightened, still cannot take effect — `cfg()` re-validates and falls back
  to the compiled-in default.
- **Config fails to the default, never to zero.** Tested against empty string, whitespace, `NaN`,
  `Infinity`, `null`, `{}`, negatives and zero, for every key. `MAX_OTP_ATTEMPTS = 0` would lock every
  user out of the product; it is rejected on write and ignored on read.
- **Audit is written in the same handler as the write**, including rejections. "Who kept trying to set
  `MAX_OTP_ATTEMPTS` to 0" is answerable.
- **`LIKE` metacharacters are escaped** in both search endpoints, with `ESCAPE` declared. Not SQL
  injection — the value is bound — but `%` and `_` are wildcards *inside the pattern*, so an
  unescaped `%` turns an email lookup into a full directory dump.

---

## 4. Accepted risks — deliberate, and yours to overrule

1. **`viewer` can enumerate emails.** `/admin/users/lookup` is viewer-level per your contract, and
   prefix search over `users` means a viewer can walk the directory. Bounded at 20 rows and now rate
   limited, and substring search is deliberately not offered. If you would rather this were
   `operator`, it is a one-word change — say so and I will make it.
2. **Config changes take up to 30 seconds to be globally visible.** `cfg()` memoises per isolate. The
   writing isolate resets its cache immediately, so the dashboard shows the new value at once, but
   other isolates serve the old one until their memo expires. **The UI should say this**, or an
   operator will change a dial during an incident, see it take effect in the dashboard, and conclude
   the backend is ignoring them.
3. **`DEV_TKN_KEY` still works.** `isPrivilegedRequest()` accepts an admin JWT *or* the legacy key, so
   existing tooling keeps working. It remains an unattributable shared credential. Retiring it is now
   deleting one branch in `src/lib/auth/admin.ts` — worth doing once nothing depends on it.
4. **String comparison on the dev key is not constant time.** Timing attacks across the public
   internet against a Workers runtime are not a realistic path to recovering it; noted rather than
   fixed.
5. **Last write wins on concurrent config edits.** Two operators editing the same key simultaneously
   is not detected. Both writes are audited, so it is reconstructable.

---

## 5. A finding in the ops dashboard — yours, and the most serious item here

From your own `.dev.vars.example`:

> while `ACCESS_AUD` is still the `REPLACE_WITH_APPLICATION_AUD` placeholder, the Worker runs its
> local-dev bypass and every `/api` route is **UNAUTHENTICATED** … it does mean a half-configured
> deploy is an open one.

Keying the bypass on the placeholder is a genuinely nice idea — configuring Access closes it
automatically. The problem is what it combines with.

**The chain:** if `DEV_BACKEND_JWT` is ever set as a production secret while `ACCESS_AUD` is still the
placeholder, then `ops.rad-fm.com` is an **unauthenticated public proxy holding an owner credential**.
Anyone who finds the hostname gets everything the dashboard can do, attributed in `admin_audit` to
whoever's token it is. Your own file warns against setting `DEV_BACKEND_JWT` in production, and you
correctly identify it as the same attribution problem as `DEV_TKN_KEY` — but the two hazards are
documented in separate sections and neither mentions the other, which is exactly how this gets
deployed.

The backend limits the blast radius but does not close it: the role check is server-side and cannot
be bypassed from the client, and the new per-IP admin limiter caps enumeration. But if the proxy
forwards a real owner JWT, the backend cannot tell that request from Patrick.

**Recommended, in order:**

1. **Refuse to start when `ACCESS_AUD` is the placeholder and `DEV_BACKEND_JWT` is set.** That
   combination has no legitimate use. Fail the fetch handler outright rather than serving.
2. **Gate the bypass on the Vite dev server, not on a config value** — for example require
   `import.meta.env.DEV`, so a production build cannot express the bypass at all.
3. **Set `workers_dev: false`** on the ops Worker. The backend has it `true`, which means
   `rad-fm-backend.veme.workers.dev` bypasses custom-domain protection; do not inherit that here.
4. Consider a startup assertion that `ACCESS_AUD` matches the expected format, so a typo fails loudly
   rather than silently disabling authentication.

I have not touched your repo beyond the docs — this is a report, not a patch.

---

## 6. Reproducing this

The attack script is not committed; it mints tokens with the production `JWT_SECRET` from
`.dev.vars`, which is exactly the thing that should not live in a repo. To rebuild it: sign a payload
with `crypto.subtle` HMAC-SHA256, vary the header `alg`, the `exp` claim, the `userId` shape and the
signature, and assert every request to `/admin/me` returns 404 except the genuine control token.

Re-run it after any change to `src/lib/auth/admin.ts`. The regression cases are in
`tests/lib/admin-auth.test.ts` (28 tests) and `tests/users/admin-routes.test.ts` (23 tests), so
`bun run test` covers them — but the production run is what caught 2.1 and 2.3, because both are
about deployed behaviour rather than logic.
