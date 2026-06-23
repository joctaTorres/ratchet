#!/usr/bin/env bash
#
# End-to-end CLI smoke — the e2e half of the "coverage + e2e gates" phase.
#
# Drives the BUILT CLI the way a user running `npx ratchet` would: it builds the
# package, then spawns `node bin/ratchet.js <args>` as a CHILD PROCESS — the same
# path the package `bin` resolves through — and asserts purely on the process's
# exit code and stdout. It never imports internals or calls functions directly,
# so a build/packaging/entrypoint regression that unit tests miss is caught.
#
# Checks (all read-only, side-effect-free):
#   - version: `--version` exits 0 and prints the package version.
#   - help:    `--help` exits 0 and lists the available commands.
#   - subcommand: in a fresh scratch dir, `init --tools none` then `list` both
#     run end to end and exit cleanly — a real read-only subcommand path.
#
# It writes a machine-readable result to test/e2e/.results/cli-smoke.json
# (each check's name + pass/fail, plus an overall `ok`) so the pure e2e-gate
# evaluator has real data to act on. The result is written fail-closed: an
# `{"ok":false}` placeholder is laid down BEFORE any check runs, so a crash
# mid-run can never leave a stale "green" result; the real result is written
# atomically (temp file + mv) only after every check completes.
#
# Mirrors the conventions of the other test/e2e/*.sh smokes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

CLI="bin/ratchet.js"
RESULT_DIR="test/e2e/.results"
RESULT_FILE="$RESULT_DIR/cli-smoke.json"

fail() { echo "FAIL: $*"; exit 1; }

# --- Fail-closed placeholder: a crash before completion leaves this red. ------
mkdir -p "$RESULT_DIR"
printf '{"ok":false,"checks":[]}\n' > "$RESULT_FILE"

# --- Build the package so dist/ + bin/ratchet.js are runnable. -----------------
echo "Building the package (pnpm build)..."
if command -v pnpm >/dev/null 2>&1; then
  pnpm build >/dev/null 2>&1 || fail "pnpm build failed"
else
  node build.js >/dev/null 2>&1 || fail "node build.js failed"
fi
[ -f "dist/cli/index.js" ] || fail "dist/cli/index.js missing after build"
[ -f "$CLI" ] || fail "$CLI missing — package bin entrypoint not present"

PKG_VERSION="$(node -p "require('./package.json').version")"

# --- Per-check accumulation. ---------------------------------------------------
CHECK_JSON=()
OVERALL_OK=true

# record <name> <true|false>: append a check entry and track overall pass/fail.
record() {
  CHECK_JSON+=("{\"name\":\"$1\",\"passed\":$2}")
  if [ "$2" != "true" ]; then OVERALL_OK=false; fi
}

# Each check runs the built CLI as a subprocess and asserts exit code + stdout.
# Called from an `if`, so a non-zero return never aborts the script (set -e is
# suspended inside a condition), letting us record EVERY check and still write a
# complete result.

check_version() {
  local out rc
  out="$(node "$CLI" --version 2>&1)"; rc=$?
  [ $rc -eq 0 ] || return 1
  printf '%s' "$out" | grep -qF "$PKG_VERSION" || return 1
}

check_help() {
  local out rc
  out="$(node "$CLI" --help 2>&1)"; rc=$?
  [ $rc -eq 0 ] || return 1
  printf '%s' "$out" | grep -qiF "Commands:" || return 1
  # A user-facing command is listed (proves it lists commands, not just usage).
  printf '%s' "$out" | grep -qE '\blist\b' || return 1
}

check_subcommand() {
  local work rc1 rc2
  work="$(mktemp -d)"
  ( cd "$work" && node "$ROOT/$CLI" init --tools none ) >/dev/null 2>&1; rc1=$?
  ( cd "$work" && node "$ROOT/$CLI" list ) >/dev/null 2>&1; rc2=$?
  rm -rf "$work"
  [ $rc1 -eq 0 ] && [ $rc2 -eq 0 ]
}

echo "Driving the built CLI as a subprocess (the npx ratchet path)..."

if check_version; then
  record version true;     echo "  ok: --version exits 0 and prints $PKG_VERSION"
else
  record version false;    echo "  FAIL: --version did not exit 0 / print the version"
fi

if check_help; then
  record help true;        echo "  ok: --help exits 0 and lists commands"
else
  record help false;       echo "  FAIL: --help did not exit 0 / list commands"
fi

if check_subcommand; then
  record subcommand true;  echo "  ok: init --tools none + list run end to end and exit cleanly"
else
  record subcommand false; echo "  FAIL: read-only subcommand path did not exit cleanly"
fi

# --- Write the real result atomically (temp + mv). ----------------------------
joined="$(IFS=,; echo "${CHECK_JSON[*]}")"
tmp="$(mktemp)"
printf '{"ok":%s,"checks":[%s]}\n' "$OVERALL_OK" "$joined" > "$tmp"
mv "$tmp" "$RESULT_FILE"

echo "Wrote machine-readable result: $RESULT_FILE"

if [ "$OVERALL_OK" = true ]; then
  echo "PASS: the built CLI was driven end to end and every check passed"
  exit 0
fi
echo "FAIL: one or more e2e CLI checks failed (see $RESULT_FILE)"
exit 1
