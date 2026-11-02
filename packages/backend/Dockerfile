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
# Same Debian release as the runtime, so the builder and the runtime agree on
# libc.
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

# Fail the build rather than ship an image that cannot start: importing the
# root module resolves every runtime import, so a dependency that `pnpm deploy`
# left behind shows up here instead of at the customer. It runs in this stage
# because the runtime image has no shell for a RUN step.
RUN node --input-type=module -e "await import('/out/dist/app.module.js')"


############################################################################################################
### Build the distributable image ###
# Distroless: Node, CA certificates and little else, with no shell and no
# package manager. It carries far fewer OS packages than node:24-trixie-slim,
# whose unfixed Debian findings fail image scanners that do not ignore them.
# The tag is left floating on purpose: Google rebuilds it as Debian publishes
# fixes, so a release picks those up without a Dockerfile change.
FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runtime

ARG APP_VERSION=unknown
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.title="ontology-workbench-backend" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.source="https://github.com/nize/ontology-workbench" \
      org.opencontainers.image.licenses="Apache-2.0"

# Runs as the base image's non-root user 65532. Group-0 ownership keeps the app
# readable when a platform (OpenShift) assigns an arbitrary UID instead.
WORKDIR /app
COPY --from=builder --chown=65532:0 /out/package.json ./package.json
COPY --from=builder --chown=65532:0 /out/node_modules ./node_modules
COPY --from=builder --chown=65532:0 /out/dist ./dist
# The Oxigraph demo fixtures (packages/backend/fixtures) are deliberately not
# shipped: production uses the customer's GraphDB. For an Oxigraph demo, mount
# Turtle files and name them in PRELOAD_TURTLE_FILES.

USER 65532

ENV NODE_ENV=production \
    BACKEND_SPARQL_DRIVER=graphdb

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:4000/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# The base image's entrypoint is node itself. Node runs as PID 1, so SIGTERM
# reaches the app only through the handlers enableShutdownHooks() registers in
# main.ts.
CMD ["dist/main.js"]
