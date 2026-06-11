# Node image for the Evertrust ERP API (erp-api service on the Mac mini).
#
# Strategy (deliberately simple/robust, NOT production-minimal):
#   - copy the WHOLE monorepo,
#   - install with the frozen lockfile (this rebuilds native modules like argon2
#     for linux inside the image),
#   - pre-build the NestJS API so `dist/main.js` is baked into the image.
#
# The workspace deps @evertrust/db and @evertrust/shared ship raw TS source
# (their package.json `main` points at src/index.ts). Plain `node dist/main.js`
# therefore cannot require them. We run the API under the `tsx` loader at
# runtime (see docker-compose `api.command`), which transpiles those TS packages
# on the fly. This is the endorsed "runtime-transpile is fine for M0" approach.
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

# Pre-compile the NestJS API to dist/. The api service then runs this dist under
# the tsx loader; the migrate service uses drizzle-kit/tsx directly and does not
# need this output, but baking it keeps a single shared image.
RUN corepack pnpm --filter @evertrust/api build

# Default command is a no-op; each service overrides `command` in compose.
CMD ["node", "--version"]
