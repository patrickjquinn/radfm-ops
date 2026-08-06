# Three counting defects in the ops dashboard - found, fixed, deployed

**For:** Rad.FM · `radfm-ops` and `rad-fm-backend`
**Date:** 6 August 2026
**Trigger:** a 4xx figure that read 655 on one load and 29 an hour later, for the same 24h window

---

## Summary

Chasing that discrepancy found **three separate defects, all of the same kind**: the dashboard was
displaying numbers that were not counts of anything. Both headline counts in the Health section were
wrong, both by roughly an order of magnitude, and **both of their alert thresholds were consequently
unreachable.**

| | was | is | error |
|---|---:|---:|---:|
| 4xx, 24h | 29 | **220** | 87% under |
| 4xx, 72h | 292 | **2,522** | 88% under |
| Warnings, 24h | 14 | **158** | 91% under |
| Warnings, 72h | 134 | **1,498** | 91% under |

All three are fixed, tested and deployed (`3deda519`). Test count went 48 → 57.

**The uncomfortable part:** this dashboard exists because Cloudflare's console displayed a total
authentication outage as "0 Errors". Its whole thesis is that a number you cannot stand behind is
worse than no number. It was doing the same thing, in its two most important panels, for its entire
life - and it took a rounding-error observation while gathering data for an unrelated spike to catch
it. That is worth sitting with. The design rules were right; nothing was verifying that the numbers
obeyed them.

---

## Defect 1 - the 4xx total was the sum of ten groups

### How it showed up

The nav badge and the Overview tile both read `655`, then `29` an hour later. Both come from the same
source, so that is not two views disagreeing - it is one number that does not mean what it says.

Measuring the whole window ladder on a single instant made it unambiguous:

```
  1h    4      12h   53      36h   433
  3h   19      18h   54      48h   390
  6h   50      24h   29      72h   292
```

**A 24h window contains the 18h window.** 54 → 29 is not a real count. Stable across repeated calls,
so not sampling noise - deterministic and wrong.

### Cause

`/status4xx` ran one grouped telemetry query, grouping by `(path, status)`, and summed the returned
groups to get the total.

**The grouped query returns a capped set of groups - measured at exactly TEN**, regardless of the
`limit` sent (tried 100 and 1,000) and regardless of window width. So the "total" was *the sum of ten
groups the API chose to return*. Which ten changes with the window, hence the non-monotonicity.

### Fix

Take the headline from a **separate ungrouped query**, which returns one exact aggregate. Use the
grouped query only for the breakdown rows.

A breakdown being a top-N is fine and expected. **A headline silently being a top-N is the failure
this tool exists to catch.**

### Second-order consequence, arguably worse than the wrong total

Share percentages divided by the sum of the visible rows. So a truncated breakdown always added up to
a tidy 100% and **read as complete**. That is the most convincing way to be wrong: nothing looks
missing.

Shares now divide by the true count, and the view states the shortfall outright:

> These routes account for 292 of 2,522 4xx in this window - **2,230 are not shown.**

`total` is also now `number | null` - null when the count is unavailable, **never 0**. A zero there
renders as "no 4xx", which is precisely the false-healthy reading this whole product was built in
response to.

---

## Defect 2 - the warning count was a sample size

Same class, different mechanism, found by testing the neighbouring panel once the first defect was
understood.

`/logs` **must** fetch raw events rather than an aggregation, because the telemetry API groups on the
raw message and normalising first is the entire value of the panel - the setlist failure arrives once
per artist name, and collapsing it is what turned dozens of 1-count rows into one row reading 519.

But **the events view returns a sample, and not a superset as the window widens.** Measured: 12h
yielded 30 events, 24h yielded 15. We summed those groups and called it a warning count.

Same fix: exact count from a separate ungrouped query; the groups remain a breakdown of whatever
sample came back, and the view now says so rather than implying the counts are totals:

> 1,498 warnings in this window; the grouping above is built from a 134-event sample, so treat the
> ranking as the signal and not the counts.

**The ranking was always trustworthy. The counts never were.** Those are different claims and the
panel was making the stronger one.

---

## Defect 3 - a duplicated signal broke the badge

This one is mine, introduced in the zero-tracks commit earlier today.

The zero-tracks signal block was pasted **twice** in `src/lib/health.ts`, and the second copy ran
*after* `badges.overview` had already been computed from `signals.length`. At a 3d range the result
was:

- nav badge: **2**
- header: **"Degraded - 3 signals open"**
- list: **the same row twice**

Three numbers for the same thing, on one screen, at the same moment. `health.ts` was centralised
specifically to prevent that, and it was the thing doing it.

Fixed, and the guard is now **structural rather than a promise to be careful**: signals are deduped
once and nothing downstream reads the raw array. Three tests cover it, including that first occurrence
wins so blast-radius ranking survives.

---

## What the corrected numbers immediately exposed

None of this was visible before today. **All of it was there the whole time.**

### The alerts could not fire

- **"Elevated 4xx"** triggers above 1,000. Against a total capped by ten groups it was effectively
  unreachable. The real 72h figure is **2,522** - it fires now, and the Overview verdict correctly
  flips to Degraded.
- **The warnings badge** goes amber above 500. Real 48h is **1,028**, real 72h **1,498**. It had never
  gone amber and could not have.

The single most important panel in the product - 4xx, which exists precisely because Cloudflare's
headline Errors metric excludes it - had a threshold it could barely cross.

### Findings for the backend team

**4xx is 19.36% of all requests** - 2,522 of 13.0k over 3 days. Roughly one request in five. That
alone deserves a look.

| Route | Status | Count | Note |
|---|---|---:|---|
| `/auth/refresh-token` | **404** | **227** | Largest single 4xx route by far |
| `/admin/users/lookup` | 429 | 39 | The admin rate limiter is being hit |
| `/apple/v1/me/library/playlists/:id/tracks` | 429 | 9 | |
| `/.env` | 404 | 9 | **Credential scanning** |
| `/.aws/credentials` | 404 | 2 | **Credential scanning** |
| `/.env.txt` | 404 | 1 | **Credential scanning** |

Three things worth someone's attention:

1. **`/auth/refresh-token` 404 × 227.** A 404 rather than a 401 on a refresh path is odd. If it means
   "refresh token not found", that is 227 sessions failing to refresh in three days and the client
   presumably bouncing users to login. Worth confirming whether this is expected.
2. **`/admin/users/lookup` 429 × 39.** Some of that is my own testing today, but not all of it -
   worth confirming the limiter is not tripping legitimate use.
3. **Credential scanning against `api.rad-fm.com`.** Routine internet background noise, correctly
   404ing, nothing exposed. Noted only because it was invisible until now, and because it is a good
   argument for keeping 4xx visible.

Also, from the warnings panel now that the ranking is trustworthy: the setlist last.fm failure remains
the largest group at 75 occurrences in 72h, and `[explorer] attempt n/n produced no usable article`
plus a JSON-generation upstream error are both live.

---

## Why the tests did not catch this

Honest answer: the existing tests for `fourxxRows` asserted that it correctly summed the rows it was
given. It did. **The bug was that the rows it was given were not all the rows** - a property of the
API contract, which no unit test was ever going to observe.

The check that would have caught all three in seconds is not a unit test at all:

> **A count over a wider window must never be smaller than the same count over a narrower one.**

That is cheap, needs no fixtures, and is exactly the kind of property this product's own thesis
implies. It is not yet automated, and it should be - the natural home is a scheduled check that walks
the window ladder and shouts if monotonicity breaks. **I have not built that; it is the top of my
list unless you would rather it were not.**

New tests added meanwhile (57 total, up from 48):

- shares divide by the true count, not by the visible rows
- an unavailable count degrades to `null`, never to `0`
- `covered` correctly reports when the rows do not account for the total
- `exactTotal` returns `null` rather than coercing a bad shape to `NaN`
- duplicate signals collapse, and first occurrence wins

---

## Related, unverified

While reading the Observability docs I noticed Cloudflare now documents **7-day log retention**.
`RETENTION_HOURS` in this repo is **72**, and the UI tells the operator that "Observability retains 3
days" and caps every log window there. If retention really is 7 days, we are discarding over half the
history we are entitled to - including the ability to compare like-for-like week on week.

**I have not verified this** - `clampHours` caps at 72, so the API cannot currently be asked for more,
and my 168h test was silently clamped rather than answered. Raising the cap and measuring is a
ten-minute job. Flagging rather than fixing because the current behaviour is conservative and wrong in
the safe direction, unlike everything else in this document.

---

## Changes deployed

| | |
|---|---|
| `worker/cf.ts` | Two-query pattern on `/status4xx` and `/logs`; new `exactTotal()` |
| `src/lib/api.ts` | `Fourxx.total` and log `total` are now `number \| null`; added `covered`, `accounted`, `sampled` |
| `src/lib/health.ts` | Reads the exact counts; `dedupeSignals()`; removed the duplicated block |
| `src/views/Traffic.tsx` | States how many 4xx are not shown |
| `src/views/Logs.tsx` | States that the grouping is a sample of the real total |

Commits `321c1d3` and `e4b514e`. Deployed as `3deda519` and verified live.
