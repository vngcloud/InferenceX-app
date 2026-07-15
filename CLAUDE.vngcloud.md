# VNGCloud / GreenNode self-host for InferenceX-app

Resume doc for future Claude Code sessions. Read this BEFORE making changes — upstream's `CLAUDE.md` describes a Vercel + Neon setup that is NOT what we're running.

## Live state (as of 2026-05-25)

- **Dashboard:** https://inference-benchmark.eveningcafe.org/ (TLS via Let's Encrypt, auto-renew).
- **VM:** `hoanq333@61.28.228.19 -p 234` (Ubuntu 22.04, passwordless sudo, docker 29 pre-installed).
- **Stack:** docker-compose at `/opt/docker-compose/` — `postgres:16-alpine` + `inferencex-app:latest` (built locally) + `nginx:1.27-alpine` + `certbot/certbot:latest`.
- **App source:** github.com/vngcloud/InferenceX-app (fork of SemiAnalysisAI/InferenceX-app).
- **Deploy:** push to vngcloud/InferenceX-app:master → self-hosted runner `dashboard-greennode-00` builds the image + runs `pnpm admin:db:migrate` + recreates containers, via `.github/workflows/deploy.yml`.

## Where this fits among the vngcloud forks

```
vngcloud/InferenceX (forked from SemiAnalysisAI/InferenceX)   ← benchmark runs land here
   └─ feat/h100-1x-greennode  — current dev branch, all our configs live here:
        gptoss-fp4-h100-1x-vllm           (1× H100, gpt-oss-20b FP4)
        gptoss-fp4-h100-2x-vllm           (2× H100, gpt-oss-20b FP4)
        dsr1qwen3-bf16-rtx5090-1x-vllm    (1× RTX 5090, DSR1-Qwen3-8B BF16)
        dsr1qwen3-fp8-rtx5090-1x-vllm     (1× RTX 5090, DSR1-Qwen3-8B FP8)
        gemma4-fp8-h100-2x-vllm-bench     (2× H100, Gemma 4 31B FP8 + MTP)
      agentic-coding scenarios disabled across all configs pending
      issue vngcloud/InferenceX#2 (aiperf trace-replay timeout).
   Three runners online: h100-greennode_00 (1× H100), h100-greennode_01
   (2× H100), rtx5090-greennode_00.

vngcloud/InferenceXRunner (Ansible)                            ← provisions GPU runner hosts
   └─ /home/lap15260/PycharmProjects/InferenceXRunner
   Hardened since 2026-05-22: containerd data-root moved to /mnt,
   pre-job /mnt/runner/_work chown hook, stackops passwordless sudo,
   data-disk auto-mount role, SSH ControlPersist=30m for long migrations.

vngcloud/InferenceX-app (forked from SemiAnalysisAI/InferenceX-app)  ← this dashboard
   └─ Dockerfile + .github/workflows/deploy.yml (added 2026-05-22)
```

## Runbook

### Data ingestion paths

Default path is `.github/workflows/auto-ingest.yml` — cron polls vngcloud/InferenceX every 15 min, picks up successful runs whose `name:` starts with `[ingest]`, skips IDs already in `workflow_runs`, ingests the rest on the dashboard self-hosted runner, then runs `apply-overrides` + `cache:invalidate`.

| Use case                | Command                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| Opt a bench in          | Name its workflow `[ingest] <whatever>` on vngcloud/InferenceX                                             |
| Force-ingest one run    | `gh workflow run auto-ingest.yml -R vngcloud/InferenceX-app -f run_url=<RUN_URL>`                          |
| Manual single run (SSH) | `pnpm admin:db:ingest:run <run-url-or-id> vngcloud/InferenceX --no-ssl`                                    |
| Bulk GCS backfill       | `pnpm admin:db:ingest:gcs` (not used by us — bucket is upstream's)                                         |
| Supplemental JSON       | `pnpm admin:db:ingest:supplemental`                                                                        |
| Migrate schema          | `pnpm admin:db:migrate --yes --no-ssl`                                                                     |
| Apply run overrides     | `pnpm admin:db:apply-overrides --yes --no-ssl`                                                             |
| Verify DB               | `pnpm admin:db:verify`                                                                                     |
| Invalidate cache        | `pnpm admin:cache:invalidate`                                                                              |
| Tail auto-ingest        | `gh run watch -R vngcloud/InferenceX-app` (or `gh run list -R vngcloud/InferenceX-app -w auto-ingest.yml`) |

SSH wrapper for the manual single-run path:

```bash
RUN_URL="https://github.com/vngcloud/InferenceX/actions/runs/<RUN_ID>"
ssh -p 234 hoanq333@61.28.228.19 \
  "docker compose -f /opt/docker-compose/docker-compose.yml exec -T app \
   pnpm admin:db:ingest:run $RUN_URL vngcloud/InferenceX --no-ssl"
```

Env: `INGEST_GITHUB_TOKEN` as a repo secret on vngcloud/InferenceX-app (used by auto-ingest.yml); `GITHUB_TOKEN`, `INVALIDATE_SECRET`, `POSTGRES_PASSWORD` in `/opt/docker-compose/.env` on the VM.

### Deploy code changes

```bash
# Clone with the right SSH alias (default key is eveningcafe, no vngcloud access).
git clone git@github-vngcloud:vngcloud/InferenceX-app.git
cd InferenceX-app
# ... edit, commit ...
git push origin master

gh run watch -R vngcloud/InferenceX-app
```

### Redeploy without a code change (e.g. after `.env` edit)

```bash
gh workflow run deploy.yml -R vngcloud/InferenceX-app
```

### Status / logs / rollback

```bash
ssh -p 234 hoanq333@61.28.228.19 \
  'docker compose -f /opt/docker-compose/docker-compose.yml ps'

ssh -p 234 hoanq333@61.28.228.19 \
  'docker compose -f /opt/docker-compose/docker-compose.yml logs -f app'

# Each deploy keeps an inferencex-app:<7-char-sha> tag for rollback.
ssh -p 234 hoanq333@61.28.228.19 \
  'docker images inferencex-app --format "{{.Tag}}\t{{.CreatedSince}}"'

# Roll back to <sha>:
ssh -p 234 hoanq333@61.28.228.19 \
  'docker tag inferencex-app:<sha> inferencex-app:latest && \
   docker compose -f /opt/docker-compose/docker-compose.yml up -d app'
```

## TLS / renewal

- Initial cert was bootstrapped with `certbot certonly --standalone` (nginx briefly stopped to free :80).
- Renewal config rewritten to webroot mode: `authenticator = webroot`, `webroot_path = /var/www/certbot`. See `/opt/docker-compose/letsencrypt/renewal/inference-benchmark.eveningcafe.org.conf`.
- `inferencex-certbot-1` runs `certbot renew --webroot -w /var/www/certbot --quiet` every 12h. Local no-op until cert is within 30 days of expiry; Let's Encrypt is contacted at most once per renewal cycle (≈ every 60 days).
- **nginx caches the cert in memory** — it needs a reload to pick up renewed files. Any deploy push reloads. Manual: `docker compose exec nginx nginx -s reload`.

## Still TODO

1. **First real ingest — pick a run that's already finished.**
   Run **26273985264** (`smoke-v7`, 2026-05-22) has 3 clean
   gpt-oss-20b single-node successes on 1× H100 (conc 4, 8, 16,
   ISL/OSL 1k1k). Smallest viable dataset; use it for the first
   ingest smoke. Numbers we saw locally: tput/GPU ≈ 4 800 tok/s,
   TPOT median ≈ 6.4 ms, TTFT median ≈ 73 ms.
2. **Bigger ingest target: the Gemma 4 MTP bench.** As of 2026-05-25
   run **26381288205** (`gemma4-mtp-lab-v3`, MTP-only) is producing 6
   single-node + 1 eval row over ~50–60 min. After it finishes,
   `gemma4-fp8-h100-2x-vllm-bench` is staged on the same feat branch
   (commit `b195592`) to dispatch — yields 12 rows (6 MTP + 6 baseline)
   in one wall-clock window for clean apples-to-apples. Once both
   land, ingestion test = the actual MEP-0006 deliverable (does the
   dashboard render the speedup correctly).
3. **Mint `GITHUB_TOKEN`** — currently blank in `.env`. Required for
   artifact downloads during ingest. Fine-grained PAT scoped to
   vngcloud/InferenceX with **Contents:Read + Actions:Read** is enough.
4. **Constants/schema for our new runner types & model prefixes** —
   upstream's `packages/constants/` doesn't know about:
   - GPU keys: **`h100-1x`**, **`h100-2x`**, **`rtx5090-1x`**
   - Model prefixes: **`dsr1qwen3`**, **`gemma4`**
     (`gptoss` already exists for the 120B variant)
     Expect at least some dashboard filters/legends to be blank or
     "unknown" for these rows on first ingest. Add entries to the
     relevant maps after the first ingest exposes which views need them.
5. **Automate ingest** — port upstream's
   `.github/workflows/ingest-results.yml` to vngcloud/InferenceX so
   finished runs auto-ingest into the dashboard. Needs
   `DATABASE_WRITE_URL` + `GITHUB_TOKEN` as secrets on
   vngcloud/InferenceX, and either a reverse proxy or wireguard so
   the ingest workflow can reach the dashboard DB.

## Key paths

- `/opt/docker-compose/docker-compose.yml` — stack definition
- `/opt/docker-compose/.env` — secrets (0600). POSTGRES_PASSWORD, INVALIDATE_SECRET, FEEDBACK_SECRET, GITHUB_TOKEN
- `/opt/docker-compose/nginx/inferencex-app.conf` — :80 HTTP→HTTPS redirect + ACME challenge; :443 TLS proxy → app:3000
- `/opt/docker-compose/letsencrypt/` — cert store (bind-mounted into nginx ro, certbot rw)
- `/opt/docker-compose/certbot-webroot/` — ACME challenge webroot
- `/home/hoanq333/actions-runner/` — GH runner + systemd unit `actions.runner.vngcloud-InferenceX-app.dashboard-greennode-00.service`
- In the fork: `Dockerfile`, `.dockerignore`, `.github/workflows/deploy.yml`

## Auth notes

- Two GitHub accounts on this laptop: `eveningcafe` (default SSH key, NO vngcloud access) and `aistackdev` (gh CLI active account, vngcloud org member).
- For git pushes to vngcloud repos, use the SSH alias `github-vngcloud` (configured in `~/.ssh/config`, identity `~/.ssh/hoanq` = aistackdev).
- `gh` CLI is logged in as aistackdev (active); `gh api`, `gh run`, `gh workflow run` all work as aistackdev.
- VNGCloud security group on the VM opens **only** :22 (custom port 234), :80, :443. If you ever need another inbound port, ask the user to add it in the cloud console.

## User context

- VNGCloud / GreenNode team. Email tytv2@vng.com.vn.
- IaC preference: Ansible for hosts that need recovery (the GPU runners — see InferenceXRunner). Docker-compose for one-off hosts like this dashboard.
- No heavy builds on the laptop. All builds run in CI / on the dashboard VM.

## License compliance (GPL-3.0)

Upstream `LICENSE` is **GPL v3** (verbatim FSF text, no "or later", no AGPL clause). Our current setup is compliant:

- **Forking + modifying**: explicitly allowed (§ "Conveying Modified Source Versions").
- **Running it on our own VM, even with public access**: allowed without source disclosure. GPLv3 is _not_ AGPL — running a web service does **not** count as "conveying" the software to users. We owe nothing to dashboard visitors.
- **Re-publishing the fork on github.com/vngcloud/InferenceX-app**: this _is_ "conveying" and triggers obligations — all of which are satisfied so long as we keep doing what we already do:
  1. Keep the original `LICENSE` file (✅ unchanged).
  2. Keep upstream copyright notices (✅ — nothing stripped).
  3. License the whole modified work under GPLv3 (✅ — no extra LICENSE files added, the fork inherits).
  4. Mark modifications. **Action item:** add a one-liner to the top of `README.md` of the fork stating it is a modified version of `SemiAnalysisAI/InferenceX-app` maintained by VNGCloud, with link upstream. § 5(a). Not currently present — the only visible delta is in `CLAUDE.vngcloud.md`, which technically satisfies the spirit but the README note is the standard form.
  5. Source must be available to anyone receiving the binary. ✅ — the public GitHub fork _is_ the source mirror; Docker images we build aren't redistributed (they only run on our VM), so no §6 written-offer trickiness.

What we **cannot** do under GPLv3:

- Relicense the modified fork (e.g. MIT, proprietary, "internal use only") — combined work stays GPLv3.
- Distribute the docker image to a third party without also offering the corresponding source. Internal use is fine; selling/shipping the image is not, unless they also get the source.
- Add code with an incompatible license (e.g. some "non-commercial" or BSL-style component) into the same build.

Nothing about our laptop SSH alias, deploy workflow, ingest scripts, or docker-compose stack is in tension with GPLv3.

## Ruled out (for context)

- **Vercel + Neon** — user wants self-hosted control, not SaaS dependencies.
- **Co-locating dashboard on the H100 box** — GPU node ≠ web host. Separate concerns.
- **Ansible for the dashboard host** — planned, then dropped: there's only one dashboard, so docker-compose is the right granularity. Ansible still owns the GPU runners (multiple, re-image recovery).
