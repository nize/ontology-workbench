#!/usr/bin/env bash
set -euo pipefail

# Checks that a frontend image serves correctly from / and under a BASE_PATH.
#
# The image relocates Next's build output at container start (see
# packages/frontend/docker/start.mjs), which depends on how Next lays out that
# output. A Next.js upgrade can change it without any test in the repository
# noticing, so this runs against the built image before it is published.
#
# Usage:
#   scripts/test-frontend-base-path.sh <image-ref>
#
# Needs docker and curl. No backend is required: the page and its assets are
# served by the frontend alone.

image="${1:?usage: $0 <image-ref>}"
port=13990
name="ow-base-path-test-$$"
failures=0

log() { printf '\n==> %s\n' "$*"; }
check() {
  local label="$1"; shift
  if "$@"; then
    printf '    PASS  %s\n' "$label"
  else
    printf '    FAIL  %s\n' "$label"
    failures=$((failures + 1))
  fi
}
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

status() { curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port}$1"; }

# Starts the image read-only, as deployments are expected to run it, with the
# writable /tmp that Podman provides by default.
start() {
  cleanup
  docker run -d --name "$name" --read-only --tmpfs /tmp -p "127.0.0.1:${port}:3000" \
    -e BASE_PATH="$1" "$image" >/dev/null
  for _ in $(seq 1 30); do
    [[ "$(status "${2}")" == 200 ]] && return 0
    sleep 1
  done
  docker logs "$name" >&2 || true
  return 1
}

# Every asset the page references must sit under the prefix and load.
assets_load() {
  local prefix="$1" html refs ref
  html="$(curl -s "http://127.0.0.1:${port}${prefix:-/}")"
  grep -q '__OW_BASE_PATH__' <<<"$html" && { echo "      placeholder left in page" >&2; return 1; }
  refs="$(grep -oE '"(/[A-Za-z0-9._~/-]*)?/_next/static/[^"]+\.(js|css)"' <<<"$html" | tr -d '"' | sort -u)"
  [[ -n "$refs" ]] || { echo "      page references no assets" >&2; return 1; }
  for ref in $refs; do
    [[ "$ref" == "${prefix}/_next/"* ]] || { echo "      asset outside prefix: $ref" >&2; return 1; }
    [[ "$(status "$ref")" == 200 ]] || { echo "      asset not served: $ref" >&2; return 1; }
  done
}

log "BASE_PATH unset: served from /"
check "container starts" start "" /
check "/ returns 200" test "$(status /)" == 200
check "assets load from /_next" assets_load ""

log "BASE_PATH=/ow"
check "container starts" start /ow /ow
check "/ow returns 200" test "$(status /ow)" == 200
check "/ is not served" test "$(status /)" == 404
check "assets load from /ow/_next" assets_load /ow
check "API proxy is under /ow" test "$(status /ow/api/healthz)" == 502

log "BASE_PATH invalid"
cleanup
docker run -d --name "$name" --read-only --tmpfs /tmp -e BASE_PATH=ow/ "$image" >/dev/null
sleep 3
check "container refuses to start" test "$(docker inspect -f '{{.State.Running}}' "$name")" == false

if (( failures > 0 )); then
  printf '\nbase path test: %d check(s) failed for %s\n' "$failures" "$image" >&2
  exit 1
fi
printf '\nbase path test: PASS for %s\n' "$image"
