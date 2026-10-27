#################################################################################################################
### Production runtime image — ontology-workbench frontend ###
#
# Built from the repository root (the pnpm workspace):
#   podman build --format docker -f packages/frontend/Dockerfile -t ontology-frontend .
#
# The browser only talks to this container. Requests under /api are proxied to
# the backend at BACKEND_URL (read at runtime, default http://localhost:4000),
# so the backend needs no published port and the image needs no rebuild per
# environment.
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
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @acme/shared build \
 && pnpm --filter ./packages/frontend build

# The standalone output mirrors the workspace layout: server.js lands in
# packages/frontend/ next to a traced node_modules. Static assets are not part
# of the trace and are copied in beside it, where server.js serves them from.
RUN cp -r packages/frontend/.next/static packages/frontend/.next/standalone/packages/frontend/.next/static


############################################################################################################
### Build the distributable image ###
FROM node:24-trixie-slim AS runtime

#   tini            → PID 1: forwards SIGTERM so `podman stop` shuts down cleanly
#   ca-certificates → TLS to a backend or identity provider behind HTTPS
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    tini \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# No package manager runs at runtime; see packages/backend/Dockerfile.
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
LABEL org.opencontainers.image.title="ontology-workbench-frontend" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.source="https://github.com/nize/ontology-workbench" \
      org.opencontainers.image.licenses="Apache-2.0"

RUN useradd -r -u 10001 -g 0 -d /app -s /usr/sbin/nologin workbench

WORKDIR /app
COPY --from=builder --chown=10001:0 /app/packages/frontend/.next/standalone ./
# Next writes its fetch/image cache under .next/cache at runtime. Group-0
# writable so the directory still works when a platform assigns a random UID.
RUN mkdir -p packages/frontend/.next/cache && chmod -R g=u packages/frontend/.next

USER 10001

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    BACKEND_URL=http://localhost:4000

# Fail the build rather than ship an image missing its entry point or assets.
RUN test -f packages/frontend/server.js && test -d packages/frontend/.next/static

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "packages/frontend/server.js"]
