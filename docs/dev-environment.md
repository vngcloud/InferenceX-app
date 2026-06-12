# Dev Environment

> **TL;DR**
>
> - **Push to `dev`** → `deploy-dev.yml` builds and deploys an isolated stack to **`http://61.28.228.19:8080`**. Prod (`master` → `:80`/`:443`) is never touched: separate image, separate DB.
> - **8080 isn't open externally yet** — add an inbound TCP 8080 rule in the GreenNode console, or tunnel: `ssh -p 234 -L 8080:127.0.0.1:8080 hoanq333@61.28.228.19` then open `http://localhost:8080`.
> - **No data?** A fresh dev DB is empty. Populate it: `gh workflow run dev-ingest.yml -R vngcloud/InferenceX-app --ref master -f run_url=<benchmark-run-url>`.

A second, fully isolated copy of the dashboard that lives next to prod on the
same self-hosted runner (`dashboard-greennode-00`, `61.28.228.19`). Use it to
preview `dev`-branch code against a throwaway database without touching prod.

|                   | Prod                                                | Dev                                              |
| ----------------- | --------------------------------------------------- | ------------------------------------------------ |
| Branch            | `master`                                            | `dev`                                            |
| Deploy workflow   | `.github/workflows/deploy.yml`                      | `.github/workflows/deploy-dev.yml`               |
| Ingest workflow   | `.github/workflows/auto-ingest.yml` (cron + manual) | `.github/workflows/dev-ingest.yml` (manual only) |
| Compose project   | `inferencex`                                        | `inferencex-dev`                                 |
| Server dir        | `/opt/docker-compose/`                              | `/opt/docker-compose-dev/`                       |
| App image         | `inferencex-app:latest`                             | `inferencex-app-dev:latest`                      |
| Postgres volume   | `inferencex_postgres-data`                          | `inferencex-dev_postgres-data` (brand-new DB)    |
| DB role / name    | `inferencex` / `inferencex`                         | `inferencex_dev` / `inferencex_dev`              |
| Public access     | nginx + TLS on `:80` / `:443`                       | direct on **`:8080`** (no nginx/TLS)             |
| Concurrency group | `deploy` / `auto-ingest`                            | `deploy-dev` / `dev-ingest`                      |

The two stacks share nothing but the host and the runner. A dev build tags a
separate image, so it can never leak into the prod container; a dev deploy
brings up a separate postgres volume, so prod data is never read or written.

---

## 1. Deploy: push to `dev` → it goes live on `:8080`

```
git push origin dev        # (or merge a PR into dev)
        │
        ▼
deploy-dev.yml fires (trigger: push to dev)
        │  runs on the self-hosted dashboard runner
        ▼
build inferencex-app-dev:latest
  → start dev postgres, wait healthy
  → run DB migrations (fresh schema on first deploy)
  → sync INGEST_GITHUB_TOKEN into /opt/docker-compose-dev/.env
  → docker compose up -d   (project inferencex-dev)
  → smoke-test http://127.0.0.1:8080
        │
        ▼
dev app live → http://61.28.228.19:8080
```

Redeploy without a code change from the Actions tab (**Run workflow** →
`deploy-dev`) or:

```bash
gh workflow run deploy-dev.yml -R vngcloud/InferenceX-app --ref dev
```

---

## 2. Ingest: populate the dev DB with benchmark data

A fresh dev deploy has the schema but **no benchmark rows** — charts show
"No data available" until you ingest. `dev-ingest.yml` is the dev sibling of
prod's `auto-ingest.yml`: it scans `vngcloud/InferenceX` for successful runs
whose workflow name starts with `[ingest]`, ingests any not already in the dev
DB, applies run overrides, and invalidates the dev cache.

**It is manual-dispatch only.** GitHub fires `workflow_dispatch` and `schedule`
triggers _only from the default branch_ (`master`), so always dispatch with
`--ref master`.

```bash
# Scan + ingest everything new into the dev DB:
gh workflow run dev-ingest.yml -R vngcloud/InferenceX-app --ref master

# Force-ingest one specific run (skips the scan + [ingest] prefix filter):
gh workflow run dev-ingest.yml -R vngcloud/InferenceX-app --ref master \
  -f run_url=https://github.com/vngcloud/InferenceX/actions/runs/<id>

# Watch it:
gh run list -R vngcloud/InferenceX-app --workflow=dev-ingest.yml --limit 5
```

Or from the Actions tab: **dev-ingest** → **Run workflow** → branch `master`
(optionally paste a run URL).

> Current source runs are named `e2e Test - …`, not `[ingest] …`, so the
> auto-scan finds nothing — use the `run_url` input to seed data for now.

> **Want dev to auto-feed like prod?** Because cron only runs on the default
> branch, add a scheduled copy of this workflow on `master` that points
> `COMPOSE_FILE` at `/opt/docker-compose-dev` and `PG_USER`/`PG_DB` at
> `inferencex_dev`.
