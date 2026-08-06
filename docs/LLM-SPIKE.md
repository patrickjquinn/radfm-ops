# Research spike: Cloudflare's LLM offerings for the ops dashboard

**For:** Rad.FM · `radfm-ops`
**Date:** 6 August 2026
**Question:** what does Cloudflare offer, does the price work, and where would it actually help?

---

## Verdict first

**Price is a non-issue.** At our volumes the entire realistic feature set fits inside the **free
10,000 neurons/day** that comes with the Workers Paid plan we already pay for. Not "cheap" - actually
zero, with headroom of roughly 400 summarisation calls a day before a single cent is billed. I ran
the numbers against measured production volumes, not illustrative ones; see §3.

**So the decision is not economic. It is epistemic**, and that is the whole of the interesting
problem.

This dashboard exists because Cloudflare's own console displayed a total authentication outage as
"0 Errors". The entire design is organised around one rule: **never show something you cannot stand
behind.** `unavailable` is a first-class state precisely so a failed source can never masquerade as a
healthy zero.

An LLM is a machine for producing confident, fluent, plausible text regardless of whether it is
right. Bolted on naively, it reintroduces the exact failure class the tool was built to eliminate -
only now the false statement is a paragraph of prose instead of a zero, which makes it *harder* to
catch, not easier.

**That tension is resolvable, and the resolution is a hard architectural rule, not a disclaimer:**

> **The LLM never produces a number, a count, a rate, or a verdict. It only ever explains, groups, or
> routes - over numbers that `src/lib/health.ts` has already computed.**

Everything in §5 that I recommend obeys that rule. Everything in §6 that I recommend against breaks
it. If we adopt only one sentence from this document, that is the one.

---

## 1. What Cloudflare actually offers

Four relevant products. All verified against the docs on 6 Aug 2026.

| Product | What it is | Status |
|---|---|---|
| **Workers AI** | Serverless GPU inference, called from a Worker via an `AI` binding | GA |
| **AI Gateway** | A proxy in front of any model: logging, caching, rate limiting, **spend limits**, guardrails, DLP, fallbacks | GA |
| **AI Search** (was AutoRAG) | Managed RAG - crawl/ingest, chunk, embed, index, retrieve | **Open beta, free** |
| **Vectorize** | Vector database | GA, generous free tier |

### Models worth considering

| Model | Context | In $/M | Out $/M | Notes |
|---|---:|---:|---:|---|
| `@cf/zai-org/glm-4.7-flash` | 131k | **0.06** | **0.40** | Function calling, reasoning. **Best fit.** Free plan too |
| `@cf/google/gemma-4-26b-a4b-it` | **256k** | 0.10 | 0.30 | MoE, function calling, reasoning, vision |
| `@cf/ibm-granite/granite-4.0-h-micro` | - | 0.017 | 0.112 | Cheapest usable; for bulk classification |
| `@cf/openai/gpt-oss-120b` | 128k | 0.35 | 0.75 | Stronger reasoning |
| `@cf/nvidia/nemotron-3-120b-a12b` | 256k | 0.50 | 1.50 | Strongest open option here |
| `@cf/zai-org/glm-5.2` | - | 1.40 | 4.40 | Frontier-ish. Paid plan only |

Embeddings, which matter more than they look (§5.1):

| Model | $/M input | Notes |
|---|---:|---|
| `@cf/baai/bge-m3` | **0.012** | Multilingual, strong general retrieval |
| `@cf/qwen/qwen3-embedding-0.6b` | 0.012 | |
| `@cf/baai/bge-base-en-v1.5` | 0.067 | |
| `@cf/baai/bge-reranker-base` | 0.003 | Reranking, absurdly cheap |

**Two capabilities that matter for us specifically:**

- **JSON mode / structured outputs.** Workers AI supports `response_format: { type: 'json_schema' }`,
  OpenAI-SDK-compatible. This is not a convenience - it is the difference between a feature we can
  test and one we cannot. Every LLM call we make should be schema-constrained.
- **Function calling** on `glm-4.7-flash`, `gemma-4`, `nemotron-3`, `gpt-oss-*`. This is what makes
  §5.3 safe.

---

## 2. Data handling - read this before sending logs anywhere

Cloudflare's stated position, from `workers-ai/platform/data-usage`:

> "Cloudflare does not use your Customer Content to train any AI models made available on Workers AI"

> "Cloudflare does not make your Customer Content available to any other Cloudflare customer."

Inference on Workers AI runs on Cloudflare-hosted open models - **the data does not go to OpenAI,
Anthropic or Google** unless we deliberately route to them via AI Gateway. That is a genuine
advantage over calling a third-party API and it is the main reason this is worth doing on Cloudflare
rather than elsewhere.

**Two honest gaps I could not close:**

1. **Retention is not documented.** The data-usage page covers ownership and training but is silent
   on how long inference inputs and outputs are stored. If we send anything sensitive, we are relying
   on an unstated policy. Worth asking Cloudflare directly before we send PII.
2. **Our logs contain personal data.** `admin_audit.actor_email`, user ids, station names, entitlement
   records. A naive "summarise the last 24h" prompt ships user emails to inference.

**Mitigation, and it is cheap:** redact before send. We already normalise log messages in
`worker/cf.ts` - the same pass should strip emails and numeric user ids to `<email>` / `<uid>` before
anything reaches a model. The summariser does not need the identity to explain the pattern. AI
Gateway's DLP feature is a second net, not a substitute.

---

## 3. Cost, against real measured volumes

Measured from the live system on 6 Aug, 24h window: **~317 DJ events** (273 `ok`, 44 non-`ok`),
**~24 distinct normalised warning groups**, **~130 recommendation requests**, tens of 4xx routes,
632 users, 342 stations.

This is a **single-operator dashboard over a small production system.** That fact dominates everything
below.

Workers AI bills in neurons: **$0.011 per 1,000**, with **10,000 free per day** on Workers Paid.

`glm-4.7-flash` costs 5,500 neurons/M input, 36,400 neurons/M output.

| Call shape | Neurons | Free calls/day | Cost each once paid |
|---|---:|---:|---:|
| Explain one warning group (1.5k in, 400 out) | ~23 | **~435** | $0.00025 |
| Full 24h incident narrative (12k in, 800 out) | ~95 | **~105** | $0.00105 |
| Same on `gemma-4-26b` | ~131 | ~76 | $0.00144 |
| Same on `nemotron-3-120b` | ~654 | ~15 | $0.0072 |

Embeddings are rounding error: embedding **every** warning message we produce in a month
(~100k messages × ~30 tokens) is **3M tokens ≈ 3,225 neurons ≈ $0.035/month**.

Vectorize free tier is 5M stored dimensions - at bge-m3's 1024 dims that is ~4,880 stored vectors,
plenty for warning archetypes. **And we may not need Vectorize at all**: clustering 24 groups a day
can happen in memory, no index required. Only persistent semantic search over history justifies it.

AI Search is free during open beta (Workers AI and AI Gateway billed separately).

> **Bottom line: realistic usage is $0/month on top of the $5 Workers Paid plan we already have.**
> If we somehow 10×'d usage it would be a couple of dollars. Cost should not shape this decision at
> all - which means we should choose based purely on whether each feature makes the dashboard more
> trustworthy or less.

---

## 4. The architectural fit is unusually good - with one new risk

**Three things already true about this codebase make LLM integration cleaner than it would normally be:**

1. **`worker/cf.ts` exposes *named* queries, never a generic passthrough.** That was a security
   decision - a passthrough hands the browser the token's full authority. It turns out to be exactly
   the right shape for function calling: the model picks from an allowlist with validated parameters.
   It cannot write SQL, cannot write GraphQL, cannot reach anything not already exposed. **The safe
   version of "ask the dashboard a question" is nearly free because of a decision made for unrelated
   reasons.**
2. **`src/lib/health.ts` is already the single derivation of every number.** So there is an obvious,
   enforceable boundary: health.ts computes, the LLM narrates. Never the reverse.
3. **Adding an `AI` binding does not erode the privilege boundary.** The standing invariant is that
   the ops Worker gets no D1 binding and never holds `JWT_SECRET` - both about *data access*. An `AI`
   binding grants inference, not data. It is one of the few things we can add without weakening the
   split.

**The new risk, and it is real: prompt injection through log content.**

Our warning messages contain externally-controlled strings. A live example:

```
[setlists] last.fm fallback failed for "unidos por venezuela": The artist you supplied could not be found
```

That quoted value comes from setlist.fm data. Station names are user-generated (342 of them, 100%
user-gen). Anything that feeds logs into a model is feeding it **attacker-influenceable text.**

If that model can also call functions, a crafted station name is an injection vector into our named
queries. Mitigations, in order of importance:

- **Separate the roles.** The summariser must not have tools. The tool-caller must not read raw log
  text. Do not build one component that does both.
- **Treat all retrieved content as data, never instruction** - say so explicitly in the system prompt,
  and delimit it.
- **Validate every function-call argument** against the same schema the HTTP route uses. The model
  proposes; existing validation disposes.
- **Reads only.** No tool that mutates. Trivially satisfied today - nothing in this dashboard writes.

---

## 5. Where it would genuinely help, ranked

### 5.1 Semantic grouping of warnings - **strongest technical fit, start here**

`worker/cf.ts` currently collapses warnings with hand-tuned regexes: numbers, hex, quoted literals.
That pass already earned its keep - it turned dozens of 1-count rows into a single row reading
**519 in 24h**, which is the entire point of the panel.

But it is brittle by construction. It groups on *string shape*, so two messages that mean the same
thing in different words stay separate, and the tuning was empirical.

**Embeddings group on meaning.** Embed each normalised message with `bge-m3`, cluster by cosine
similarity, and messages that mean the same thing collapse regardless of phrasing.

- **Cost:** effectively zero (~$0.04/month for everything).
- **Risk:** very low. It changes *grouping*, not counts. Counts stay exact sums of real events.
- **Testable:** yes, and this matters. We have `worker/cf.test.ts` covering `normalise` and
  `groupNormalised` already; a clustering pass gets the same treatment with fixed fixtures.
- **Keep the regex pass.** Run semantic clustering *on top of* it, and - importantly - **show when
  the two disagree.** A cluster the regex missed is a finding in itself.

Same technique applies to `degeneracyReason` on the DJ panel, where we currently strip parameters
(`too-short(20w < 24)` → `too-short`). Semantic clustering could reveal that `simile`,
`place-genre-compound` and `names-nothing` are one underlying failure mode - currently invisible
because they are three separate rows.

### 5.2 Runbook RAG - **highest value per unit of effort**

We have an unusually good corpus about this exact system: `RUNBOOK.md`, `FINDINGS.md`, `README.md`,
`SECURITY-REVIEW.md`, `CLAUDE.md`, `queries/d1.sql` (every query annotated with its real result), and
now several handover documents. All of it written to distinguish verified from inferred, and dated.

That is a better RAG corpus than most teams ever assemble, and **it is already the answer to most
questions an operator asks at 3am.** "What does a 404 on `/admin/*` mean?" is answered precisely in
three documents - it means the rate limiter, or a role below the route, or migration 0003 missing,
*in that order of likelihood.*

AI Search over `docs/` would surface that at the point of failure instead of requiring someone to
remember which file it is in. Better still: **link it to `reasonText()`**, so every `unavailable`
state can offer "why does this happen?" backed by our own documentation.

- **Cost:** free during beta.
- **Risk:** low - it retrieves and quotes *our* text. Cite the source file and let the operator click
  through; the citation is what keeps it honest.

### 5.3 Natural-language → named query - **safe because of existing architecture**

"Show me 4xx on auth routes over the last 6 hours" → the model selects `/api/cf/status4xx` with
`hours=6` and a route filter, from the allowlist. It never writes a query; it routes to one we wrote.

- **Cost:** ~$0.0003/question.
- **Risk:** moderate, entirely from §4's injection concern. Mitigate by giving this component **no
  access to raw log text** - it sees the question and the tool schemas, nothing else.
- **Payoff:** real. The dashboard has nine views and a lot of hard-won detail; "where do I look for X"
  is a genuine cost for anyone who is not the person who built it.

### 5.4 Incident narrative on Overview - **valuable, most dangerous, do it last**

"Recommendation fallback is at 19%, up from 3.4% at 7d. Two deploys landed in that window."

- **The rule:** it receives the *already-computed* signals from `health.ts` plus the deploy list, and
  writes prose. **It must not be given raw data to aggregate**, because it will get arithmetic subtly
  wrong and subtle wrongness is worse than obvious wrongness.
- Every number in the output must be traceable to an input we computed. Schema-constrain the output
  so each claim carries the signal id it came from, and render numbers from *our* values, not from the
  model's text.
- Label it unmistakably as generated, and keep the underlying panel adjacent and primary.

Note the honest counter-argument: the Overview verdict is already good precisely because it is
deterministic and terse. Prose may be a downgrade. **Worth prototyping behind a flag and being
willing to throw away.**

---

## 6. What I recommend against

- **Letting an LLM set or tune thresholds.** `health.ts` values are calibrated to measured baselines
  and documented as such - the DJ warn line is 25% because the guard rejects ~14% when healthy, with
  a `MIN_SAMPLE` floor because DJ events run ~44/day. A model would produce round numbers with
  confident justifications. Straight downgrade.
- **Any LLM-computed number.** Counts, rates, percentages, deltas. Non-negotiable - see the verdict.
- **LLM-driven remediation.** We have not shipped a single write yet; mutations are deliberately last.
- **Replacing `reasonText()` with generated text.** Those strings encode hard-won knowledge in a
  specific order of likelihood. Generation would lose the ordering, which is the valuable part.
- **Chat as the primary interface.** This tool's job is the ten-second answer. A chat box is a slower
  path to a worse version of what the Overview already does.

---

## 7. Recommended spike

Smallest thing that proves the value, roughly a day:

1. Add the `AI` binding (`wrangler.jsonc`) - no new secret, no new privilege.
2. **Redaction pass** in `worker/cf.ts`: strip emails and numeric ids before anything leaves for
   inference. Unit-test it. Do this first, so it cannot be forgotten later.
3. **Semantic clustering behind a query flag** (`?cluster=1`), running alongside the regex grouping
   and **displaying both**. Judge it on whether it finds groups the regexes missed.
4. Point **AI Search** at `docs/` and wire one "why does this happen?" affordance into `Unavailable`.
5. Add an **AI Gateway spend limit** - $5/day - before any of this ships. Not because we expect cost,
   but because an unbounded loop against an inference endpoint is exactly the kind of thing that
   should fail closed. Costs nothing to set up.

Defer 5.3 and 5.4 until the grouping work shows the plumbing is sound.

**A design constraint for whatever we build:** LLM output must have its own visual treatment,
distinct from measured values, and must degrade to `unavailable` like any other source. If the model
call fails, the panel says so - it does not fall back to silence, and it certainly does not fall back
to fixtures.

---

## 8. Open questions

- **Workers AI retention.** Undocumented. Worth asking Cloudflare before sending anything with PII,
  even redacted.
- **Model deprecation cadence.** `gemma-3-12b` is already marked deprecated (5/30/2026). Whatever we
  pick, pin it in config and expect to move; treat the model id as a Tier 1 config value.
- **Rate limits.** Text generation is 300 req/min on most models - irrelevant for one operator, worth
  knowing before any batch job.
- **Does semantic clustering actually beat the regexes on our data?** Genuinely unknown. The regex
  pass is well-tuned. §7 is designed to answer this empirically rather than assume it.

---

## Sources

- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)
- [Workers AI limits](https://developers.cloudflare.com/workers-ai/platform/limits/)
- [glm-4.7-flash](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/) ·
  [gemma-4-26b-a4b-it](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/) ·
  [nemotron-3-120b-a12b](https://developers.cloudflare.com/workers-ai/models/nemotron-3-120b-a12b/)
- [JSON mode / structured outputs](https://developers.cloudflare.com/workers-ai/features/json-mode/)
- [AI Gateway spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/) ·
  [Guardrails & DLP](https://developers.cloudflare.com/ai-gateway/features/guardrails/)
- [AI Search limits & pricing](https://developers.cloudflare.com/ai-search/platform/limits-pricing/)
- [Vectorize pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare responsible AI](https://www.cloudflare.com/trust-hub/responsible-ai/)
