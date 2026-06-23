#!/usr/bin/env bash
#
# Phase proof-of-work for the "security-layer-gate" phase — the maintainer-facing,
# end-to-end demonstration that a known vulnerability or a leaked secret now BLOCKS
# the release.
#
# It composes the already-shipped, unit-tested runners over forced fixture inputs —
# it adds NO new decision logic:
#   - dependency-audit-gate.js : reads an audit JSON report -> green/red
#   - secret-scan-gate.js      : reads a secret-scan JSON report -> green/red
#   - release-gate.js          : reads GITHUB_REF_NAME + GATE_* signals -> ALLOW/DENY
#                                (exit 0 / non-zero), the "only when green" spine
#
# Modeled exactly like the CI release path: each security runner's exit decides its
# signal (green on exit 0, fail-closed red otherwise); the two signals are FOLDED
# into a single GATE_SECURITY (green only when BOTH succeeded, red otherwise) — the
# same fold the workflow's release-gate step performs. That signal plus the branch
# and the other gates drive release-gate.js; ONLY on ALLOW is the
# `npm publish --dry-run` path reached. Nothing is ever published.
#
# Three asserted cases:
#   (a) ALLOW  — on `main`, a clean audit report (zero vulnerabilities) + a clean
#                secret-scan report (zero findings) keep both security signals
#                green, so GATE_SECURITY is green, every wired gate is green, the
#                release gate ALLOWs and the dry-run publish path is exercised.
#   (b) DENY   — a forced high/critical audit count makes the audit gate red ->
#                GATE_SECURITY red -> the release gate DENIES; publish NOT reached.
#   (c) DENY   — a forced secret-scan finding makes the secret-scan gate red ->
#                GATE_SECURITY red -> the release gate DENIES; publish NOT reached.
#
# Inputs are FORCED by pointing the runners at scratch fixtures (AUDIT_REPORT /
# SECRET_SCAN_REPORT) rather than by sabotaging real source, so the harness is
# deterministic and side-effect-free. Mirrors the conventions of the other
# test/e2e/*.sh smokes (model: test/e2e/release-gate.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

AUDIT_GATE_JS="dist/core/ci/dependency-audit-gate.js"
SECRET_GATE_JS="dist/core/ci/secret-scan-gate.js"
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

# --- Build so dist/ runners are runnable. -------------------------------------
echo "Building the package (pnpm build)..."
if command -v pnpm >/dev/null 2>&1; then
  pnpm build >/dev/null 2>&1 || fail "pnpm build failed"
else
  node build.js >/dev/null 2>&1 || fail "node build.js failed"
fi
[ -f "$AUDIT_GATE_JS" ] || fail "$AUDIT_GATE_JS missing after build"
[ -f "$SECRET_GATE_JS" ] || fail "$SECRET_GATE_JS missing after build"
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

# fold_security <audit_signal> <secret_signal>: fold the two security signals into
# a single GATE_SECURITY exactly as the workflow does — green only when BOTH are
# green, fail-closed red otherwise.
fold_security() {
  if [ "$1" = green ] && [ "$2" = green ]; then echo green; else echo red; fi
}

# release_path <security_signal> <out_prefix>: model the CI release path. Drive
# release-gate.js on `main` with lint/test/coverage/e2e green (the rest of the
# spine is green for this proof) and the supplied combined security signal;
# capture ALLOW/DENY + exit code. ONLY on ALLOW (exit 0) is the dry-run publish
# path reached, recorded by writing "<out_prefix>.published". Echoes the
# release-gate exit code.
release_path() {
  local security="$1" prefix="$2"
  local rc
  set +e
  env GITHUB_REF_NAME=main GATE_LINT=green GATE_TEST=green \
      GATE_COVERAGE=green GATE_E2E=green GATE_SECURITY="$security" \
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
# Case (a): clean tree on main -> both security signals green -> ALLOW.
# ============================================================================
echo
echo "Case (a): clean audit + clean secret-scan on main -> expect ALLOW + dry-run publish reached"

# A clean audit report: zero vulnerabilities at every severity (the green input).
printf '{"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0}}}\n' \
  > "$WORK/audit-clean.json"
# A clean secret-scan report: an empty findings array (a parseable, clean scan).
printf '[]\n' > "$WORK/secret-clean.json"

audit_green="$(gate_signal "$AUDIT_GATE_JS" "AUDIT_REPORT=$WORK/audit-clean.json")"
secret_green="$(gate_signal "$SECRET_GATE_JS" "SECRET_SCAN_REPORT=$WORK/secret-clean.json")"
check "dependency-audit gate is green on a zero-vulnerability report" \
  "$([ "$audit_green" = green ] && echo true || echo false)"
check "secret-scan gate is green on a zero-finding report" \
  "$([ "$secret_green" = green ] && echo true || echo false)"

security_green="$(fold_security "$audit_green" "$secret_green")"
check "GATE_SECURITY folds to green when both security signals are green" \
  "$([ "$security_green" = green ] && echo true || echo false)"

allow_rc="$(release_path "$security_green" "$WORK/allow")"
check "release gate ALLOWs (exit 0) when every wired gate is green on main" \
  "$([ "$allow_rc" -eq 0 ] && echo true || echo false)"
check "release gate prints ALLOW" \
  "$(grep -q 'ALLOW' "$WORK/allow.out" && echo true || echo false)"
check "the dry-run publish path is exercised on ALLOW" \
  "$([ -f "$WORK/allow.published" ] && echo true || echo false)"

# ============================================================================
# Case (b): forced high/critical audit count -> audit red -> security red -> DENY.
# ============================================================================
echo
echo "Case (b): forced vulnerable dependency -> expect audit red + DENY, no publish"

# A planted vulnerable dependency: a high-severity count above the threshold
# (forced regression — no real source touched, the secret-scan stays clean).
printf '{"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":2,"critical":0}}}\n' \
  > "$WORK/audit-vuln.json"

audit_red="$(gate_signal "$AUDIT_GATE_JS" "AUDIT_REPORT=$WORK/audit-vuln.json")"
check "dependency-audit gate goes red on a high/critical count" \
  "$([ "$audit_red" = red ] && echo true || echo false)"

security_red_b="$(fold_security "$audit_red" "$secret_green")"
check "GATE_SECURITY folds to red when the audit signal is red" \
  "$([ "$security_red_b" = red ] && echo true || echo false)"

deny_audit_rc="$(release_path "$security_red_b" "$WORK/deny-audit")"
check "release gate DENIES (non-zero) when security is red from a vulnerability" \
  "$([ "$deny_audit_rc" -ne 0 ] && echo true || echo false)"
check "release gate prints DENY and names the security gate" \
  "$(grep -q 'DENY' "$WORK/deny-audit.out" && grep -q 'security' "$WORK/deny-audit.out" && echo true || echo false)"
check "the dry-run publish path is NOT reached on a vulnerability DENY" \
  "$([ ! -f "$WORK/deny-audit.published" ] && echo true || echo false)"

# ============================================================================
# Case (c): forced secret finding -> secret-scan red -> security red -> DENY.
# ============================================================================
echo
echo "Case (c): forced leaked secret -> expect secret-scan red + DENY, no publish"

# A planted secret: a scan report with one finding (forced regression — no real
# source touched, the audit stays clean).
printf '[{"rule":"aws-access-key","file":"src/planted.ts","line":3}]\n' \
  > "$WORK/secret-finding.json"

secret_red="$(gate_signal "$SECRET_GATE_JS" "SECRET_SCAN_REPORT=$WORK/secret-finding.json")"
check "secret-scan gate goes red on a finding" \
  "$([ "$secret_red" = red ] && echo true || echo false)"

security_red_c="$(fold_security "$audit_green" "$secret_red")"
check "GATE_SECURITY folds to red when the secret-scan signal is red" \
  "$([ "$security_red_c" = red ] && echo true || echo false)"

deny_secret_rc="$(release_path "$security_red_c" "$WORK/deny-secret")"
check "release gate DENIES (non-zero) when security is red from a leaked secret" \
  "$([ "$deny_secret_rc" -ne 0 ] && echo true || echo false)"
check "release gate prints DENY and names the security gate" \
  "$(grep -q 'DENY' "$WORK/deny-secret.out" && grep -q 'security' "$WORK/deny-secret.out" && echo true || echo false)"
check "the dry-run publish path is NOT reached on a secret DENY" \
  "$([ ! -f "$WORK/deny-secret.published" ] && echo true || echo false)"

# ============================================================================
echo
if [ "$FAILED" -eq 0 ]; then
  echo "PASS: the security gate stays ALLOW (dry-run) on a clean tree and flips to"
  echo "      DENY when a vulnerable dependency or a leaked secret is planted."
  exit 0
fi
echo "FAIL: one or more security-gate proof checks failed (see output above)"
exit 1
