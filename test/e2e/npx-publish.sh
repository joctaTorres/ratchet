#!/usr/bin/env bash
#
# Phase proof-of-work (reachability seed) for the "real-npm-publish-on-main"
# phase — the maintainer-facing, end-to-end demonstration that the gated publish
# job is reachable ONLY when the release-decision module returns ALLOW on `main`.
#
# It composes the already-shipped, unit-tested release-gate runner over FORCED
# branch + GATE_* signals — it adds NO new decision logic:
#   - release-gate.js : reads GITHUB_REF_NAME + GATE_* signals -> ALLOW/DENY
#                       (exit 0 / non-zero), AND writes `release_allowed=true|false`
#                       to the file named by GITHUB_OUTPUT (the step output the
#                       `ci` job lifts into a job-level signal).
#
# This harness models the workflow GRAPH-level gate exactly as CI does:
#   - run release-gate.js with GITHUB_OUTPUT pointing at a scratch file;
#   - read `release_allowed` back from that file — the literal value the `ci` job
#     exposes as `needs.ci.outputs.release_allowed`;
#   - the `publish` job's gate is `needs.ci.outputs.release_allowed == 'true'`, so
#     ONLY when the scratch output says `true` is the dry-run publish path reached
#     (recorded by a marker file). Nothing is ever published — the publish stays
#     `npm publish --dry-run`.
#
# The publish path now passes TWO gates in series, both modeled here:
#   - the RELEASE gate (release-gate.js): governs whether the `publish` job runs
#     at all (`needs.ci.outputs.release_allowed == 'true'`); fail-CLOSED.
#   - the VERSION guard (version-guard.js): governs whether that job actually
#     publishes (`steps.<guard>.outputs.should_publish == 'true'`). It reads the
#     local version + a FORCED `PUBLISHED_VERSIONS` set and ALWAYS exits 0 — a
#     SKIP (already-published version) is a deliberate, GREEN no-op.
#
# Five asserted cases:
#   (a) ALLOW  — on `main` with every wired gate green, release_allowed=true, the
#                publish gate condition is satisfied, and the dry-run publish path
#                is exercised.
#   (b) DENY   — a forced red wired gate makes release_allowed=false; the publish
#                gate condition is NOT satisfied and the publish path is NOT reached.
#   (c) DENY   — a non-main ref makes release_allowed=false; the publish gate
#                condition is NOT satisfied and the publish path is NOT reached.
#   (d) PUBLISH (idempotency) — ALLOW on `main` AND a NEW version (absent from the
#                forced PUBLISHED_VERSIONS set) -> should_publish=true -> dry-run
#                publish path exercised -> the guard exits 0.
#   (e) SKIP    (idempotency) — ALLOW on `main` but an ALREADY-PUBLISHED version
#                -> should_publish=false -> publish path NOT reached, yet the guard
#                STILL exits 0 (a re-run of an old version does not error).
#
# Inputs are FORCED via environment (branch + GATE_* signals + version /
# PUBLISHED_VERSIONS) rather than by sabotaging real source, so the harness is
# deterministic and side-effect-free. Mirrors the conventions of
# test/e2e/release-gate.sh and the other smokes. The later `real-npm-publish`
# change thickens this same harness to a real/staged publish with a real
# registry query and an `npx ratchet --version` assertion against the published CLI.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

RELEASE_GATE_JS="dist/core/ci/release-gate.js"
VERSION_GUARD_JS="dist/core/ci/version-guard.js"

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

# --- Build so the dist/ runner is runnable. -----------------------------------
echo "Building the package (pnpm build)..."
if command -v pnpm >/dev/null 2>&1; then
  pnpm build >/dev/null 2>&1 || fail "pnpm build failed"
else
  node build.js >/dev/null 2>&1 || fail "node build.js failed"
fi
[ -f "$RELEASE_GATE_JS" ] || fail "$RELEASE_GATE_JS missing after build"
[ -f "$VERSION_GUARD_JS" ] || fail "$VERSION_GUARD_JS missing after build"

# read_release_allowed <github_output_file>: echo the `release_allowed` value the
# release-gate runner appended (the last such line wins), or empty if absent —
# exactly the value GitHub Actions exposes as a step/job output.
read_release_allowed() {
  local file="$1"
  [ -f "$file" ] || { echo ""; return; }
  grep '^release_allowed=' "$file" | tail -n1 | cut -d= -f2
}

# publish_gate_satisfied <release_allowed>: model the publish job's gate
# `if: needs.ci.outputs.release_allowed == 'true'` — true ONLY on the literal
# string `true`.
publish_gate_satisfied() {
  [ "$1" = "true" ]
}

# release_path <branch> <out_prefix> [GATE_* assignments...]: model the CI release
# decision + the gated publish job. Run release-gate.js for the given branch and
# gate signals, capturing its `release_allowed` step output in a scratch
# GITHUB_OUTPUT. ONLY when that output satisfies the publish gate is the dry-run
# publish path reached, recorded by writing "<out_prefix>.published". Echoes the
# release-gate exit code.
release_path() {
  local branch="$1" prefix="$2"; shift 2
  local gh_output="$prefix.github_output"
  : > "$gh_output"
  local rc
  set +e
  env GITHUB_REF_NAME="$branch" GITHUB_OUTPUT="$gh_output" "$@" \
      node "$RELEASE_GATE_JS" >"$prefix.out" 2>&1
  rc=$?
  set -e
  local allowed
  allowed="$(read_release_allowed "$gh_output")"
  echo "$allowed" > "$prefix.allowed"
  if publish_gate_satisfied "$allowed"; then
    # Publish gate satisfied: the publish job would run. Exercise the dry-run
    # publish exactly as CI does — it packs locally and stops short of uploading
    # (no token, no real release). Its own outcome is not what this change proves,
    # so it is tolerated; the marker records that the GATE permitted the path.
    npm publish --dry-run >"$prefix.publish.log" 2>&1 || true
    : > "$prefix.published"
  fi
  echo "$rc"
}

# ============================================================================
# Case (a): all-green main -> release_allowed=true -> publish path exercised.
# ============================================================================
echo
echo "Case (a): all gates green on main -> expect release_allowed=true + publish reached"

allow_rc="$(release_path main "$WORK/allow" \
  GATE_LINT=green GATE_TEST=green GATE_COVERAGE=green GATE_E2E=green GATE_SECURITY=green)"
allow_allowed="$(cat "$WORK/allow.allowed")"

check "release gate ALLOWs (exit 0) when all five gates are green on main" \
  "$([ "$allow_rc" -eq 0 ] && echo true || echo false)"
check "release-gate writes release_allowed=true to GITHUB_OUTPUT on ALLOW" \
  "$([ "$allow_allowed" = true ] && echo true || echo false)"
check "the publish job gate condition is satisfied on ALLOW" \
  "$(publish_gate_satisfied "$allow_allowed" && echo true || echo false)"
check "the dry-run publish path is exercised on ALLOW" \
  "$([ -f "$WORK/allow.published" ] && echo true || echo false)"

# ============================================================================
# Case (b): forced red wired gate -> release_allowed=false -> publish NOT reached.
# ============================================================================
echo
echo "Case (b): forced red test gate on main -> expect release_allowed=false, no publish"

deny_rc="$(release_path main "$WORK/deny-gate" \
  GATE_LINT=green GATE_TEST=red GATE_COVERAGE=green GATE_E2E=green GATE_SECURITY=green)"
deny_allowed="$(cat "$WORK/deny-gate.allowed")"

check "release gate DENIES (non-zero) when a wired gate is red" \
  "$([ "$deny_rc" -ne 0 ] && echo true || echo false)"
check "release-gate writes release_allowed=false to GITHUB_OUTPUT on a red gate" \
  "$([ "$deny_allowed" = false ] && echo true || echo false)"
check "the publish job gate condition is NOT satisfied on a red gate" \
  "$(publish_gate_satisfied "$deny_allowed" && echo false || echo true)"
check "the dry-run publish path is NOT reached on a red gate" \
  "$([ ! -f "$WORK/deny-gate.published" ] && echo true || echo false)"

# ============================================================================
# Case (c): non-main ref -> release_allowed=false -> publish NOT reached.
# ============================================================================
echo
echo "Case (c): non-main ref with all gates green -> expect release_allowed=false, no publish"

nonmain_rc="$(release_path feature/widget "$WORK/deny-branch" \
  GATE_LINT=green GATE_TEST=green GATE_COVERAGE=green GATE_E2E=green GATE_SECURITY=green)"
nonmain_allowed="$(cat "$WORK/deny-branch.allowed")"

check "release gate DENIES (non-zero) on a non-main ref" \
  "$([ "$nonmain_rc" -ne 0 ] && echo true || echo false)"
check "release-gate writes release_allowed=false to GITHUB_OUTPUT off main" \
  "$([ "$nonmain_allowed" = false ] && echo true || echo false)"
check "the publish job gate condition is NOT satisfied off main" \
  "$(publish_gate_satisfied "$nonmain_allowed" && echo false || echo true)"
check "the dry-run publish path is NOT reached off main" \
  "$([ ! -f "$WORK/deny-branch.published" ] && echo true || echo false)"

# read_should_publish <github_output_file>: echo the `should_publish` value the
# version-guard runner appended (the last such line wins), or empty if absent —
# exactly the value GitHub Actions exposes as `steps.<guard>.outputs.should_publish`.
read_should_publish() {
  local file="$1"
  [ -f "$file" ] || { echo ""; return; }
  grep '^should_publish=' "$file" | tail -n1 | cut -d= -f2
}

# version_guard_path <branch> <out_prefix> <version> <published_versions> [GATE_* ...]:
# model the FULL two-gate publish path. First run release-gate.js for the branch
# + gate signals (the `ci` job's release_allowed). ONLY when that gate is
# satisfied, run version-guard.js with the forced local version + published set,
# capturing its `should_publish` step output. ONLY when BOTH gates are satisfied
# is the dry-run publish path reached (recorded by "<out_prefix>.published").
# Echoes the version-guard exit code (which must ALWAYS be 0).
version_guard_path() {
  local branch="$1" prefix="$2" version="$3" published="$4"; shift 4
  local rel_output="$prefix.rel.github_output"
  : > "$rel_output"
  env GITHUB_REF_NAME="$branch" GITHUB_OUTPUT="$rel_output" "$@" \
      node "$RELEASE_GATE_JS" >"$prefix.rel.out" 2>&1 || true
  local allowed
  allowed="$(read_release_allowed "$rel_output")"
  echo "$allowed" > "$prefix.allowed"

  local guard_output="$prefix.guard.github_output"
  : > "$guard_output"
  local guard_rc=""
  if publish_gate_satisfied "$allowed"; then
    set +e
    env PACKAGE_VERSION="$version" PUBLISHED_VERSIONS="$published" GITHUB_OUTPUT="$guard_output" \
        node "$VERSION_GUARD_JS" >"$prefix.guard.out" 2>&1
    guard_rc=$?
    set -e
  fi
  local should
  should="$(read_should_publish "$guard_output")"
  echo "$should" > "$prefix.should"

  # Both gates must agree: the job runs (release_allowed=true) AND the version is
  # new (should_publish=true). Only then is the dry-run publish exercised.
  if publish_gate_satisfied "$allowed" && [ "$should" = "true" ]; then
    npm publish --dry-run >"$prefix.publish.log" 2>&1 || true
    : > "$prefix.published"
  fi
  echo "$guard_rc"
}

# ============================================================================
# Case (d): ALLOW on main + a NEW version -> should_publish=true -> publish reached.
# ============================================================================
echo
echo "Case (d): all gates green on main + NEW version -> expect should_publish=true + publish reached, guard exit 0"

new_rc="$(version_guard_path main "$WORK/idem-new" 9.9.9 "1.0.0,1.1.0" \
  GATE_LINT=green GATE_TEST=green GATE_COVERAGE=green GATE_E2E=green GATE_SECURITY=green)"
new_should="$(cat "$WORK/idem-new.should")"

check "version guard reports should_publish=true for a new version on ALLOW" \
  "$([ "$new_should" = true ] && echo true || echo false)"
check "the dry-run publish path is exercised for a new version" \
  "$([ -f "$WORK/idem-new.published" ] && echo true || echo false)"
check "the version guard exits 0 on PUBLISH" \
  "$([ "$new_rc" -eq 0 ] && echo true || echo false)"

# ============================================================================
# Case (e): ALLOW on main + an ALREADY-PUBLISHED version -> should_publish=false ->
#           publish NOT reached, yet the guard STILL exits 0 (idempotent re-run).
# ============================================================================
echo
echo "Case (e): all gates green on main + ALREADY-PUBLISHED version -> expect should_publish=false, no publish, guard STILL exit 0"

old_rc="$(version_guard_path main "$WORK/idem-old" 1.1.0 "1.0.0,1.1.0,1.2.0" \
  GATE_LINT=green GATE_TEST=green GATE_COVERAGE=green GATE_E2E=green GATE_SECURITY=green)"
old_should="$(cat "$WORK/idem-old.should")"

check "version guard reports should_publish=false for an already-published version" \
  "$([ "$old_should" = false ] && echo true || echo false)"
check "the dry-run publish path is NOT reached for an already-published version" \
  "$([ ! -f "$WORK/idem-old.published" ] && echo true || echo false)"
check "the version guard STILL exits 0 on SKIP (idempotent re-run does not error)" \
  "$([ "$old_rc" -eq 0 ] && echo true || echo false)"

# ============================================================================
echo
if [ "$FAILED" -eq 0 ]; then
  echo "PASS: the gated publish job is reachable ONLY when the release-decision"
  echo "      module returns ALLOW on main; a red gate or a non-main ref keeps"
  echo "      release_allowed=false and the dry-run publish path unreached. On the"
  echo "      ALLOW path a NEW version publishes (should_publish=true) while an"
  echo "      already-published version is a GREEN SKIP (should_publish=false,"
  echo "      guard exits 0) — the re-run is idempotent."
  exit 0
fi
echo "FAIL: one or more gated-publish proof checks failed (see output above)"
exit 1
