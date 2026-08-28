---
name: ingest-run
description: Ingest one vngcloud/InferenceX GitHub Actions benchmark run into this fork's self-hosted prod DB, over SSH into the deploy host. Use whenever asked to "ingest this run", given a vngcloud/InferenceX actions/runs/<id> URL, or asked to get benchmark data from a workflow run into the dashboard. NOT for the upstream SemiAnalysisAI/InferenceX-app Neon-DB flow (a different agent/env covers that).
---

# Ingest one benchmark run (this fork, self-hosted host)

This fork does **not** use Neon. Prod is a self-hosted docker-compose stack on a
single runner host, with its own dockerized Postgres. That changes the ingest
mechanics vs. the upstream project's docs — follow this skill, not generic
`admin:db:ingest:run` examples you find elsewhere in the repo/docs.

## Environment (fixed facts about this deployment)

- **Deploy host**: `ssh -p 234 hoanq333@61.28.228.19`
- **Prod compose project**: `/opt/docker-compose/docker-compose.yml`, services
  `inferencex-app-1`, `inferencex-postgres-1` (local Postgres, NOT Neon), `inferencex-nginx-1`,
  `inferencex-certbot-1`.
- **Source repo for runs**: `vngcloud/InferenceX` (not `SemiAnalysisAI/InferenceX`).
- **`DATABASE_WRITE_URL`** on this host points at the local `postgres` compose service.
  It does **not** speak TLS — every `bun run admin:db:*` command below **MUST** pass
  `--no-ssl`, or you get a confusing `Client network socket disconnected before secure TLS
connection was established` / `ECONNRESET` error that looks like network flakiness but
  isn't. `deploy.yml`'s own migration step already does this (`admin:db:migrate --yes --no-ssl`).
- Dev stack (`inferencex-dev`, port `:8080`) is a separate, isolated compose project on the
  same host — this skill is about **prod**.

## Step 0 — confirm the run is actually finished

```bash
gh api repos/vngcloud/InferenceX/actions/runs/<RUN_ID> --jq '{name,status,conclusion}'
```

If `status` isn't `completed`, wait — do not attempt to ingest a partial run. Re-check later
(a `ScheduleWakeup`/poll loop, not tight retries).

## Step 1 — check whether the model/GPU/precision/framework is already registered

Read the run's job names and artifact names (`gh run view <RUN_ID> --repo vngcloud/InferenceX`,
not `--log`) and check whether the model prefix, hardware key, precision, and framework already
resolve in the codebase (`packages/constants/src/models.ts` `DB_MODEL_TO_DISPLAY`,
`packages/constants/src/gpu-keys.ts` `HW_REGISTRY`, `packages/db/src/etl/normalizers.ts`
`PRECISION_ALIASES`/`MODEL_TO_KEY`). **If anything is new, follow
`docs/adding-entities.md` first** — ingesting before the mapping lands means the DB silently
skips those rows (no error, no partial write — the ETL just drops what it can't resolve). Commit,
push to `master`, and wait for `deploy.yml` to finish (`gh run watch <run-id>`) before proceeding —
the new mapping has to actually be in the container's code for ingest to pick it up.

## Step 2 — download artifacts once, persistently, inside the container

The artifact-download step and the DB write step both go over flaky links from this host
(GitHub's artifact CDN, and TLS-handshake resets from the app container to the local Postgres
under load). Don't repeat `--download` end-to-end on every retry — it wastes time re-fetching
30+ artifacts just to retry the DB half. Split it:

```bash
ssh -p 234 hoanq333@61.28.228.19 \
  "cd /opt/docker-compose && docker compose exec -T app sh -c \
   'mkdir -p /tmp/ingest-<RUN_ID> && cd /tmp/ingest-<RUN_ID> && gh run download <RUN_ID> -R vngcloud/InferenceX && ls | wc -l'"
```

Confirm the artifact count matches what `gh run view` listed before moving on.

## Step 3 — ingest in CI mode against the local artifacts (retry this, not the download)

```bash
ssh -p 234 hoanq333@61.28.228.19 \
  "cd /opt/docker-compose && docker compose exec -T \
   -e INGEST_RUN_ID=<RUN_ID> -e INGEST_RUN_ATTEMPT=1 \
   -e INGEST_ARTIFACTS_PATH=/tmp/ingest-<RUN_ID> -e INGEST_REPO=vngcloud/InferenceX \
   -e UNMAPPED_ENTITIES_OUTPUT=/tmp/unmapped.json \
   app bun run admin:db:ingest:ci --no-ssl"
```

If it fails with the TLS/ECONNRESET error above, that's the local-Postgres connection blip, not
a real problem with the data — just retry this exact command a few times. Do NOT switch to
`admin:db:ingest:run <id> vngcloud/InferenceX` (the one-shot download+ingest command) as your
retry loop; that re-downloads everything each time.

Note the positional-arg gotcha if you ever do use the one-shot form: it's
`admin:db:ingest:run <RUN_ID> <owner/repo>` — **positional**, not `--repo <owner/repo>`. Passing
`--repo` makes the script try to parse `--repo` itself as a run ID and fail immediately.

Watch the summary block at the end for `+N new, M duplicate` counts per data type (benchmark
results, run stats, eval results, eval samples, changelog entries). `0 new, N duplicate` for a
run you know was already ingested is expected, not an error.

## Step 4 — overrides, verify, invalidate

```bash
ssh -p 234 hoanq333@61.28.228.19 "cd /opt/docker-compose && docker compose exec -T app bun run admin:db:apply-overrides --yes --no-ssl"
ssh -p 234 hoanq333@61.28.228.19 "cd /opt/docker-compose && docker compose exec -T app bun run admin:db:verify --no-ssl"
ssh -p 234 hoanq333@61.28.228.19 "cd /opt/docker-compose && docker compose exec -T app bun run admin:cache:invalidate http://localhost:3000"
```

`apply-overrides` reporting everything as "not in DB, skipping" is normal — most registry entries
in `run-overrides.ts` target other runs. `db:verify`'s "Sample Rows" section is the fastest way to
eyeball that the new config/benchmark_results rows look right (correct model key, precision,
hardware, throughput numbers in a sane range).

## Cleanup

```bash
ssh -p 234 hoanq333@61.28.228.19 "cd /opt/docker-compose && docker compose exec -T app rm -rf /tmp/ingest-<RUN_ID> /tmp/unmapped.json"
```

## Don't forget

- If Step 1 required a code change, that same PR/commit should have updated
  `packages/app/src/lib/api-route-catalog.ts`'s digest for `models.ts` (there's a vitest guard
  that fails the build otherwise — `bun run test:unit` will tell you which digest to recompute:
  `python3 -c "import hashlib; print(hashlib.sha256(open('<file>','rb').read()).hexdigest())"`).
- If the model/GPU should be selectable in the dashboard UI (not just stored), that's a
  **separate, optional** follow-up: `Model`/GPU registry entries in
  `packages/app/src/lib/data-mappings.ts`, `compare-slug.ts`, `compare-ssr.ts` — see
  `docs/adding-entities.md`. Ask the user whether they want that now or the DB write is enough
  for this pass.
