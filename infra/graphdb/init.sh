#!/bin/sh
# Creates the "acme" GraphDB repository and loads the backend fixtures.
# Idempotent: does nothing if the repository already exists, unless --reset is given.
#
# Usage: infra/graphdb/init.sh [--reset]
#
# Env:
#   GRAPHDB_URL       GraphDB base URL (default http://localhost:7200)
#   GRAPHDB_REPO      Repository id; must match acme-repo.ttl (default acme)
#   FIXTURES_DIR      Directory with the .ttl fixtures (default packages/backend/fixtures)
#   GRAPHDB_FIXTURES  Space-separated fixture files to load
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
GRAPHDB_URL=${GRAPHDB_URL:-http://localhost:7200}
GRAPHDB_REPO=${GRAPHDB_REPO:-acme}
FIXTURES_DIR=${FIXTURES_DIR:-$SCRIPT_DIR/../../packages/backend/fixtures}
GRAPHDB_FIXTURES=${GRAPHDB_FIXTURES:-schema.ttl sample-data.ttl acme-sample.ttl}
REPO_CONFIG=$SCRIPT_DIR/acme-repo.ttl

RESET=false
[ "${1:-}" = "--reset" ] && RESET=true

log() { echo "[graphdb-init] $*"; }

log "Waiting for GraphDB at $GRAPHDB_URL ..."
i=0
until curl -sf "$GRAPHDB_URL/rest/info/version" >/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    log "GraphDB did not become ready in time" >&2
    exit 1
  fi
  sleep 2
done

# GraphDB 11 rejects all queries and writes without a license, even the Free edition.
if ! curl -sf "$GRAPHDB_URL/rest/graphdb-settings/license" | grep -q '"valid":true'; then
  log "GraphDB has no valid license. Put your (free) license at infra/graphdb/license/graphdb.license" >&2
  log "and restart GraphDB. Get one at https://www.ontotext.com/products/graphdb/" >&2
  exit 1
fi

status=$(curl -s -o /dev/null -w '%{http_code}' "$GRAPHDB_URL/rest/repositories/$GRAPHDB_REPO")
if [ "$status" = "200" ]; then
  if [ "$RESET" = false ]; then
    log "Repository '$GRAPHDB_REPO' already exists; skipping (use --reset to recreate)"
    exit 0
  fi
  log "Deleting repository '$GRAPHDB_REPO'"
  curl -sf -X DELETE "$GRAPHDB_URL/rest/repositories/$GRAPHDB_REPO" >/dev/null
fi

log "Creating repository '$GRAPHDB_REPO'"
curl -sf -X POST "$GRAPHDB_URL/rest/repositories" -F "config=@$REPO_CONFIG" >/dev/null

for file in $GRAPHDB_FIXTURES; do
  log "Loading $file"
  curl -sf -X POST -H 'Content-Type: text/turtle' \
    --data-binary "@$FIXTURES_DIR/$file" \
    "$GRAPHDB_URL/repositories/$GRAPHDB_REPO/statements" >/dev/null
done

log "Done: $(curl -sf "$GRAPHDB_URL/repositories/$GRAPHDB_REPO/size") statements in '$GRAPHDB_REPO'"
