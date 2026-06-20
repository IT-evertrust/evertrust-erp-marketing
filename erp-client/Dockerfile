# Next.js (erp-client) production image — multi-stage, standalone output.
#
# Build context = repo root (see docker-compose: web.build.context: ..,
# dockerfile: erp-client/Dockerfile) because the build needs the whole pnpm
# workspace (lockfile + @evertrust/shared source, which transpilePackages pulls
# in).
#
# NEXT_PUBLIC_API_URL is INLINED into the client bundle at build time, so it must
# be supplied as a build arg, not just a runtime env var.

# ---- deps + build ----------------------------------------------------------
FROM node:24-bookworm-slim AS builder

RUN corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Non-interactive build: never prompt to purge a modules dir (no TTY in BuildKit).
ENV CI=true

WORKDIR /app

# Whole monorepo (workspace install needs every package's manifest + sources).
COPY . .

RUN corepack pnpm install --frozen-lockfile

# Public env baked into the bundle. Default matches local M0 (api on :3001).
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_TELEMETRY_DISABLED=1

# "@evertrust/web..." builds the web app's workspace deps (@evertrust/shared)
# before the Next build, so its compiled dist/ is resolvable.
RUN corepack pnpm --filter "@evertrust/web..." build

# erp-client has no public/ dir in the repo; ensure one exists so the runner's
# COPY of it always has a source (Next serves it as the static asset root).
RUN mkdir -p /app/erp-client/public

# ---- runner ----------------------------------------------------------------
FROM node:24-bookworm-slim AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# curl is used by the compose healthcheck.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

WORKDIR /app

# Standalone output is rooted at the repo top (outputFileTracingRoot), so the
# server entrypoint is at erp-client/server.js and hoisted deps sit at
# ./node_modules — copy the whole tree to preserve that layout.
COPY --from=builder --chown=nextjs:nodejs /app/erp-client/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/erp-client/.next/static ./erp-client/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/erp-client/public ./erp-client/public

USER nextjs

EXPOSE 3000

# Next's standalone server entrypoint for this app.
CMD ["node", "erp-client/server.js"]
