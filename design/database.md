# Database design (upstream)

A redesign reference — bones only. What every table is for, what every invariant exists to defend, what's load-bearing vs. accidental. POV: SemiAnalysisAI/InferenceX-app as it exists today (Postgres on Neon).

## The shape of the data

Every benchmark run produces points of the form:

> "On **{hardware}** running **{framework}+{precision}** serving **{model}** at parallelism **{tp/ep/disagg/...}**, when given **{conc}** concurrent requests with **{isl} → {osl}** sequence shape, we measured **{metrics}** on **{date}**."

The schema is a 3-layer projection of that sentence:

```
configs       ← the immutable "how it's served"          (1 row per unique serving setup)
   ↑
benchmark_results ← measurements at a point on the sweep ← workflow_runs (the CI run that produced them)
eval_results      ← accuracy measurements on the same    ↗
run_stats         ← reliability rollup (n_success/total) ↗
availability      ← denormalized: "for which (model, isl/osl, hw, ...) tuples do we have any data on date D?"
```

`changelog_entries`, `server_logs`, `eval_samples`, `user_feedback` hang off the side but aren't on the hot path.

## Why split configs out at all

A naive schema would put hw / model / framework / precision / parallelism / metrics all on one row per measurement. They split because:

- One "config" appears at dozens of (conc, isl, osl) points per sweep — duplicating 17 text/int columns × dozens of points × thousands of sweeps wastes space and confuses filters.
- The dashboard's primary navigation is "pick a config, then look at its points along conc / sequence / time". Pivoting around `config_id` makes that a single integer FK lookup.
- `configs.constraint configs_natural_key` is a 17-column UNIQUE — any of those 17 dimensions differing creates a new config. That's deliberate: the dashboard treats `tp=4` and `tp=8` of the same model+hw as **different lines on the chart**, not the same config measured twice.

## Critical invariants (do not break casually)

- **All text keys are lowercase.** Enforced by `CHECK (col = lower(col))` on `configs.hardware/framework/model/precision/spec_method`, `run_stats.hardware`, `eval_results.task`. ETL is the lowercaser. The CHECK is the safety net — multiple ingest paths exist (CI, GCS, supplemental), so DB-level enforcement keeps them honest. If you ingest `H100`, ingest fails loudly instead of silently creating a duplicate of `h100`.
- **`workflow_runs.(github_run_id, run_attempt)` is the natural key.** Re-ingesting the same run produces the same row. Reading code never joins `workflow_runs` directly — it joins `latest_workflow_runs`, a view that picks `DISTINCT ON (github_run_id)` ordered by `run_attempt DESC`. Effect: re-runs supersede originals on read, without deleting history.
- **`benchmark_results.error IS NULL` means success.** All hot indexes and the `latest_benchmarks` MV are partial indexes `WHERE error IS NULL`. Failures are stored but never on a chart.
- **`latest_benchmarks` is a materialized view, not a query.** The `DISTINCT ON (config_id, conc, isl, osl) ORDER BY date DESC, run_started_at DESC NULLS LAST` query is too expensive to run per request on millions of rows. MV is refreshed `CONCURRENTLY` after each ingest — reads stay live during refresh; brief staleness window is acceptable.
- **`benchmark_results` and `eval_results` denormalize `date`** from their workflow_run. Lets date-filter queries skip the join. Drift between `benchmark_results.date` and `workflow_runs.date` would be a bug.
- **`prefill_*` mirrors `decode_*` when `disagg=false`.** ETL fills both halves identically. `num_prefill_gpu + num_decode_gpu = num_gpus_used` always; for non-disagg they're equal. Migration 004 relaxed the `>= 1` constraints to allow `0` because aggregated multinode disagg runs can legitimately put all GPUs on prefill at low conc.

## Index strategy — what the queries actually look like

The two real read patterns:

1. **"Latest point for this config at this (conc, isl, osl)."** Served by `latest_benchmarks` MV (PK `(config_id, conc, isl, osl)`).
2. **"All historical points for this (isl, osl) over time."** Served by `benchmark_results_seq_history_idx`, a covering index `(isl, osl, date, config_id, conc) INCLUDE (image, metrics) WHERE error IS NULL`.

Both are partial-on-success and INCLUDE the metrics JSONB so the index can answer the query without touching the heap. That's the whole point of having an index this wide — it's an index-only scan in practice.

## Why JSONB for metrics

`metrics` is a JSONB blob, not 20 typed columns. Reasons:

- New metrics get added regularly (auc, intvty, p99*e2el, measured_power*\*…). Schema migrations per metric would be a paper-cut tax on the science team.
- Frontend already maps a known set (`METRIC_KEYS` in `packages/constants`) and treats unknowns gracefully.
- Partial covering indexes can still INCLUDE the whole JSONB.
- Trade-off: no DB-level type enforcement on metric values. Mitigated by the mapper (`benchmark-mapper.ts` warns once per unexpected key, in `_warnedMetricKeys`).

## What's NOT in the DB (and why)

- **Hardware specs (TFLOPS, memory bandwidth, $/hr).** Lives in `packages/constants/` as a static TS map. Specs are reference data, not measurements; checking them into code lets the UI ship without a round trip.
- **Model display names.** Same — `DB_MODEL_TO_DISPLAY` in `packages/constants/src/models.ts`. The DB stores opaque keys (`gptoss120b`, `glm5.1`); the frontend renders the display string.
- **Blog content.** MDX files in `packages/app/content/blog/`. Statically generated. The DB never sees a blog post.
- **Configuration of the benchmark sweep itself.** That lives on the `SemiAnalysisAI/InferenceX` (capital X, no "-app") repo. The dashboard repo only ingests _outputs_.

## Encryption pocket: user_feedback (migration 005)

The only table with encrypted columns. Every user-supplied field is `base64(iv || ciphertext || authTag)` under AES-256-GCM with a server-held key. Free-text feedback may contain PII — encrypting at rest reduces blast radius if a DB snapshot leaks. Decryption happens in the admin viewer route, gated by `FEEDBACK_SECRET`.

## Migrations — what they teach you

- `001` — initial. Read this top-to-bottom; everything else is patches.
- `002` — per-prompt eval samples. Splits one big jsonl per eval into ~1.3k rows so the API can return one sample at a time without re-parsing.
- `003` — fix for "two sweeps on the same day tie and Postgres picks an arbitrary one". Adds `run_started_at DESC NULLS LAST` to the MV's ORDER BY.
- `004` — relax `>= 1` to `>= 0` on prefill/decode tp/ep/num_gpu. Multinode disagg can produce legitimate-zero configs.
- `005` — encrypted feedback.

The pattern: schema starts deliberately strict, gets selectively relaxed when the real data shape rejects rows it shouldn't. **Don't pre-relax constraints when redesigning** — strict-first is what catches ETL bugs.

## Backup / dump

`pnpm admin:db:dump` writes a portable ZIP. `pnpm admin:db:load-dump` restores. Used to seed local dev DBs without granting access to the real one. Frontend can also run **without** Postgres entirely by pointing `DUMP_DIR` at an unzipped dump — `json-provider.ts` then serves API routes from flat JSON. That's how dev-mode read-only previews work.

## What's load-bearing vs. accidental — opinion-free observations

**Load-bearing** (changing breaks something important):

- 17-column natural key on `configs`
- lowercase CHECK constraints (multiple ingest paths)
- `latest_workflow_runs` view (re-runs supersede)
- `error IS NULL` predicates on hot indexes
- `latest_benchmarks` MV + `REFRESH CONCURRENTLY`
- JSONB metrics column (vs. typed columns)
- Denormalized `date` on result tables

**Accidental** (could go either way in a redesign):

- `server_logs` as a separate table with only one column. Probably could be inlined onto `benchmark_results` as a nullable `text` and save a join. Split is historical.
- `availability` as a denormalized table. It's a query that could be replaced by `SELECT DISTINCT` over `latest_benchmarks` + `configs`. Exists as a table because the original query was slow before the MV; might be redundant now.
- `changelog_entries.config_keys text[]` as a denormalized array of "config natural keys". Bypasses the FK to `configs` — gluing changelogs to actual configs requires regenerating the natural key string at read time. A FK array would be tighter.
- The boolean `disagg` mirrored from `framework` (where `sglang-disagg` is normalized to `mori-sglang` + `disagg=true`). The split makes filtering easier but creates two sources of truth.
