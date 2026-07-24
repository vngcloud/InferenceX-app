# Intent & users (upstream)

A redesign reference — bones only. What SemiAnalysis was actually building and for whom. POV: read of upstream artifacts (README, blog, page structure, naming, what gets tracked in PostHog).

## The thesis in one paragraph

LLM inference performance is impossible to compare honestly across hardware/software/precision/model/parallelism because the search space is huge, the software stack changes weekly, and vendor-published numbers are cherry-picked. SemiAnalysis runs the same standardized benchmark sweep **nightly**, on the **latest software** for every framework, across **every parallelism setting** (tp, ep, conc, disagg), for the most-deployed models, on the GPUs people actually buy. The dashboard publishes the raw data plus a few opinionated views (throughput-vs-latency frontiers, $/token TCO calculators) so the community can argue from a shared dataset.

Three reinforcing claims:

1. **Static benchmarks lie.** Nightly cadence + latest software = current truth.
2. **Cherry-picked configs lie.** Sweep tp / ep / conc = the full Pareto front.
3. **Vendor numbers lie.** Open data + open methodology = community accountability.

The dashboard is a **trust-building artifact** for SemiAnalysis. The DB and the chart are the product; the company sells research and consulting around it.

## Who actually uses it — derived from page structure

The tab structure (`page-content.tsx VALID_TABS`) maps almost 1:1 to user archetypes. The order is the team's prioritization, top to bottom:

| Tab                              | Question it answers                                                                 | Primary user                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **inference** (scatter, default) | "On this hardware × this software stack, what's the throughput / latency frontier?" | **ML inference engineer** building serving infra                                 |
| **evaluation**w                  | "Does precision X actually preserve accuracy?"                                      | **AI researcher / ML scientist** validating quantization or speculative decoding |
| **historical-trends**            | "How fast is software actually improving — week over week, on the same hardware?"   | **Tech lead / VP eng** doing capacity & roadmap planning                         |
| **throughput-calculator**        | "Given my QPS and SLO targets, how many GPUs do I need and what does it cost?"      | **Infra buyer / capacity planner / CFO advisor**                                 |
| **reliability**                  | "Which (hw, framework) combos actually finish without crashing?"                    | **SRE / on-call** picking what to deploy                                         |
| **gpu-specs**                    | "What are the raw specs of this hardware and how do they compare?"                  | **GPU buyer / hardware analyst**                                                 |
| **blog**                         | Long-form analysis                                                                  | **Anyone curious** (SEO/awareness funnel)                                        |

A reasonable consolidation of those into personas:

### 1. ML inference engineer (primary)

- Picks a model + hardware, scans the throughput-vs-latency scatter, finds the best framework + parallelism config for their SLO.
- Cares about: TPOT, TTFT, throughput/GPU, interactivity, p99 metrics.
- Tab: **inference** (most-loaded tab; default route).
- What they ignore: blog, gpu-specs reference page (they already know the specs of the GPU they bought).

### 2. AI researcher / ML scientist

- Validates that an inference-time optimization (FP8, MTP, speculative decoding) doesn't tank accuracy.
- Cares about: gsm8k / mmlu / aime scores per precision × framework, side-by-side with throughput.
- Tab: **evaluation**, **eval-samples** (per-prompt inspection), **historical-trends**.
- What they ignore: TCO calculator, reliability.

### 3. Tech lead / engineering leader

- Tracks the rate of software improvement to plan capacity / negotiate vendor contracts.
- Cares about: time-series of throughput at fixed (model, hw, conc), commit-level changelogs explaining jumps.
- Tab: **historical-trends**, **changelog** drawer.
- What they ignore: per-prompt eval samples, GPU specs detail.

### 4. Infra buyer / capacity planner

- Translates dashboard numbers into $/token at their workload shape.
- Cares about: throughput-calculator TCO matrix, hardware $/hr, mixed-hardware portfolios.
- Tab: **throughput-calculator**.
- What they ignore: eval samples, server logs.

### 5. Hardware analyst / GPU buyer / industry observer

- Wants flop count, memory bandwidth, $/hr, the "intent" each card was designed for, and how that maps to measured perf.
- Cares about: gpu-specs detail page, the realized-vs-rated efficiency.
- Tab: **gpu-specs**.
- This is SemiAnalysis's own analyst audience — the dashboard makes their long-form articles credible.

### 6. CEO / exec / "I just want a number"

- Reads SemiAnalysis blog posts that cite the dashboard. Doesn't open the dashboard directly except to validate a quote.
- Cares about: a single number ("H200 is 1.8× H100 for Llama-70B FP8") that they can put in a board deck.
- Tab: usually **blog**, occasionally landing-page comparisons.
- This is the _awareness_ surface; the dashboard's job is mostly to back up claims they read elsewhere.

### 7. Hardware vendor (NVIDIA, AMD, Intel, Trainium…)

- Not a real user — but they _react_ to the dashboard. SemiAnalysis publishing nightly numbers creates competitive pressure to ship better software/recipes. The "framework changelogs" + commit-level attribution exist partly so vendor engineers can see "your release didn't move the needle / regressed this thing."
- Indirect but heavily shapes the _cadence_ and _transparency_ requirements: vendors will gripe if SemiAnalysis runs stale software, so the nightly sweep on `main` is table-stakes.

## What the dashboard is _not_ trying to be

Reading the design choices, this is what's deliberately out of scope:

- **Not a serving product.** No "run this model on this hardware for me" button. It's measurements, not infra.
- **Not a model leaderboard.** The dashboard never ranks models against each other on accuracy — it shows quantization-vs-baseline accuracy _within_ a model. Model choice is the user's; SemiAnalysis ranks hardware × software _given_ a model.
- **Not a real-time monitoring tool.** Cadence is "nightly," staleness window is a day. Reliability rollup is a single % over a sweep, not p99 latency over the last hour.
- **Not multi-tenant.** Public read-only dashboard, single admin team writes data. No login, no per-user state beyond URL params.
- **Not OLTP.** Writes are batched, idempotent, nightly. Reads are served from a materialized view + cached API routes. The database is treated like a slowly-built artifact, not a live system of record.

## The publication / trust loop

The pieces that look like ornamentation but are actually load-bearing for _trust_:

- **Every benchmark row links to its GitHub Actions run.** Provenance: anyone can audit the commands, the software versions, the raw logs.
- **`workflow_runs.head_sha` is captured.** Reproducibility: a specific run can be re-run by checking out the same SHA.
- **Server logs are stored** (linked off `benchmark_results.server_log_id`). Debugging: a vendor engineer can read the actual server output for a regression.
- **Changelog entries with PR links.** Attribution: jumps in the historical chart are explained by code changes, not magic.
- **OG image generation per blog post.** Distribution: SemiAnalysis tweets a chart, the OG image is a chart, drives clicks back to the dashboard.
- **`llms.txt` and `llms-full.txt`.** LLM ingestion: when ChatGPT or Claude or Gemini answer a question about inference performance, the answer cites _SemiAnalysis numbers_ because the AI ingested them.
- **The open repo itself.** The dashboard code is open-source (GPLv3); the benchmark methodology is in the InferenceX repo (also public). "Don't trust us, read the code."

These are the parts a redesign tends to deprioritize ("it's just metadata") and pay for later when someone disputes a number and can't reproduce it.

## What an opinionated redesign should preserve

If you're building a self-hosted / vngcloud-focused version of this:

1. **Nightly cadence as the core temporal unit.** Don't go more granular (data noise increases); don't go less (vendors out-iterate you).
2. **Sweep, don't cherry-pick.** Every config × every conc × every sequence shape, even when most points are uninteresting. The frontier is the product.
3. **Provenance on every row.** Run URL, commit SHA, server log. Without these the dashboard is just a list of numbers, not an argument.
4. **Static methodology pages.** Anyone can find "how did you measure this?" in 30 seconds. The dashboard is only as trusted as its methodology.
5. **One-glance answers + drill-down.** Default tab shows a chart in <2 seconds; every visible element is clickable down to the raw artifact.
6. **Public read-only.** Don't introduce auth on the read path. Auth gates writes (ingest, feedback, admin) only.

What's negotiable:

- The specific tab order (depends on your audience — researcher-heavy orgs put **evaluation** first).
- The TCO calculator's price assumptions (you may want your _own_ hardware cost model).
- The blog (only matters if you have a content team).
- The OG image / llms.txt / RSS feed (only matters if you publish externally).
- Vercel / Neon vs. self-host (already negotiated in our fork).

## Our team (VNGCloud / GreenNode)

Source of truth = `landing-page.tsx WORKFLOW`. This is the doc.

| Role               | Tab           | Doing                                          |
| ------------------ | ------------- | ---------------------------------------------- |
| Inference engineer | `/inference`  | Pick a serving config to deploy                |
| ML scientist       | `/evaluation` | Check FP8 / MTP / quant doesn't tank accuracy  |
| Tech lead          | `/historical` | Week-over-week throughput, PR-level changelogs |
| Capacity planner   | `/calculator` | QPS + SLO → GPUs + $                           |
| Anyone             | `/gpu-specs`  | FLOPS / BW / $/hr reference                    |

Stripped vs upstream:

- Marketing landing (`/`: "GigaWatt Token Factories" hero + carousel + curated comparisons) → replaced with the 5-row router above.
- Reliability, ai-chart, gpu-metrics, submissions, images — not in nav. Routes still live.

Kept: provenance links, changelogs, public read-only, `/about` `/blog` `/quotes` (harmless deadweight).
