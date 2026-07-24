# Ingest flow (upstream)

A redesign reference — bones only. How a benchmark run becomes rows. POV: upstream's `repository_dispatch`-driven flow (`SemiAnalysisAI/InferenceX-app/.github/workflows/ingest-results.yml`).

## The contract

> Given a GitHub Actions workflow run ID from the benchmark repo, ingest its artifacts into Postgres such that running ingest twice produces identical DB state.

Idempotency is non-negotiable. Every write is `ON CONFLICT DO UPDATE` or `DO NOTHING`. This is what lets the same script power one-off manual runs, scheduled CI, and bulk historical backfills from GCS — they all hit the same code.

## The artifact world

A finished benchmark sweep on `SemiAnalysisAI/InferenceX` produces ~100+ artifacts per run. They're ZIPs uploaded by the workflow; their **names** carry the routing information:

| Artifact name pattern             | What's inside                                                                   | Becomes                                                        |
| --------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `bmk_*` (new) / `results_*` (old) | One benchmark dict per artifact / array of dicts                                | `benchmark_results` rows                                       |
| `gpu_metrics_*`                   | NVIDIA-SMI / ROCm-SMI samples (currently parsed only into metrics)              | metrics merged into bmk                                        |
| `server_logs_*`                   | One `server.log` text file                                                      | `server_logs` row + FK on `benchmark_results.server_log_id`    |
| `run-stats_*` / `run_stats_*`     | Reliability dict: `{ hw: { n_success, total } }`                                | `run_stats` rows                                               |
| `eval_results_all_*`              | Aggregate eval array (one per task × config)                                    | `eval_results` rows                                            |
| `eval_*`                          | Per-config eval bundle (`meta_env.json` + `results_*.json` + `samples_*.jsonl`) | `eval_results` + `eval_samples` rows                           |
| `changelog-metadata_*`            | Changelog entries (base_ref, head_ref, list of changed config keys)             | `changelog_entries` rows                                       |
| `reused-ingest-artifacts`         | Bundle of artifacts re-uploaded from a PR sweep                                 | flattened into the run's own artifact set (see "Reused" below) |

The mappers in `packages/db/src/etl/*-mapper.ts` are the only code that knows these names. Adding a new artifact category is purely a mapper change.

## The stages

```
                ┌─── (CI mode) repository_dispatch ──→ workflow downloads artifacts to $INGEST_ARTIFACTS_PATH
trigger ────┤
                └─── (manual) `pnpm admin:db:ingest:run <url>` ──→ gh api downloads artifacts to /tmp

                        ↓

[1] migrate           pnpm admin:db:migrate --yes
                      Apply any unapplied migration. Idempotent.

[2] flatten reused    flattenReusedIngestArtifactBundle()
                      Move `reused-ingest-artifacts/<name>/` up to `<name>/`.
                      Read `reuse_source_run.json` if present → reattribute rows
                      to the original PR sweep's run ID (so dashboard links to
                      the real benchmark run, not the re-upload trigger).

[3] resolve run       fetchGithubRun() → workflow_runs upsert
                      Hit GH API for name/head_branch/head_sha/created_at/run_attempt.
                      Insert into workflow_runs ON CONFLICT (github_run_id, run_attempt) DO UPDATE.

[4] preload configs   configCache.preloadConfigs()
                      Load ALL existing configs into an in-memory Map keyed by their
                      17-column natural key. Single query, no N+1.

[5] benchmark mapper  for each bmk artifact:
                        mapBenchmarkRow(raw, tracker)
                        ├── resolveModelKey() → null = SKIP (unmapped model)
                        ├── hwToGpuKey()      → null = SKIP (unmapped hardware)
                        ├── normalizeFramework() handles dynamo-trtllm → dynamo-trt,
                        │                              sglang-disagg → mori-sglang + disagg=true
                        ├── normalizePrecision()
                        └── return BenchmarkParams or null

[6] config upsert     for each successfully mapped row:
                        getOrCreateConfig(params.config) → config_id
                        Cache hit OR INSERT ... ON CONFLICT DO UPDATE RETURNING id.

[7] bulk ingest       bulkIngestBenchmarkRows(rows, workflow_run_id, sql)
                      One INSERT ... VALUES (...), (...), ... ON CONFLICT (workflow_run_id,
                      config_id, benchmark_type, isl, osl, conc) DO UPDATE.
                      Same for bulkIngestRunStats, bulkUpsertAvailability,
                      bulkIngestEvalSamples, insertServerLog, ingestEvalRow,
                      ingestChangelogEntries.

[8] refresh MV        refreshLatestBenchmarks(sql)
                      REFRESH MATERIALIZED VIEW CONCURRENTLY latest_benchmarks.
                      Required after writes; reads stay live during refresh.

[9] apply overrides   pnpm admin:db:apply-overrides --yes
                      Walk PURGED_RUNS and CONCLUSION_OVERRIDES from
                      etl/run-overrides.ts; delete or relabel any matching
                      workflow_runs. Idempotent.

[10] verify           pnpm admin:db:verify
                      Schema/data sanity checks.

[11] invalidate cache POST /api/v1/invalidate
                      Bearer-token-authenticated. Flushes the Next.js API cache so
                      the dashboard reflects new rows immediately instead of waiting
                      on cache TTL.

[12] notify           Slack webhook for unmapped entities and on failure.
```

## The skip tracker — most-important under-discussed piece

`packages/db/src/etl/skip-tracker.ts` increments counters when a mapper can't resolve `model`, `hardware`, or `precision`. Behavior:

- **Silent at the row level** — a SKIP doesn't raise; the row is dropped.
- **Loud at the run level** — totals print at end-of-ingest with the actual unmapped string values: `"Unmapped model values (add to MODEL_TO_KEY to ingest): ..."`.
- **Reported externally** — the CI workflow writes `unmapped-entities.json`, then the next workflow step posts to Slack if non-empty.

**This is the most common failure mode and the easiest to miss.** A run can ingest "successfully" with `Benchmark results: 0 new, 0 duplicate` because every row hit an unmapped model. The exit code stays zero. The fix is always: add the mapping to `packages/constants/` (display name) + `packages/db/src/etl/normalizers.ts` (key resolver), redeploy, re-run the same ingest (idempotent — the rows land).

The design rationale for "silent + drop" instead of "loud + crash" is that benchmark sweeps mix old and new configs; making one unknown model take down the whole sweep's ingest would block the rest of the data from landing.

## Why so many ingest entry points

The same ETL core is wrapped in four call sites:

| Entry point                                         | Triggered by                                                   | Why it exists                                                                |
| --------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `db:ingest:run` (`ingest-ci-run.ts --download`)     | Human typing `pnpm admin:db:ingest:run <url>` locally          | One-off ingest of a finished sweep; downloads artifacts on demand            |
| `db:ingest:ci` (`ingest-ci-run.ts` no `--download`) | `repository_dispatch` from the benchmark repo                  | Production auto-ingest; workflow downloaded artifacts already                |
| `db:ingest:gcs` (`ingest-gcs-backup.ts`)            | Manual against a synced `gs://inferencemax-gha-backup/` mirror | Bulk historical backfill or DR — never wired into automation                 |
| `db:ingest:supplemental` (`ingest-supplemental.ts`) | Manual; reads `packages/db/data/*.json`                        | Hand-curated baselines that aren't produced by the benchmark CI (gsm8k base) |

All four share `etl/*-mapper.ts`, `etl/*-ingest.ts`, `etl/config-cache.ts`, `etl/workflow-run.ts`, `etl/normalizers.ts`. The split is purely about _how artifacts get into the script's hand_, not what happens after.

## Cross-repo triggering — the unobvious bit

GitHub does not fire `workflow_run` events across repos. So to auto-ingest, upstream uses **repository_dispatch**:

1. The benchmark repo (`SemiAnalysisAI/InferenceX`), at the end of its sweep workflow, calls `gh api repos/SemiAnalysisAI/InferenceX-app/dispatches -f event_type=ingest-results -F client_payload[run-id]=$RUN_ID`.
2. The dashboard repo's `ingest-results.yml` listens for `repository_dispatch: types: [ingest-results]` and fires within seconds.

This means the ingest pipeline is fully event-driven, not polled. But it also means **the benchmark repo must opt in**: there must be a step on its side that sends the dispatch. Removing or breaking that step silently halts ingestion with no error on the dashboard side. (Our vngcloud fork side-steps this by polling instead — see `auto-ingest.yml` — at the cost of up-to-15-min lag.)

## Reused-ingest metadata — the strangest piece

When a PR sweep on the benchmark repo finishes, the _PR run_ uploads a special `reused-ingest-artifacts` bundle containing artifacts copied from an _earlier_ sweep run (e.g. "use yesterday's H100 numbers as the baseline against today's recipe change"). On ingest:

1. `flattenReusedIngestArtifactBundle()` moves the bundled artifacts up one level so they look like first-class artifacts.
2. `readReusedIngestMetadata()` reads `reuse_source_run.json` from the bundle and **reattributes** all those rows to the original source run's `(github_run_id, run_attempt)` — not the PR-sweep run.

Why: the dashboard links benchmark rows to the GitHub Actions run page. If a PR sweep reuses yesterday's H100 data, you want the link to go to **yesterday's H100 run** (where the data was actually produced), not to the PR sweep (which just re-uploaded it).

It's load-bearing but easy to overlook. Most ingests don't have this bundle and just skip stage 2.

## Run overrides — the surgical scalpel

`packages/db/src/etl/run-overrides.ts` is a hand-maintained list:

```ts
PURGED_RUNS = new Set([...])           // delete these run IDs entirely
CONCLUSION_OVERRIDES = { id: 'failure' | 'success' | ... }  // relabel
```

Used when a sweep ingested but the data turned out to be wrong (e.g. broken serving recipe, wrong precision flag, runner had a bad cooling event). Adding a run ID to `PURGED_RUNS`, re-running `apply-overrides`, and refreshing the MV erases its effect from the dashboard without touching any data files.

This is the override-of-last-resort. Don't use it for routine cleanup — fix the source.

## What's load-bearing vs. accidental

**Load-bearing:**

- Idempotency at every write (lets manual + CI + GCS share code)
- The mapper / ingest split (mappers know artifact JSON; ingest knows SQL)
- `configCache.preloadConfigs()` (single query, prevents N+1)
- Skip-tracker's "silent row, loud run" design
- Reused-ingest attribution (links must point at real benchmark runs)
- MV refresh on every ingest (else dashboard goes stale)
- `lower()` normalization in ETL (matches the DB CHECK constraint)

**Accidental:**

- Artifact naming is a contract that lives in two repos with no schema enforcement. A typo in the benchmark workflow can silently route an artifact to the wrong mapper. A schema file ("here are the categories and their patterns") shared between both repos would tighten this.
- The 5-minute `sleep 300` in `ingest-results.yml` ("wait for the source run to finish") is a hack to avoid racing the GitHub Actions API. A proper retry-on-not-finished-yet loop would be more robust.
- The "old format `results_*` array" vs "new format `bmk_*` single dict" branching in mappers is historical. A schema version bump on the benchmark side would let us drop the old branch.
- Eval ingest has three near-parallel paths (`eval_results_all_*` aggregate, per-config `eval_*` bundle, GCS) that compute the same conclusions slightly differently. Could be one path.
- `availability` is written from the bmk path, not from a trigger. If we redesigned, it'd be a generated column or a query against `latest_benchmarks + configs`.
- `INFX_MAIN_PAT` (the GitHub token that fetches artifacts) is named after the InferenceX repo, hardcoded as a secret. A more generic `INGEST_SOURCE_TOKEN` would let the same workflow ingest from arbitrary source repos.

## The shape a redesign should preserve

If you're rewriting this from scratch, keep:

1. **Idempotent writes everywhere.** This is the single biggest thing.
2. **Artifact-name as routing.** Don't introduce manifests or RPCs — files in S3-like storage with predictable names is what makes backfill / DR / dev / prod all use the same code.
3. **Mapper → cache → bulk-upsert** as three separate phases. Each gets independently testable.
4. **Skip tracker that reports unmapped values by string.** Don't make the operator dig through `[SKIP]` log lines to figure out what to add.
5. **Run overrides as code, not as DB rows.** Reproducibility — the override history lives in git.
6. **Re-attribution of reused artifacts.** Users always want links to point at where data was produced.
