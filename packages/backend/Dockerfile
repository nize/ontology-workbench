#################################################################################################################
### Production runtime image — ontology-workbench backend ###
#
# Built from the repository root (the pnpm workspace):
#   podman build --format docker -f packages/backend/Dockerfile -t ontology-backend .
#
# `--format docker` keeps the HEALTHCHECK below; Podman's default OCI format
# drops it. Quadlet units set HealthCmd themselves, so this only matters for a
# plain `podman run`.
#
# The image talks to a graph store it does not own. In customer environments
# that is the GraphDB they already run (BACKEND_SPARQL_DRIVER=graphdb, the
# default), so nothing in here persists data and no volume is required.
#################################################################################################################

### Build the NestJS application ###
# Same Debian family as the runtime, so the builder and the runtime agree on
# libc and an air-gapped build needs one base image, not two.
FROM node:24-trixie-slim AS builder

WORKDIR /app

# Pinned build toolchain: the version package.json declares in packageManager.
# A floating pnpm means two builds of the same commit can resolve differently.
RUN npm install -g pnpm@9.0.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend

# --frozen-lockfile installs exactly what pnpm-lock.yaml records, so the
# dependency scan of this repository is a statement about this image.
RUN pnpm install --frozen-lockfile

RUN pnpm --filter @acme/shared build \
 && pnpm --filter @acme/backend build

# `pnpm deploy --prod` produces a self-contained directory: the backend's
# package.json, its dist/ (per its "files" field) and a node_modules with only
# production dependencies — @acme/shared included as a real copy rather than a
# workspace symlink. Nothing else from the workspace reaches the runtime stage.
RUN pnpm --filter @acme/backend deploy --prod /out


############################################################################################################
### Build the distributable image ###
FROM node:24-trixie-slim AS runtime

# `apt-get upgrade` because the base image freezes its Debian packages at the
# time it was built; installing named packages does not move the others, so a
# base package with a published security fix would otherwise stay behind.
#   tini            → PID 1: forwards SIGTERM so `podman stop` shuts down cleanly
#   ca-certificates → TLS to the customer's GraphDB / identity provider
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    tini \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Nothing runs a package manager at runtime, so npm, corepack and yarn are removed
# rather than patched: their bundled dependency trees are where an image
# scanner finds most fixable Node findings.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm \
           /usr/local/bin/npx \
           /usr/local/bin/corepack \
           /usr/local/bin/yarn \
           /usr/local/bin/yarnpkg \
           /opt/yarn-*

ARG APP_VERSION=unknown
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.title="ontology-workbench-backend" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.source="https://github.com/nize/ontology-workbench" \
      org.opencontainers.image.licenses="Apache-2.0"

# Fixed non-root UID with group 0. Rootless Podman maps UID 10001 into the
# user's subuid range; group-0 ownership keeps the app readable when a platform
# (OpenShift) runs it under an arbitrary UID instead.
RUN useradd -r -u 10001 -g 0 -d /app -s /usr/sbin/nologin workbench

WORKDIR /app
COPY --from=builder --chown=10001:0 /out/package.json ./package.json
COPY --from=builder --chown=10001:0 /out/node_modules ./node_modules
COPY --from=builder --chown=10001:0 /out/dist ./dist
# The Oxigraph demo fixtures (packages/backend/fixtures) are deliberately not
# shipped: production uses the customer's GraphDB. For an Oxigraph demo, mount
# Turtle files and name them in PRELOAD_TURTLE_FILES.

USER 10001

ENV NODE_ENV=production \
    BACKEND_SPARQL_DRIVER=graphdb

# Fail the build rather than ship an image that cannot start: importing the
# root module resolves every runtime import, so a dependency that `pnpm deploy`
# left behind shows up here instead of at the customer.
RUN node --input-type=module -e "await import('/app/dist/app.module.js')"

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
