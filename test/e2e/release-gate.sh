#!/usr/bin/env bash
#
# Phase proof-of-work for the "coverage + e2e gates" phase — the maintainer-facing,
# end-to-end demonstration that missing coverage or broken end-to-end behavior now
# BLOCKS the release.
#
# It composes the already-shipped, unit-tested runners over real/forced inputs —
# it adds NO new decision logic:
#   - coverage-gate.js  : reads a coverage json-summary + threshold -> green/red
#   - e2e-gate.js        : reads the cli-smoke result -> green/red
#   - release-gate.js    : reads GITHUB_REF_NAME + GATE_* signals -> ALLOW/DENY
#                          (exit 0 / non-zero), the "only when green" spine
#
# Modeled exactly like the CI release path: each gate runner's exit decides its
# GATE_* signal (green on exit 0, fail-closed red otherwise); those signals plus
# the branch drive release-gate.js; ONLY on ALLOW is the `npm publish --dry-run`
# path reached. Nothing is ever published — the publish stays `--dry-run`.
#
# Three asserted cases:
#   (a) ALLOW  — on `main`, a green cli-smoke + an above-threshold coverage summary
#                keep every wired gate green, so the release gate ALLOWs and the
#                dry-run publish path is exercised.
#   (b) DENY   — a forced below-threshold coverage total makes the coverage gate
#                red, flipping the release gate to DENY; the publish path is NOT
#                reached.
#   (c) DENY   — a forced failing e2e result makes the e2e gate red, flipping the
#                release gate to DENY; the publish path is NOT reached.
#
# Inputs are FORCED by pointing the runners at scratch fixtures (a below-threshold
# coverage summary, a {ok:false} e2e result) rather than by sabotaging real source,
# so the harness is deterministic and side-effect-free. Mirrors the conventions of
# the other test/e2e/*.sh smokes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

COVERAGE_GATE_JS="dist/core/ci/coverage-gate.js"
E2E_GATE_JS="dist/core/ci/e2e-gate.js"
RELEASE_GATE_JS="dist/core/ci/release-gate.js"

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

# --- Build so dist/ runners + bin/ratchet.js are runnable. ---------------------
echo "Building the package (pnpm build)..."
if command -v pnpm >/dev/null 2>&1; then
  pnpm build >/dev/null 2>&1 || fail "pnpm build failed"
else
  node build.js >/dev/null 2>&1 || fail "node build.js failed"
fi
[ -f "$COVERAGE_GATE_JS" ] || fail "$COVERAGE_GATE_JS missing after build"
[ -f "$E2E_GATE_JS" ] || fail "$E2E_GATE_JS missing after build"
[ -f "$RELEASE_GATE_JS" ] || fail "$RELEASE_GATE_JS missing after build"

# gate_signal <runner.js> [env assignments...]: run a gate runner with the given
# environment and echo `green` (exit 0) or `red` (any non-zero) — exactly the
# green/red mapping the CI workflow derives from each gate step's outcome.
gate_signal() {
  local runner="$1"; shift
  if env "$@" node "$runner" >/dev/null 2>&1; then
    echo green
  else
    echo red
  fi
}

# release_path <coverage_signal> <e2e_signal> <out_prefix>: model the CI release
# path. Drive release-gate.js on `main` with lint/test green (the spine is green
# for this proof) and the supplied coverage/e2e signals; capture ALLOW/DENY +
# exit code. ONLY on ALLOW (exit 0) is the dry-run publish path reached, recorded
# by writing "<out_prefix>.published". Echoes the release-gate exit code.
release_path() {
  local cov="$1" e2e="$2" prefix="$3"
  local rc
  set +e
  env GITHUB_REF_NAME=main GATE_LINT=green GATE_TEST=green \
      GATE_COVERAGE="$cov" GATE_E2E="$e2e" \
      node "$RELEASE_GATE_JS" >"$prefix.out" 2>&1
  rc=$?
  set -e
  if [ $rc -eq 0 ]; then
    # ALLOW: the publish path is reached. Exercise the dry-run publish exactly as
    # CI does — it packs locally and stops short of uploading (no token, no real
    # release). Its own outcome is not what this change proves, so it is tolerated;
    # the marker records that the GATE permitted the path.
    npm publish --dry-run >"$prefix.publish.log" 2>&1 || true
    : > "$prefix.published"
  fi
  echo "$rc"
}

# ============================================================================
# Case (a): all-green main -> ALLOW, dry-run publish path exercised.
# ============================================================================
echo
echo "Case (a): all gates green on main -> expect ALLOW + dry-run publish reached"

# Drive the BUILT CLI end to end the way a user would; it writes the real e2e
# result to test/e2e/.results/cli-smoke.json (the e2e gate's default input).
echo "  driving the built CLI via cli-smoke.sh..."
bash test/e2e/cli-smoke.sh >"$WORK/cli-smoke.log" 2>&1 \
  || fail "cli-smoke.sh did not pass — cannot prove the green ALLOW case"

# A real, above-threshold coverage summary (the green coverage input).
printf '{"total":{"lines":{"pct":95}}}\n' > "$WORK/coverage-green.json"

cov_green="$(gate_signal "$COVERAGE_GATE_JS" "COVERAGE_SUMMARY=$WORK/coverage-green.json")"
e2e_green="$(gate_signal "$E2E_GATE_JS")"
check "coverage gate is green on an above-threshold summary" \
  "$([ "$cov_green" = green ] && echo true || echo false)"
check "e2e gate is green after a passing cli-smoke run" \
  "$([ "$e2e_green" = green ] && echo true || echo false)"

allow_rc="$(release_path "$cov_green" "$e2e_green" "$WORK/allow")"
check "release gate ALLOWs (exit 0) when all four gates are green on main" \
  "$([ "$allow_rc" -eq 0 ] && echo true || echo false)"
check "release gate prints ALLOW" \
  "$(grep -q 'ALLOW' "$WORK/allow.out" && echo true || echo false)"
check "the dry-run publish path is exercised on ALLOW" \
  "$([ -f "$WORK/allow.published" ] && echo true || echo false)"

# ============================================================================
# Case (b): forced below-threshold coverage -> coverage gate red -> DENY.
# ============================================================================
echo
echo "Case (b): forced below-threshold coverage -> expect coverage red + DENY, no publish"

# A below-threshold coverage summary (forced regression — no real source touched).
printf '{"total":{"lines":{"pct":12}}}\n' > "$WORK/coverage-low.json"

cov_low="$(gate_signal "$COVERAGE_GATE_JS" "COVERAGE_SUMMARY=$WORK/coverage-low.json")"
check "coverage gate goes red on a below-threshold total" \
  "$([ "$cov_low" = red ] && echo true || echo false)"

deny_cov_rc="$(release_path "$cov_low" "$e2e_green" "$WORK/deny-cov")"
check "release gate DENIES (non-zero) when coverage is red" \
  "$([ "$deny_cov_rc" -ne 0 ] && echo true || echo false)"
check "release gate prints DENY and names the coverage gate" \
  "$(grep -q 'DENY' "$WORK/deny-cov.out" && grep -q 'coverage' "$WORK/deny-cov.out" && echo true || echo false)"
check "the dry-run publish path is NOT reached on a coverage DENY" \
  "$([ ! -f "$WORK/deny-cov.published" ] && echo true || echo false)"

# ============================================================================
# Case (c): forced failing e2e result -> e2e gate red -> DENY.
# ============================================================================
echo
echo "Case (c): forced failing e2e result -> expect e2e red + DENY, no publish"

# A forced failing e2e result (a check failed and overall ok=false).
printf '{"ok":false,"checks":[{"name":"version","passed":false}]}\n' > "$WORK/e2e-fail.json"

e2e_red="$(gate_signal "$E2E_GATE_JS" "E2E_RESULT=$WORK/e2e-fail.json")"
check "e2e gate goes red on a failing smoke result" \
  "$([ "$e2e_red" = red ] && echo true || echo false)"

deny_e2e_rc="$(release_path "$cov_green" "$e2e_red" "$WORK/deny-e2e")"
check "release gate DENIES (non-zero) when e2e is red" \
  "$([ "$deny_e2e_rc" -ne 0 ] && echo true || echo false)"
check "release gate prints DENY and names the e2e gate" \
  "$(grep -q 'DENY' "$WORK/deny-e2e.out" && grep -q 'e2e' "$WORK/deny-e2e.out" && echo true || echo false)"
check "the dry-run publish path is NOT reached on an e2e DENY" \
  "$([ ! -f "$WORK/deny-e2e.published" ] && echo true || echo false)"

# ============================================================================
echo
if [ "$FAILED" -eq 0 ]; then
  echo "PASS: the release gate stays ALLOW (dry-run) on all-green and flips to DENY"
  echo "      when coverage drops below threshold or e2e fails."
  exit 0
fi
echo "FAIL: one or more release-gate proof checks failed (see output above)"
exit 1
