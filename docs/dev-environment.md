# Dev Environment

A second, fully isolated copy of the dashboard that lives **next to prod on the
same self-hosted runner** (`dashboard-greennode-00`, `61.28.228.19`). Use it to
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
**separate** image, so it can never leak into the prod container; a dev deploy
brings up a **separate** postgres volume, so prod data is never read or written.

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

You can also redeploy without a code change from the Actions tab
(**Run workflow** → `deploy-dev`) or:

```bash
gh workflow run deploy-dev.yml -R vngcloud/InferenceX-app --ref dev
```

### Where to look

- **GitHub Actions run** (build/deploy logs, per-step status):
  https://github.com/vngcloud/InferenceX-app/actions/workflows/deploy-dev.yml
  ```bash
  gh run list  -R vngcloud/InferenceX-app --workflow=deploy-dev.yml --limit 5
  gh run watch <run-id> -R vngcloud/InferenceX-app   # live, --exit-status for CI
  gh run view  <run-id> -R vngcloud/InferenceX-app --log-failed
  ```
- **The dev app**: `http://61.28.228.19:8080` (see firewall note below).
- **On the box** (SSH `hoanq333@61.28.228.19 -p 234`):
  ```bash
  cd /opt/docker-compose-dev
  docker compose ps                 # status of dev postgres + app
  docker compose logs -f app        # tail dev app logs
  docker compose restart app        # restart without rebuild
  ```

> **Firewall / security group.** Port 8080 is published on the host, but the
> GreenNode cloud security group only allows inbound `80`/`443`/`234`. Until you
> add an inbound **TCP 8080** rule in the GreenNode console, reach dev via an SSH
> tunnel instead:
>
> ```bash
> ssh -p 234 -L 8080:127.0.0.1:8080 hoanq333@61.28.228.19
> # then open http://localhost:8080
> ```

---

## 2. Ingest: populate the dev DB with benchmark data

A fresh dev deploy has the schema but **no benchmark rows** — charts will show
"No data available" until you ingest. `dev-ingest.yml` is the dev sibling of
prod's `auto-ingest.yml`: it scans `vngcloud/InferenceX` for successful runs
whose workflow name starts with `[ingest]`, ingests any not already in the dev
DB, applies run overrides, and invalidates the dev cache.

**It is manual-dispatch only.** GitHub fires `schedule` (cron) triggers _only on
the default branch_ (`master`), so a cron living on `dev` would never run — and
dev data is a populate-on-demand thing anyway.

```bash
# Scan + ingest everything new into the dev DB:
gh workflow run dev-ingest.yml -R vngcloud/InferenceX-app --ref dev

# Force-ingest one specific run (skips the scan + [ingest] prefix filter):
gh workflow run dev-ingest.yml -R vngcloud/InferenceX-app --ref dev \
  -f run_url=https://github.com/vngcloud/InferenceX/actions/runs/<id>

# Watch it:
gh run list -R vngcloud/InferenceX-app --workflow=dev-ingest.yml --limit 5
```

Or from the Actions tab: **dev-ingest** → **Run workflow** → branch `dev`
(optionally paste a run URL).

> **Want dev to auto-feed like prod?** Because cron only runs on the default
> branch, add a scheduled copy of this workflow on `master` that points
> `COMPOSE_FILE` at `/opt/docker-compose-dev` and `PG_USER`/`PG_DB` at
> `inferencex_dev`. Keep it on a distinct concurrency group so it doesn't
> serialize against the prod cron more than necessary (both still share the one
> runner).

---

## Isolation guarantees (what keeps prod safe)

- **Separate image tag** — `deploy-dev` only ever tags `inferencex-app-dev:*`;
  prod recreates from `inferencex-app:latest`, which dev never writes.
- **Separate volume** — `inferencex-dev_postgres-data` ≠ `inferencex_postgres-data`.
  Dev ingest writes only to the `inferencex_dev` database.
- **Separate compose project** — container names are `inferencex-dev-*`, so
  `docker compose up`/`down` in one dir can't recreate the other's containers.
- **Separate concurrency groups** — a dev push/ingest never cancels a prod
  deploy/ingest. They still serialize on the single runner (one job at a time),
  which is expected.
- **`docker image prune -f`** in `deploy-dev` removes only _dangling_ (untagged)
  layers; prod's tagged images and rollback tags are kept.

The server-side compose file and `.env` for dev live at `/opt/docker-compose-dev/`
and are **not committed** (secrets), mirroring the prod convention in
`/opt/docker-compose/`. The dev `.env` has its own random `POSTGRES_PASSWORD`,
`INVALIDATE_SECRET`, and `FEEDBACK_SECRET`; `deploy-dev` syncs `INGEST_GITHUB_TOKEN`
into it on every deploy.
