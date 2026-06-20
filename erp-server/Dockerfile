# Node image for the Evertrust ERP API (erp-api service on the Mac mini).
#
# Strategy (deliberately simple/robust, NOT production-minimal):
#   - copy the WHOLE monorepo,
#   - install with the frozen lockfile (this rebuilds native modules like argon2
#     for linux inside the image),
#   - pre-build the NestJS API so `dist/main.js` is baked into the image.
#
# The workspace deps @evertrust/db and @evertrust/shared are compiled to JS
# (package.json `main` -> dist/index.js). The build step below uses pnpm's
# "...": "@evertrust/api..." builds the API AND its workspace deps in dependency
# order, so plain `node dist/main.js` can require them with no runtime loader.
#
# Build context = repo root (see docker-compose: build.context: ..).
FROM node:24-bookworm-slim

# Toolchain needed to compile native addons (argon2) during pnpm install.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# pnpm is provided via corepack (version pinned by package.json#packageManager).
RUN corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Non-interactive build: never prompt to purge a modules dir (no TTY in BuildKit).
ENV CI=true

WORKDIR /app

# Copy the entire monorepo. (M0: no fine-grained layer caching of the lockfile;
# correctness and reproducibility over build-time optimization.)
COPY . .

# Install all workspace deps with the committed lockfile. argon2 is rebuilt for
# linux here, which is exactly what we want (the host build was for macOS).
RUN corepack pnpm install --frozen-lockfile

# Pre-compile the workspace deps (@evertrust/db, @evertrust/shared) and then the
# NestJS API to dist/. The "..." suffix pulls in the API's workspace dependencies
# and builds them first. The migrate service uses drizzle-kit/tsx against src
# directly and does not need this output, but baking it keeps a single image.
RUN corepack pnpm --filter "@evertrust/api..." build

# Default command is a no-op; each service overrides `command` in compose.
CMD ["node", "--version"]
