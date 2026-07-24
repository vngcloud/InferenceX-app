---
name: fork-changelog
description: Running changelog of fork-only changes in vngcloud/InferenceX-app that have no upstream (SemiAnalysisAI/InferenceX-app) equivalent. Use BEFORE merging upstream/master (see the sync-upstream skill) to verify every entry below survived the merge intact. APPEND a new entry here every time you land a change that exists only in this fork — don't let fork drift go untracked.
---

# Fork-only changelog

This is the authoritative list of changes that exist **only** in this fork
and have no upstream counterpart. It exists so that a future upstream sync
(see the `sync-upstream` skill) can check each entry still holds after the
merge, instead of rediscovering "wait, why did this constant change again?"
from scratch. It is a supplement to `sync-upstream`'s "self-host-only
customization surface" list, not a replacement — that list covers the
structural surface (deploy workflows, Dockerfile); this log covers discrete
point-in-time changes within files upstream also edits.

**Maintenance rule:** every time you commit a change that is fork-only (no
upstream equivalent, made specifically for this self-host deployment or its
own benchmark data), add a row here in the same commit or PR. Entries should
be small and durable — what changed, where, and why — not a restatement of
the commit diff.

## Entries

### 2026-07-24 — `GITHUB_REPOS` includes `vngcloud/InferenceX`

- **File:** `packages/constants/src/github.ts`
- **What:** `GITHUB_REPOS` must include `'vngcloud/InferenceX'` alongside `SemiAnalysisAI/InferenceX` and `InferenceMAX/InferenceMAX`.
- **Why:** `vngcloud/InferenceX` is this fork's own benchmark-source repo (upstream only ever benchmarks from `SemiAnalysisAI/InferenceX`). Without this entry, `fetchGithubRun()` in `packages/db/src/etl/workflow-run.ts` 404s on every enrichment attempt for a run sourced from `vngcloud/InferenceX`, leaving `workflow_runs.status/conclusion/name` blank. Since the availability query (`getAvailabilityData` in `packages/db/src/queries/workflow-info.ts`) requires `conclusion IS NOT NULL`, affected runs ingest fine but never show up in `/api/v1/availability` or the model/config dropdowns — this has bitten every recent ingest and required a manual DB patch each time.
- **Watch for:** upstream editing `GITHUB_REPOS` (e.g. adding a new legacy repo alias) in a way that conflicts with this entry, or a squash-merge/branch-recreation incident (has happened before on this fork) silently dropping the `vngcloud/InferenceX` entry again.

### 2026-07-24 — DeepSeek-Coder-V2-Lite-Instruct (`dsv2lite`) model registration

- **Files:** `packages/constants/src/models.ts` (`DB_MODEL_TO_DISPLAY`), `packages/db/src/etl/normalizers.ts` (`MODEL_TO_KEY`), `packages/app/src/lib/data-mappings.ts` (`Model` enum + `MODEL_CONFIG`), `packages/app/src/lib/compare-slug.ts` (`COMPARE_MODEL_SLUGS`), `packages/app/src/lib/compare-ssr.ts` (`KNOWN_MODELS`)
- **What:** registers DB key `dsv2lite` → display name `DeepSeek-Coder-V2-Lite-Instruct` (HF checkpoint `RedHatAI/DeepSeek-Coder-V2-Lite-Instruct-FP8`, 16B total / 2.4B active MoE), category `default`.
- **Why:** this fork ran a `Remote Bench E2E` smoke test (`vngcloud/InferenceX` run `30077858703`, RTX 5090, sglang, fp8) against a model upstream has never benchmarked. Without a registered DB key, ingest silently skips every row for an unmapped model — nothing errors, the data just never lands.
- **Watch for:** if upstream ever adds its own entry for this model (or a similarly-named one) with a different DB key or display name, reconcile rather than duplicate — check `DB_MODEL_TO_DISPLAY` for a collision on the display name first.

## When merging upstream

For each entry above: confirm the file still contains the described change
after the merge (a quick `grep` per entry is usually enough — see the exact
strings named in "What"). If a merge conflict touches one of these files,
resolve additively (keep both upstream's new content and this fork's entry)
rather than picking a side wholesale.
