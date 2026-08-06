# Backend routes for the data half — 6 August 2026

**For:** `rad-fm-backend`
**From:** `radfm-ops`
**Context:** the dashboard was all engineering telemetry. Two data views are now live from sources I
could reach on my own. Two more need you. Everything below is scoped to what is genuinely blocked.

---

## Already built, no backend needed

**Listening** — from `trackPlay` in Analytics Engine. 7 days: 765 plays, 17 listeners, 717 distinct
tracks, 6.3% repeat rate. This is the first view in the product that answers "is anyone using it".

Two things fell out of it worth your attention:

- **17 listeners against 634 registered accounts is 2.7%.** That is the real engagement figure, and
  the first time this dashboard has been able to state one. The Scale panel has always refused to
  claim it — "users with play activity, 24h: 15, *not DAU*" — because `past_plays` cannot support the
  claim.
- **717 distinct tracks across 765 plays.** A 6.3% repeat rate on a radio product is a finding rather
  than a statistic, and I have no way to tell from here whether it is by design.

**Cost** — from `aiGatewayRequestsAdaptiveGroups`. Covered in §3 below because one line of it is a
real problem.

---

## 1. Growth and activation — a signup/activity time series. HIGH

**The ask:** daily counts, not point-in-time totals.

```
GET /admin/metrics/growth?days=90
→ { days: [{ day, signups, firstPlays, premiumStarts, premiumEnds }], since }
```

- **`signups`** — `count(*) FROM users GROUP BY date(created_at)`.
- **`firstPlays`** — activation. Accounts whose first play landed that day. If that is expensive,
  say so and I will drop it; the other three carry most of the value.
- **`premiumStarts` / `premiumEnds`** — from `premium_meta.premium_since` and the audit trail.

`/admin/stats` gives me totals and `newUsers7d`, which answers "how many" but never "is it speeding
up or slowing down". A single number cannot show a trend, and a trend is the entire question this
view exists to answer.

**`since` matters as much as the data.** If the table only reliably has `created_at` from some date,
return that date. I will render the window that exists against the window that was asked for, the
same way the Listening view does — an axis drawn across empty days reads as "nobody signed up" when
it means "we were not recording", and those are different claims.

## 2. Revenue and subscriptions — an aggregate. MEDIUM

**The ask:** the subscription picture in one call.

```
GET /admin/metrics/revenue
→ { activeSubscriptions, byProduct: [{ productId, count }],
    expiringWithin7d, expiredNotReconciled, trialCount, mrrEstimate, checkedAt }
```

Today only per-user RevenueCat lookups exist. Nothing aggregates, so the dashboard can say "18
premium" from D1 but cannot say what they are paying, on which product, or how many lapse this week.

- **`expiringWithin7d`** is the one I would build first. It is the only forward-looking number in the
  entire product — everything else is "what already happened".
- **`expiredNotReconciled`** is the stale-cache bug as a metric: RevenueCat says lapsed, we still say
  premium.
- **`mrrEstimate`** — only if RevenueCat gives you price per product without a per-subscriber call.
  If it needs one call per subscriber, skip it. A number that costs 18 API calls to render is not
  worth rendering, and I would rather have nothing than a figure that times out.

**Please return `checkedAt`** and keep the null-on-failure rule you already applied to the entitlement
route. An unreachable RevenueCat must stay null and never become zero — a revenue panel reading `$0`
during an outage is the worst possible false zero in the product.

## 3. `gpt-image-1` spend is invisible, and it may be the largest line. MEDIUM

Not a route request — a finding you will want.

AI Gateway prices by token. Image models are billed **per image**. So `gpt-image-1` reports
**`cost: $0.00`** however many calls are made:

```
rad-fm  openai/gpt-oss-120b  groq    250 calls  521k in  43k out  $0.0956
rad-fm  openai/gpt-oss-20b   groq    132 calls  128k in  68k out  $0.0287
rad-fm  gpt-image-1          openai    4 calls                    $0.0000   <- not counted
```

Four calls in 24h. At OpenAI's per-image rates that is plausibly **more than the entire text spend
above it**, and it is missing from the gateway's total, from the spend limit's accounting, and from
any budget built on either. The spend limit you asked me to set is $5/day — it will not see this.

The dashboard now states it explicitly rather than summing a zero. But if station art generation
scales with users, this becomes the dominant cost while continuing to read as free. Worth knowing
what those four calls are and whether they are on a per-user path.

**The text spend cross-checks cleanly**, for what it is worth: I priced both Groq models from their
published rates and came within 9% and 4% of the gateway, in the direction prompt caching predicts.
So the gateway's figure is trustworthy for token-billed models and blind for the rest.

---

## 4. Smaller things, only if they are cheap

- **Station art coverage** — `stations` with a flag for whether art is in R2 or generated. Content
  moderation was on the list and the Stations view can only show names and moods today.
- **Genre and mood distribution** — a grouped count. Same view, and it is the only way to see what
  the catalogue actually looks like.

---

## What I am not asking for

**Write routes.** Support-a-user was on the list and it needs grant/revoke/force-reconcile, but reads
should earn trust first and the audit trail has to be right before anything mutates. When it comes,
the first mutation must write its `admin_audit` row in the same handler — that has been the rule from
the start and I am not asking you to relax it for a dashboard.

---

## Priority

1. **Growth time series** — unblocks the "is the business healthy" view entirely.
2. **`expiringWithin7d`** — the only forward-looking number available anywhere in the product.
3. **The `gpt-image-1` question** — not a route, but possibly the largest cost line, currently
   invisible.

Everything else on the dashboard now reads live or says plainly that it cannot.
