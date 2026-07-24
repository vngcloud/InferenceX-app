---
name: sync-upstream
description: Sync this vngcloud/InferenceX-app self-host fork with upstream SemiAnalysisAI/InferenceX-app, and safely update a long-lived local branch or open PR against a moving master. Preserves self-host-only customizations (deploy workflows, Dockerfile, GITHUB_REPOS enrichment) that upstream doesn't have and would otherwise get silently reverted or fought over on every merge. Use when asked to "sync upstream", "pull upstream changes", "update/rebase this PR", "merge upstream/master", or when an open fork-sync PR has gone stale against master.
---

# Syncing this fork with upstream

This repo (`vngcloud/InferenceX-app`, remote `origin`) is a long-lived fork of
`SemiAnalysisAI/InferenceX-app` (remote `upstream`), which ships continuous
unrelated changes (new models, GPUs, chart features, docs). Because we carry
a small but load-bearing set of self-host-only customizations on top, a naive
`git merge upstream/master` or a rebase of a long-lived branch can silently
drop our customizations or produce conflicts in the same handful of files
every time. This skill is the repeatable procedure — don't re-derive it from
scratch each time upstream moves.

Verify remotes first (`git remote -v`) — expect:

```
origin    https://github.com/vngcloud/InferenceX-app.git
upstream  https://github.com/SemiAnalysisAI/InferenceX-app.git
```

## The self-host-only customization surface

These files/areas exist ONLY in this fork and have no upstream counterpart to
merge against — they must survive every sync untouched (upstream will never
conflict with them directly, but a careless "reset to upstream" or bulk
revert would destroy them):

- **`.github/workflows/deploy.yml`, `.github/workflows/deploy-dev.yml`** — self-hosted-runner deploy pipelines (build image, run migrations pre-build against a real Postgres, `docker compose up -d`, smoke test). Upstream deploys via Vercel and has no equivalent.
- **`Dockerfile`, `.dockerignore`** — the self-hosted image build. Upstream doesn't containerize.
- **`packages/constants/src/github.ts` → `GITHUB_REPOS`** — must include `'vngcloud/InferenceX'` (the benchmark-source repo for this fork) alongside `SemiAnalysisAI/InferenceX` and `InferenceMAX/InferenceMAX`. **Check this every sync** — it has been dropped/absent on `master` before (missing here silently breaks GitHub API run enrichment for every ingest sourced from `vngcloud/InferenceX`: `workflow_runs.status/conclusion/name` all come back blank, which then hides the run from `/api/v1/availability` since that query requires `conclusion IS NOT NULL`). If you just ingested a run and its dropdown data is missing, check this constant before anything else.
- **Self-host-only docs** (if present) describing the dev/prod deploy flow, DB access, and dev-box conventions — these have no upstream equivalent (upstream doesn't have a self-hosted dev/prod pair on one box). Don't let a docs-only upstream change clobber them.
- **Model/GPU/framework registry entries added for hardware or checkpoints this fork benchmarks that upstream doesn't** (e.g. `rtx5090`, `b300-netperf`/`h200-greennode` naming, any `dsv2lite`-style additions) — these are net-new entries, not conflicts, but double check they don't get silently dropped by an upstream revert of the same enum/config file.

Everything else in the repo should track upstream directly — don't accumulate
unnecessary fork drift. If you're about to add a fork-only customization
outside the list above, prefer gating it narrowly (a single constant, a single
workflow file) so future syncs have less surface to reconcile.

## Routine sync: pull latest upstream into `origin/master`

1. `git fetch upstream master`
2. Diff first to see what's actually different before merging — `git diff --stat upstream/master origin/master` shows the fork-only surface (should roughly match the list above); `git log origin/master..upstream/master --oneline` shows what upstream added since the last sync.
3. Create a sync branch off `origin/master` (never merge upstream directly into `master`): `git checkout -b chore/sync-upstream-<date> origin/master`
4. `git merge upstream/master` — **merge, not rebase**. This branch will likely be pushed and reviewed as a PR; rebasing a pushed/shared branch forces a history rewrite and a force-push, which this repo's git safety rules avoid unless explicitly requested. A merge commit is the lower-risk default for reconciling two long-lived histories.
5. Resolve conflicts. In practice they cluster in the self-host-only surface above (deploy.yml, github.ts) plus wherever upstream and this fork both touched the same registry file (`data-mappings.ts`, `gpu-keys.ts`, `normalizers.ts`, `compare-slug.ts`) in the same spot — usually additive, resolve by keeping both sides' entries rather than picking one.
6. **DB migrations are the highest-risk conflict type**: if upstream added a new numbered migration (`packages/db/migrations/NNN_*.sql`) and this fork independently added one with the same number, do not silently pick one — renumber the fork-only migration to sort after upstream's latest, so both apply in a defined order. Check `schema_migrations` conventions in `packages/db` before renumbering. This exact scenario has broken this fork before (two `006_*`/`007_*` migrations with different intent, both altering the same materialized view) and required a manual DB reconciliation after merge — treat any migration-number collision as a stop-and-verify point, not a quick pick.
7. Run the full verification suite before opening a PR: `pnpm typecheck && pnpm lint && pnpm fmt && pnpm test:unit`. Also grep for the self-host customization surface post-merge (`grep -n "vngcloud/InferenceX" packages/constants/src/github.ts`, `git diff upstream/master HEAD -- .github/workflows/deploy.yml Dockerfile` should still show our infra intact) to confirm nothing got silently reverted.
8. Open a PR `origin/<sync-branch> → origin/master` (bilingual title/description per `AGENTS.md`). Don't wait on the `Tests (E2E)`/`Tests (Unit)` GitHub Actions checks to go green before merging — they don't complete on this fork's CI runner; rely on the local verification from step 7 instead.
9. After merging, deploy runs migrations automatically as part of `deploy.yml` — no manual migrate step needed. If the merge touched ingest-affecting constants (model/GPU/repo registries), consider whether any already-ingested prod rows need a re-ingest or a manual DB patch to pick up the new mapping (same pattern as fixing a `workflow_runs.conclusion` left blank by a pre-fix ingest).

## Updating a long-lived local branch / open PR against a moving `master`

Same principle, smaller scope — when a PR branch (e.g. a fork-sync PR, or any
feature branch that's been open a while) has drifted behind `origin/master`:

1. `git fetch origin`
2. On the PR branch: `git merge origin/master` (again, merge over rebase — the branch is already pushed/reviewed, so rebasing would force-push and potentially discard review context).
3. Resolve conflicts using the same "additive, don't silently pick one side" approach, paying special attention to any file in the self-host customization surface above and to migration numbering.
4. Re-run the verification suite (step 7 above) before pushing the merge commit.
5. If the branch has been open long enough that `master` itself has since re-diverged (e.g. `master` merged other work that conflicts with this branch's intent), treat it as a fresh review pass — re-read what `master` currently has before assuming your branch's version of a shared file is still correct.

## Why this keeps recurring

Upstream ships continuously and this fork's self-host layer is thin but
load-bearing, so every sync re-touches the same handful of files. The fix
for "this keeps being painful" isn't a bigger one-time reconciliation — it's
keeping the fork-only surface small (the list above) and re-checking it
every time, rather than letting fork-only changes spread into files upstream
also actively edits.
