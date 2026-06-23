#!/usr/bin/env bash
#
# Phase proof-of-work for the "real-npm-publish-on-main" phase — the
# maintainer-facing, end-to-end demonstration that the gated publish job is
# reachable ONLY when the release-decision module returns ALLOW on `main`, and
# that on that path it performs a REAL publish whose freshly published CLI a user
# can run via `npx`.
#
# Earlier in the phase this harness modeled the publish with `npm publish
# --dry-run` (nothing ever shipped). The `real-npm-publish` slice flips the
# workflow to a REAL provenance publish, so this proof can perform a REAL
# `npm publish` against a STAGED local registry (verdaccio) — which the phase
# proof-of-work explicitly permits ("real (or staged-registry) publish"). It
# exercises the genuine publish + install + bin-resolution codepaths end to end
# without ever touching the public registry, and tears the staged registry down
# so the proof is side-effect-free.
#
# TWO TIERS, so this script runs EVERYWHERE:
#   - ALWAYS (offline): the FORCED-signal gate cases. Using release-gate.js over
#     forced branch + GATE_* signals and the version guard's deterministic
#     `PUBLISHED_VERSIONS` override, it proves the publish path is reached ONLY on
#     ALLOW + a new version, is a green idempotent SKIP for an already-published
#     version, and is NOT reached on a red gate or a non-main ref. No network, no
#     registry — runs in any environment and is the script's exit-0 baseline.
#   - GATED (staged registry): the REAL staged publish + `npx` proof. Runs only
#     when verdaccio is feasible (CI set, RUN_REGISTRY_E2E=1, or verdaccio on
#     PATH). It stands up verdaccio, performs a REAL `npm publish` to it, runs
#     `npx ratchet-ai --version` against it (asserting the PUBLISHED `ratchet`
#     CLI executes and prints the published version), then re-runs the version
#     guard pointed at the staged registry and asserts the just-published version
#     is now seen as already-published (should_publish=false, green SKIP, exit 0),
#     then tears verdaccio down. When NOT feasible, it prints a clear SKIP line
#     and the script still exits 0 on the offline tier alone.
#
# It composes the already-shipped, unit-tested runners over FORCED branch +
# GATE_* signals — it adds NO new decision logic:
#   - release-gate.js  : reads GITHUB_REF_NAME + GATE_* -> ALLOW/DENY and writes
#                        `release_allowed=true|false` to GITHUB_OUTPUT (the value
#                        the `ci` job lifts into `needs.ci.outputs.release_allowed`).
#   - version-guard.js : sources the already-published set from the `PUBLISHED_VERSIONS`
#                        override (offline tier) or the REAL registry query
#                        (`npm view ratchet-ai versions`) pointed at the staged
#                        registry (gated tier), and writes `should_publish=true|false`,
#                        ALWAYS exiting 0.
#
# The publish path passes TWO fail-closed gates in series, both modeled here:
#   - the RELEASE gate (release-gate.js): governs whether the `publish` job runs
#     at all (`needs.ci.outputs.release_allowed == 'true'`); fail-CLOSED off main
#     or on any red gate.
#   - the VERSION guard (version-guard.js): governs whether that job actually
#     publishes (`steps.<guard>.outputs.should_publish == 'true'`); fail-SAFE
#     toward a green SKIP for an already-published version.
#
# Branch + GATE_* signals are FORCED via environment so gating stays
# deterministic. Timeouts wrap every network/registry operation so a hung
# registry can never blow a 10-minute budget.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

RELEASE_GATE_JS="dist/core/ci/release-gate.js"
VERSION_GUARD_JS="dist/core/ci/version-guard.js"
PACKAGE_NAME="ratchet-ai"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "FAIL: $*"; exit 1; }

FAILED=0
# check <name> <true|false>: log a per-check line and track overall pass/fail.
check() {
  if [ "$2" = true ]; then
    echo "  ok: $1"
  else
    echo "  FAIL: $1"
    FAILED=1
  fi
}

# run_with_timeout <seconds> <cmd...>: run a command under a timeout if a timeout
# utility is available; otherwise run it directly (best effort). Keeps a hung
# registry/install from blowing the budget where `timeout` exists.
TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then TIMEOUT_BIN="timeout";
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_BIN="gtimeout"; fi
run_with_timeout() {
  local secs="$1"; shift
  if [ -n "$TIMEOUT_BIN" ]; then "$TIMEOUT_BIN" "$secs" "$@"; else "$@"; fi
}

# read_output <github_output_file> <key>: echo the last `key=value` the runner
# appended, or empty — exactly what GitHub Actions exposes as the step output.
read_output() {
  local file="$1" key="$2"
  [ -f "$file" ] || { echo ""; return; }
  grep "^$key=" "$file" | tail -n1 | cut -d= -f2
}

# publish_gate_satisfied <release_allowed>: model the publish job's gate
# `if: needs.ci.outputs.release_allowed == 'true'` — true ONLY on `true`.
publish_gate_satisfied() { [ "$1" = "true" ]; }

# release_decision <branch> <prefix> [GATE_* ...]: run release-gate.js and echo
# the `release_allowed` value it wrote (the `ci` job's job-level signal). Does
# NOT publish — the publish decision is modeled by the caller across both gates.
release_decision() {
  local branch="$1" prefix="$2"; shift 2
  local out="$prefix.rel.github_output"
  : > "$out"
  env GITHUB_REF_NAME="$branch" GITHUB_OUTPUT="$out" "$@" \
      node "$RELEASE_GATE_JS" >"$prefix.rel.out" 2>&1 || true
  read_output "$out" release_allowed
}

# --- Build so the dist/ runners are runnable. ---------------------------------
echo "Building the package (pnpm build)..."
if command -v pnpm >/dev/null 2>&1; then
  pnpm build >/dev/null 2>&1 || fail "pnpm build failed"
else
  node build.js >/dev/null 2>&1 || fail "node build.js failed"
fi
[ -f "$RELEASE_GATE_JS" ] || fail "$RELEASE_GATE_JS missing after build"
[ -f "$VERSION_GUARD_JS" ] || fail "$VERSION_GUARD_JS missing after build"

PKG_VERSION="$(node -p "require('./package.json').version")"
[ -n "$PKG_VERSION" ] || fail "could not read package version"
echo "Local package: $PACKAGE_NAME@$PKG_VERSION"

# ============================================================================
# OFFLINE TIER — forced-signal gate cases. Always runs; no registry needed.
# Uses the deterministic PUBLISHED_VERSIONS override for the version guard.
# ============================================================================

# version_decision_forced <prefix> <published-csv>: run version-guard.js with the
# deterministic PUBLISHED_VERSIONS override (offline). Echoes "<should_publish>|<exit>".
version_decision_forced() {
  local prefix="$1" published="$2"
  local out="$prefix.guard.github_output"
  : > "$out"
  local rc
  set +e
  env GITHUB_OUTPUT="$out" PUBLISHED_VERSIONS="$published" \
      node "$VERSION_GUARD_JS" >"$prefix.guard.out" 2>&1
  rc=$?
  set -e
  echo "$(read_output "$out" should_publish)|$rc"
}

# --- Case (b): forced red wired gate on main -> release_allowed=false. --------
echo
echo "Case (b): forced red test gate on main -> expect release_allowed=false, publish path not reached"
deny_allowed="$(release_decision main "$WORK/deny-gate" \
  GATE_LINT=green GATE_TEST=red GATE_COVERAGE=green GATE_E2E=green GATE_SECURITY=green)"
check "release-gate writes release_allowed=false on a red wired gate" \
  "$([ "$deny_allowed" = false ] && echo true || echo false)"
check "the publish job gate is NOT satisfied on a red gate (publish path not reached)" \
  "$(publish_gate_satisfied "$deny_allowed" && echo false || echo true)"

# --- Case (c): non-main ref -> release_allowed=false. ------------------------
echo
echo "Case (c): non-main ref with all gates green -> expect release_allowed=false, publish path not reached"
nonmain_allowed="$(release_decision feature/widget "$WORK/deny-branch" \
  GATE_LINT=green GATE_TEST=green GATE_COVERAGE=green GATE_E2E=green GATE_SECURITY=green)"
check "release-gate writes release_allowed=false off main" \
  "$([ "$nonmain_allowed" = false ] && echo true || echo false)"
check "the publish job gate is NOT satisfied off main (publish path not reached)" \
  "$(publish_gate_satisfied "$nonmain_allowed" && echo false || echo true)"

# --- Case (a): all-green main + NEW version -> ALLOW + should_publish=true. ---
echo
echo "Case (a): all gates green on main + NEW version -> expect release_allowed=true AND should_publish=true (publish path reached)"
allow_allowed="$(release_decision main "$WORK/allow" \
  GATE_LINT=green GATE_TEST=green GATE_COVERAGE=green GATE_E2E=green GATE_SECURITY=green)"
check "release-gate writes release_allowed=true on all-green main" \
  "$([ "$allow_allowed" = true ] && echo true || echo false)"
check "the publish job gate is satisfied on ALLOW" \
  "$(publish_gate_satisfied "$allow_allowed" && echo true || echo false)"

# A published set that does NOT contain the local version -> should_publish=true.
new_forced="$(version_decision_forced "$WORK/new" "0.0.0-absent.0")"
new_should="${new_forced%%|*}"; new_rc="${new_forced##*|}"
check "version guard reports should_publish=true for a new version (forced set)" \
  "$([ "$new_should" = true ] && echo true || echo false)"
check "the version guard exits 0 on PUBLISH" \
  "$([ "$new_rc" -eq 0 ] && echo true || echo false)"
check "BOTH gates satisfied on ALLOW + new version -> the publish path IS reached" \
  "$([ "$allow_allowed" = true ] && [ "$new_should" = true ] && echo true || echo false)"

# --- Case (e-offline): already-published version -> green idempotent SKIP. ----
echo
echo "Case (e): already-published version -> expect should_publish=false (green SKIP), guard exit 0"
old_forced="$(version_decision_forced "$WORK/old" "$PKG_VERSION")"
old_should="${old_forced%%|*}"; old_rc="${old_forced##*|}"
check "version guard reports should_publish=false when the version is already published (forced set)" \
  "$([ "$old_should" = false ] && echo true || echo false)"
check "the version guard STILL exits 0 on SKIP (idempotent re-run does not error)" \
  "$([ "$old_rc" -eq 0 ] && echo true || echo false)"

# ============================================================================
# GATED TIER — real staged-registry publish + npx proof.
# Runs only when verdaccio is feasible. Otherwise SKIP cleanly (exit 0).
# ============================================================================
echo
registry_e2e_enabled() {
  [ "${CI:-}" != "" ] && return 0
  [ "${RUN_REGISTRY_E2E:-}" = "1" ] && return 0
  command -v verdaccio >/dev/null 2>&1 && return 0
  return 1
}

if ! registry_e2e_enabled; then
  echo "SKIP: staged-registry publish proof (verdaccio not enabled locally)"
  echo "      (set RUN_REGISTRY_E2E=1, run under CI, or install verdaccio to enable it)"
else
  echo "=== Staged-registry publish proof (verdaccio enabled) ==="

  # --- Stand up a STAGED local registry (verdaccio). -------------------------
  # A custom config allows anonymous publish, serves `ratchet-ai` from local
  # storage ONLY (no uplink, so the version query is deterministic), and proxies
  # npmjs for every other package so `npx` can resolve runtime dependencies.
  echo "Standing up a staged local registry (verdaccio)..."
  VERDACCIO_BIN="$(command -v verdaccio 2>/dev/null || true)"
  if [ -z "$VERDACCIO_BIN" ]; then
    VERDACCIO_BIN="$(run_with_timeout 180 npx -y --package verdaccio@6 -c 'command -v verdaccio' 2>/dev/null || true)"
  fi
  [ -n "$VERDACCIO_BIN" ] && [ -x "$VERDACCIO_BIN" ] || fail "could not provision verdaccio (network required for the staged-publish proof)"

  # Pick a free ephemeral port to avoid collisions with anything already bound.
  # Use process.stdout.write (not console.log) so a colorizing env (FORCE_COLOR)
  # cannot wrap the number in ANSI escapes — verdaccio's --listen would reject it.
  PORT="$(node -e 'const s=require("net").createServer();s.listen(0,()=>{const p=s.address().port;s.close(()=>process.stdout.write(String(p)))})')"
  [ -n "$PORT" ] || fail "could not allocate a port for the staged registry"
  REG="http://localhost:$PORT/"

  cat > "$WORK/verdaccio.yaml" <<EOF
storage: $WORK/storage
auth:
  htpasswd:
    file: $WORK/htpasswd
    max_users: -1
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
packages:
  '$PACKAGE_NAME':
    access: \$all
    publish: \$anonymous \$authenticated
    unpublish: \$anonymous \$authenticated
  '**':
    access: \$all
    publish: \$all
    proxy: npmjs
log: { type: stdout, format: pretty, level: warn }
EOF

  # A throwaway userconfig with a dummy token (anonymous publish is allowed for
  # our package) so the npm client is willing to publish to the staged registry.
  NPMRC="$WORK/.npmrc"
  {
    echo "//localhost:$PORT/:_authToken=staged-registry-anonymous-token"
    echo "registry=$REG"
  } > "$NPMRC"

  # verdaccio's `--listen` rejects a bare port; pass the accepted host:port form.
  "$VERDACCIO_BIN" --config "$WORK/verdaccio.yaml" --listen "localhost:$PORT" >"$WORK/verdaccio.log" 2>&1 &
  VERDACCIO_PID=$!

  # Tear the staged registry down (and clean scratch) no matter how we exit — the
  # proof must be side-effect-free against real npm.
  trap 'kill "$VERDACCIO_PID" 2>/dev/null; rm -rf "$WORK"' EXIT

  # Wait for readiness (bounded — a hung registry must not blow the budget).
  ready=0
  for _ in $(seq 1 60); do
    if curl -sS -m 2 -o /dev/null "$REG-/ping" 2>/dev/null; then ready=1; break; fi
    sleep 1
  done
  [ "$ready" = 1 ] || { echo "--- verdaccio log ---"; cat "$WORK/verdaccio.log"; fail "staged registry did not become ready"; }
  echo "Staged registry ready at $REG"

  # staged_has_package: 0 (true) when the staged registry serves $PACKAGE_NAME.
  staged_has_package() {
    run_with_timeout 60 npm view "$PACKAGE_NAME" version --registry "$REG" --userconfig "$NPMRC" >/dev/null 2>&1
  }

  # version_decision_staged <prefix>: run version-guard.js with its REAL registry
  # source pointed at the staged registry (no PUBLISHED_VERSIONS override).
  # Echoes "<should_publish>|<exit_code>".
  version_decision_staged() {
    local prefix="$1"
    local out="$prefix.guard.github_output"
    : > "$out"
    local rc
    set +e
    run_with_timeout 90 env GITHUB_OUTPUT="$out" npm_config_registry="$REG" npm_config_userconfig="$NPMRC" \
        node "$VERSION_GUARD_JS" >"$prefix.guard.out" 2>&1
    rc=$?
    set -e
    echo "$(read_output "$out" should_publish)|$rc"
  }

  echo
  echo "Staged case: nothing uploaded before the publish (red-gate/non-main proof against a real registry)"
  check "nothing is on the staged registry before any publish" \
    "$(staged_has_package && echo false || echo true)"

  # The version guard's REAL registry source 404s for the not-yet-published
  # package -> empty set -> should_publish=true. Exercises the genuine
  # E404->PUBLISH branch through the real seam.
  staged_new="$(version_decision_staged "$WORK/staged-new")"
  staged_new_should="${staged_new%%|*}"; staged_new_rc="${staged_new##*|}"
  check "version guard reports should_publish=true for a brand-new version (real E404 -> empty set)" \
    "$([ "$staged_new_should" = true ] && echo true || echo false)"
  check "the version guard exits 0 on PUBLISH (real registry)" \
    "$([ "$staged_new_rc" -eq 0 ] && echo true || echo false)"

  # Both gates satisfied: perform the REAL publish to the staged registry, exactly
  # as the workflow would (minus --provenance, which needs the live Actions OIDC
  # issuer). Use the DYNAMIC dist-tag the workflow computes, so a prerelease lands
  # on its channel (e.g. `beta`) and not on `latest` — the same resolver the
  # workflow's publish step uses.
  DIST_TAG="$(node dist/core/ci/dist-tag.js)"
  [ -n "$DIST_TAG" ] || fail "could not resolve a dist-tag for $PKG_VERSION"
  echo "Resolved dist-tag for $PKG_VERSION: $DIST_TAG"
  published=false
  if publish_gate_satisfied "$allow_allowed" && [ "$staged_new_should" = true ]; then
    if run_with_timeout 120 npm publish --tag "$DIST_TAG" --registry "$REG" --userconfig "$NPMRC" >"$WORK/publish.log" 2>&1; then
      published=true
    else
      echo "--- publish log ---"; tail -20 "$WORK/publish.log"
    fi
  fi
  check "the REAL staged publish succeeded when both gates are satisfied" "$published"
  check "the package is now present on the staged registry (it was really uploaded)" \
    "$(staged_has_package && echo true || echo false)"

  # npx the PUBLISHED package from a CLEAN directory (no local repo fallback) so it
  # genuinely installs from the staged registry and resolves the `ratchet` bin.
  echo "Running 'npx ratchet-ai --version' against the staged registry (clean dir, real install)..."
  CONSUMER="$WORK/consumer"; mkdir -p "$CONSUMER"
  npx_out=""
  npx_rc=1
  if [ "$published" = true ]; then
    set +e
    npx_out="$(cd "$CONSUMER" && \
      run_with_timeout 240 env npm_config_registry="$REG" npm_config_userconfig="$NPMRC" npm_config_cache="$WORK/npmcache" \
        npx -y "$PACKAGE_NAME" --version 2>"$WORK/npx.err")"
    npx_rc=$?
    set -e
  fi
  check "npx executed the published CLI (exit 0)" \
    "$([ "$npx_rc" -eq 0 ] && echo true || echo false)"
  check "npx ratchet-ai --version printed the published version ($PKG_VERSION)" \
    "$(printf '%s' "$npx_out" | grep -qF "$PKG_VERSION" && echo true || echo false)"
  [ "$npx_rc" -eq 0 ] || { echo "--- npx stderr ---"; tail -20 "$WORK/npx.err"; }

  # Re-run the version guard against the staged registry. The just-published
  # version is now SEEN as already-published -> should_publish=false -> the
  # publish step is NOT reached, yet the guard STILL exits 0 (idempotent).
  echo
  echo "Staged case (e): re-run the guard against the staged registry -> expect should_publish=false (green SKIP), guard exit 0"
  staged_old="$(version_decision_staged "$WORK/staged-old")"
  staged_old_should="${staged_old%%|*}"; staged_old_rc="${staged_old##*|}"
  check "version guard reports should_publish=false for the already-published version (real registry SKIP)" \
    "$([ "$staged_old_should" = false ] && echo true || echo false)"
  check "the version guard STILL exits 0 on SKIP against the real registry (idempotent)" \
    "$([ "$staged_old_rc" -eq 0 ] && echo true || echo false)"
fi

# ============================================================================
echo
if [ "$FAILED" -eq 0 ]; then
  echo "PASS: the gated publish job is reachable ONLY when the release-decision"
  echo "      module returns ALLOW on main; a red gate or a non-main ref keeps"
  echo "      release_allowed=false and the publish path is not reached. On the"
  echo "      ALLOW + new-version path the publish is reached, an already-published"
  echo "      version is a green idempotent SKIP, and (when verdaccio is enabled) a"
  echo "      NEW version is REALLY published to a staged registry where"
  echo "      'npx ratchet-ai --version' runs the published CLI and a re-run is a"
  echo "      green SKIP. Any staged registry is torn down, so the proof never"
  echo "      touches public npm."
  exit 0
fi
echo "FAIL: one or more real-npm-publish proof checks failed (see output above)"
exit 1
