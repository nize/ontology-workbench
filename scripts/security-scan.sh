#!/usr/bin/env bash
set -euo pipefail

# The single definition of "is this artifact publishable" for ontology-workbench.
#
# Every publication path calls this script and none carries scan logic of its
# own — .github/workflows/release.yml today, and the same command locally
# before cutting a tag. A policy written into each of them separately would be
# several policies that agree only by inspection.
#
# Two passes run over every target:
#
#   report  every severity, exit 0, written under .security/reports/. This is
#           the evidence a customer's security review asks for.
#   gate    GATE_SEVERITY with --ignore-unfixed, exit 1. The verdict.
#
# Failing only on findings with an available fix is deliberate: the Debian base
# image carries high-severity CVEs with no fixed package at essentially all
# times, and a gate that blocked on those would be switched off within a week.
#
# Usage:
#   scripts/security-scan.sh deps
#   scripts/security-scan.sh image <image-ref>...
#   scripts/security-scan.sh secrets
#   scripts/security-scan.sh all [<image-ref>...]
#
# Exit codes: 0 publishable · 1 gate failure · 2 the scan could not be run.

# --- policy ---------------------------------------------------------------
#
#   warn   every pass runs and the verdict is printed; the caller continues.
#   block  a failing gate pass stops the caller before anything is pushed.
#
# A committed constant, not an environment variable: a gate that an
# undocumented variable can switch off is not a gate. Changing it is a commit
# and shows up in review.
#
# Only the vulnerability passes participate in the verdict. Credential passes
# are reported loudly and never block: a working-tree hit is often a local,
# gitignored .env that never reaches an image, and a history hit cannot be
# cleared by any release — it is a rotation request.
GATE_MODE=block

# UNKNOWN is included because Trivy assigns it to advisories nobody has rated
# yet — a statement about the advisory's age, not its impact. A CRITICAL,HIGH
# filter silently drops fixable findings in that state.
GATE_SEVERITY=CRITICAL,HIGH,MEDIUM,UNKNOWN

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
report_dir="${repo_root}/.security/reports"

# Scanners run from the repository root with `.` as the target: both tools
# derive finding identifiers from the target path, and absolute-path
# fingerprints could never be matched by an ignore file.
cd "$repo_root"

die() { printf 'security-scan: %s\n' "$*" >&2; exit 2; }
log() { printf '\n==> %s\n' "$*"; }

# A missing scanner fails the run. Skipping on a workstation without one is
# exactly how a green result stops meaning anything.
require() {
  command -v "$1" >/dev/null || die "$1 is not installed.
  This gate does not fall back to publishing unscanned. Install it and re-run:
    macOS   brew install $1
    Linux   see https://trivy.dev/latest/getting-started/installation/ (trivy)
            or  https://github.com/gitleaks/gitleaks#installing    (gitleaks)"
}

blocking_failures=0
reported_failures=0

# Runs one gate pass and records the verdict. `vuln` counts toward the
# publication verdict, `secrets` is reported only.
gate() {
  local class="$1" label="$2"; shift 2
  if "$@"; then
    printf '    gate: PASS (%s)\n' "$label"
    return
  fi
  case "$class" in
    vuln)    blocking_failures=$((blocking_failures + 1))
             printf '    gate: FAIL (%s)  [blocking]\n' "$label" ;;
    secrets) reported_failures=$((reported_failures + 1))
             printf '    gate: FAIL (%s)  [reported, non-blocking]\n' "$label" ;;
    *)       die "unknown gate class: $class" ;;
  esac
}

trivy_common=(--scanners vuln --ignorefile "${repo_root}/.trivyignore")

scan_deps() {
  require trivy
  log "Dependency tree (pnpm-lock.yaml)"
  # The lockfile covers every workspace package, development dependencies
  # included. The image passes see only what ships; this pass sees what the
  # build ran, which a compromised build tool would abuse.
  trivy fs "${trivy_common[@]}" --exit-code 0 \
    --format table --output "${report_dir}/deps.txt" .
  trivy fs "${trivy_common[@]}" --exit-code 0 \
    --format json --output "${report_dir}/deps.json" .
  gate vuln "deps" trivy fs "${trivy_common[@]}" \
    --severity "$GATE_SEVERITY" --ignore-unfixed --exit-code 1 --quiet .
}

scan_image() {
  local image="$1" slug
  [[ -n "$image" ]] || die "image scan needs an image reference"
  require trivy
  # One report pair per image: ontology-backend:v1 → image-ontology-backend.json
  slug="$(basename "${image%%[:@]*}")"
  log "Container image ${image}"
  # Being unable to scan is not the same as being clean, so a scanner that
  # cannot read the image ends the run rather than reaching the verdict.
  trivy image "${trivy_common[@]}" --exit-code 0 \
    --format table --output "${report_dir}/image-${slug}.txt" "$image" \
    || die "trivy could not scan ${image}. Build or pull it first, and check
  registry credentials if it lives in a private registry."
  trivy image "${trivy_common[@]}" --exit-code 0 \
    --format json --output "${report_dir}/image-${slug}.json" "$image"
  gate vuln "image:${slug}" trivy image "${trivy_common[@]}" \
    --severity "$GATE_SEVERITY" --ignore-unfixed --exit-code 1 --quiet "$image"
}

# A gitleaks JSON report holds `[]` when the scan found nothing.
report_is_clean() {
  local report="$1"
  [[ -s "$report" ]] || return 0
  ! grep -q '"RuleID"' "$report"
}

scan_secrets() {
  require gitleaks
  log "Credential material (working tree, then reachable history)"
  # History as well as the working tree: deleting a line does not un-disclose a
  # value that was pushed. A history detection is a rotation request.
  #
  # Last run's reports go first — they live under .security/ inside the tree
  # being scanned, and gitleaks would otherwise rediscover what they recorded.
  rm -f "${report_dir}/secrets-worktree.json" "${report_dir}/secrets-history.json"
  gitleaks dir . --no-banner --exit-code 0 --log-level error \
    --report-format json --report-path "${report_dir}/secrets-worktree.json"
  gitleaks git . --no-banner --exit-code 0 --log-level error \
    --report-format json --report-path "${report_dir}/secrets-history.json"
  gate secrets "secrets:worktree" report_is_clean "${report_dir}/secrets-worktree.json"
  gate secrets "secrets:history"  report_is_clean "${report_dir}/secrets-history.json"
}

mkdir -p "$report_dir"

command="${1:-all}"
[[ $# -gt 0 ]] && shift
case "$command" in
  deps)    scan_deps ;;
  image)   [[ $# -gt 0 ]] || die "image scan needs an image reference"
           for image in "$@"; do scan_image "$image"; done ;;
  secrets) scan_secrets ;;
  all)
    scan_deps
    scan_secrets
    for image in "$@"; do scan_image "$image"; done
    ;;
  -h|--help) sed -n '3,27p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) die "unrecognised command: $command (expected deps, image, secrets or all)" ;;
esac

log "Reports written to ${report_dir}"

if (( reported_failures > 0 )); then
  printf '\nsecurity-scan: %d credential pass(es) failed — reported, not blocking.\n' \
    "$reported_failures" >&2
  printf 'Read %s/secrets-*.json. A detection in reachable history is a\n' "$report_dir" >&2
  printf 'rotation request, not an edit request; a detection in the working tree\n' >&2
  printf 'may be a local, untracked file that never reaches the artifact.\n' >&2
fi

if (( blocking_failures == 0 )); then
  printf 'security-scan: PASS — no fixable %s findings\n' "$GATE_SEVERITY"
  exit 0
fi

printf '\nsecurity-scan: %d vulnerability gate pass(es) failed.\n' "$blocking_failures" >&2
printf 'Read the reports in %s, fix the finding, or record a bounded\n' "$report_dir" >&2
printf 'exception in .trivyignore with a reason, an approver and an expiry.\n' >&2

if [[ "$GATE_MODE" == "block" ]]; then
  printf 'GATE_MODE=block — refusing to publish.\n' >&2
  exit 1
fi

printf 'GATE_MODE=warn — publication continues.\n' >&2
exit 0
