# syntax=docker/dockerfile:1.7

# Production image for the InferenceX Next.js dashboard.
# Built by .github/workflows/deploy.yml on the self-hosted dashboard runner.
#
# Two stages so the runtime image doesn't carry bun's cache / git / dev deps:
#   builder — installs deps + runs `next build`
#   runtime — copies the workspace (with .next + node_modules) and runs
#             `next start`
#
# The whole bun workspace is shipped to runtime because the constants/db
# packages need to be reachable from the symlinks under
# packages/app/node_modules. Pruning that would save image size but
# complicate the runtime, and the dashboard host has plenty of disk.
#
# Base image tag matches package.json's `packageManager` (bun@1.3.14). Bun
# still does `bun install`, but neither `next build` nor `next start` run
# under Bun — see the `node-src` stage below. Bun's JS engine segfaults
# nondeterministically during Next.js 16.3+'s Turbopack "Collecting page
# data" worker-pool phase (oven-sh/bun#36866), and separately throws at
# *request* time on any route that touches undici's Response/Request/etc.
# (`e.util.markAsUncloneable is not a function` — Bun doesn't actually
# export `node:worker_threads.markAsUncloneable` despite documenting it,
# per oven-sh/bun#29423). Both are consistent with "Bun's Node compat is
# incomplete for what Next.js 16.3+ / undici 8.x now need", not a bug tied
# to one Bun patch version — so both `next build` and `next start` run
# under Node (V8) instead, sidestepping Bun's engine entirely for anything
# Next.js–shaped. `bun install` and the ad-hoc `bun run admin:*` ingest
# scripts are untouched.

FROM node:24-slim AS node-src

FROM oven/bun:1.3.14-slim AS builder

# git is required: the root package.json's `prepare` script runs
# `is-ci || lefthook install`, and lefthook shells out to git. Setting
# CI=true makes is-ci short-circuit so lefthook is skipped, but a few
# transitive deps (cypress, posthog cli) also do git probes during their
# postinstall — cheaper to just have git available.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

ENV CI=true

WORKDIR /app

# Copy lockfile + workspace manifests first so dep install caches when only
# source files change. node_modules layer is invalidated only by a
# lockfile or package.json change.
COPY bun.lock package.json ./
COPY packages/app/package.json     packages/app/
COPY packages/db/package.json      packages/db/
COPY packages/constants/package.json packages/constants/
COPY packages/mcp/package.json      packages/mcp/

RUN bun install --frozen-lockfile

# Now copy the rest of the source and build.
COPY . .

# Node binary only, for the build RUN step below — see the top-of-file note
# on why `next build` runs under Node instead of Bun.
COPY --from=node-src /usr/local/bin/node /usr/local/bin/node

# `next build` evaluates pages at build time, and some (e.g. the
# compare-precision/compare-spec-decode OG images' generateStaticParams)
# actually query Postgres to enumerate static params — a dummy/unreachable
# host makes those pages fail the build outright. The deploy workflow passes
# --network + --secret so this resolves the real (already-running) postgres
# service; secrets are mounted as files, not baked into image layers/history.
# Falls back to a dummy URL when no secret is supplied (e.g. a local
# `docker build .` with no running postgres) — pages needing real data just
# render with zero static params in that case.
RUN --mount=type=secret,id=database_readonly_url \
    --mount=type=secret,id=database_write_url \
    DATABASE_READONLY_URL="$(cat /run/secrets/database_readonly_url 2>/dev/null || echo postgresql://x:x@x:5432/x)" \
    DATABASE_WRITE_URL="$(cat /run/secrets/database_write_url 2>/dev/null || echo postgresql://x:x@x:5432/x)" \
    DATABASE_DRIVER=postgres \
    DATABASE_SSL=false \
    sh -c 'cd packages/app && node node_modules/.bin/next build --turbopack'


FROM oven/bun:1.3.14-slim AS runtime

# gh + unzip are used by `bun run admin:db:ingest:run`, which shells out to
# `gh api` to list & download a workflow run's artifacts and then unzips
# them. gh comes from the official GitHub apt repo; ca-certificates is
# kept around because gh needs it for HTTPS to api.github.com at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg unzip \
    && install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && apt-get purge -y --auto-remove curl gnupg \
    && rm -rf /var/lib/apt/lists/*

# CI=true: any `bun run <script>` invoked in this container (e.g. an admin
# ingest/cache command run via `docker compose exec app bun run admin:...`)
# can trigger the root `prepare` script (`is-ci || lefthook install`). This
# stage has no .git (COPY --from=builder doesn't bring it, and it's
# .dockerignore'd besides), so without CI=true short-circuiting is-ci,
# lefthook fails. The main CMD below no longer goes through `bun run`, but
# ad-hoc bun scripts still do.
ENV CI=true

WORKDIR /app
COPY --from=builder /app ./

# Node binary only, to run `next start` — see the top-of-file note on why.
COPY --from=node-src /usr/local/bin/node /usr/local/bin/node

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "cd packages/app && node node_modules/.bin/next start"]
