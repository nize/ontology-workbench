#################################################################################################################
### Production runtime image — ontology-workbench frontend ###
#
# Built from the repository root (the pnpm workspace):
#   podman build --format docker -f packages/frontend/Dockerfile -t ontology-frontend .
#
# The browser only talks to this container. Requests under /api are proxied to
# the backend at BACKEND_URL (read at runtime, default http://localhost:4000),
# so the backend needs no published port.
#
# BASE_PATH (runtime, default empty = served from /) moves the whole app below a
# prefix such as /ow. The app is built with a placeholder base path that
# docker/start.mjs replaces when the container starts; see base-path.js.
#################################################################################################################

### Build the Next.js application ###
FROM node:24-trixie-slim AS builder

WORKDIR /app

# Pinned build toolchain: the version package.json declares in packageManager.
RUN npm install -g pnpm@9.0.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared ./packages/shared
COPY packages/frontend ./packages/frontend

RUN pnpm install --frozen-lockfile

# NEXT_PUBLIC_API_BASE is left unset on purpose: the client then calls the
# same-origin /api proxy, and the backend location stays a runtime setting.
# The placeholder base path must match PLACEHOLDER in base-path.js.
ENV NEXT_TELEMETRY_DISABLED=1 \
    BASE_PATH=/__OW_BASE_PATH__
RUN pnpm --filter @acme/shared build \
 && pnpm --filter ./packages/frontend build

# The standalone output mirrors the workspace layout: server.js lands in
# packages/frontend/ next to a traced node_modules. Static assets are not part
# of the trace and are copied in beside it, where server.js serves them from.
RUN cp -r packages/frontend/.next/static packages/frontend/.next/standalone/packages/frontend/.next/static

# The launcher that applies BASE_PATH at start, beside the app it starts.
RUN cp packages/frontend/docker/start.mjs packages/frontend/base-path.js packages/frontend/.next/standalone/

# Fail the build rather than ship an image missing its entry point or assets,
# or one the launcher cannot relocate.
RUN test -f packages/frontend/.next/standalone/packages/frontend/server.js \
 && test -d packages/frontend/.next/standalone/packages/frontend/.next/static \
 && grep -q '/__OW_BASE_PATH__' packages/frontend/.next/standalone/packages/frontend/server.js


############################################################################################################
### Build the distributable image ###
# Distroless, for the reasons given in packages/backend/Dockerfile.
FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runtime

ARG APP_VERSION=unknown
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.title="ontology-workbench-frontend" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.source="https://github.com/nize/ontology-workbench" \
      org.opencontainers.image.licenses="Apache-2.0"

WORKDIR /app
COPY --from=builder --chown=65532:0 /app/packages/frontend/.next/standalone ./

USER 65532

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    BACKEND_URL=http://localhost:4000 \
    BASE_PATH=""

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000'+(process.env.BASE_PATH||'/')).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# The base image's entrypoint is node itself. start.mjs prepares the app under
# BASE_PATH and starts Next's standalone server in the same process, which
# handles SIGTERM directly as PID 1.
CMD ["start.mjs"]
