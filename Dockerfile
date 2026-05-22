# Production image for the InferenceX Next.js dashboard.
# Built by .github/workflows/deploy.yml on the self-hosted dashboard runner.
#
# Two stages so the runtime image doesn't carry pnpm's store / git / dev deps:
#   builder — installs deps + runs `pnpm build`
#   runtime — copies the workspace (with .next + node_modules) and runs
#             `pnpm start`
#
# The whole pnpm workspace is shipped to runtime because `pnpm start` is
# `pnpm --filter *app start`, which needs the lockfile and the
# constants/db packages reachable from the symlinks under
# packages/app/node_modules. Pruning that would save image size but
# complicate the runtime, and the dashboard host has plenty of disk.

FROM node:24-bookworm-slim AS builder

# git is required: the root package.json's `prepare` script runs
# `is-ci || lefthook install`, and lefthook shells out to git. Setting
# CI=true makes is-ci short-circuit so lefthook is skipped, but a few
# transitive deps (cypress, posthog cli) also do git probes during their
# postinstall — cheaper to just have git available.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

ENV CI=true

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy lockfile + workspace manifests first so dep install caches when only
# source files change. node_modules layer is invalidated only by a
# lockfile or package.json change.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/app/package.json     packages/app/
COPY packages/db/package.json      packages/db/
COPY packages/constants/package.json packages/constants/

RUN pnpm install --frozen-lockfile

# Now copy the rest of the source and build.
COPY . .

# `next build` evaluates pages that may read env at build time. Pass dummy
# Postgres URLs so the build doesn't crash on missing env. Runtime URLs
# come from compose's environment block.
RUN DATABASE_READONLY_URL=postgresql://x:x@x:5432/x \
    DATABASE_WRITE_URL=postgresql://x:x@x:5432/x \
    DATABASE_DRIVER=postgres \
    DATABASE_SSL=false \
    pnpm build


FROM node:24-bookworm-slim AS runtime

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY --from=builder /app ./

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000
CMD ["pnpm", "start"]
