#!/usr/bin/env bash
#
# End-to-end proof of the proof-of-work PHASE GATE.
#
# Drives the BUILT CLI the way a user running `npx ratchet` would: it builds the
# package, then spawns `node bin/ratchet.js batch apply|status <name> --json` as
# a CHILD PROCESS against a committed two-phase fixture batch copied into a fresh
# scratch project root. It never imports internals — it asserts purely on each
# process's exit code and parsed `--json` output, so this proves the gate is
# REAL (the boundary proof runs, records, and blocks/unblocks the next phase),
# not merely modeled.
#
# Fixture (test/e2e/fixtures/proof-of-work-gate/batch.yaml): phase `p1` carries a
# blackbox proof-of-work whose pass/fail is decided ENTIRELY by the
# RATCHET_E2E_PROOF env var the script sets (`realBashRunner` spawns `bash -c`
# inheriting our env), so NO real agent is ever spawned. Each scratch root copies
# the fixture under .ratchet/batches/<name>/batch.yaml and archives change
# `first`, so phase 1 is done and phase 2 is outstanding — the first apply runs
# p1's boundary proof.
#
# Scenarios (features/proof-of-work-gate/e2e-gate.feature):
#   1. hard-gate fail — a failing p1 proof blocks entry into p2 with a clear
#      report (apply #2 is `nothing-ready` citing the failing proof; status shows
#      p2 gated with a gatedBy report naming p1).
#   2. hard-gate pass — the same fixture advances: the proof passes, p2 is ungated
#      and the batch's next step points at p2's change `second`.
#   3. warn — a failing proof under `warn` advances while surfacing the failure
#      (recorded passed:false but gatePassed:true; the human apply line shows a
#      ⚠ warning, not a hard stop; p2 ungated).
#
# It writes a machine-readable result to test/e2e/.results/proof-of-work-gate.json
# (each scenario's name + pass/fail, plus an overall `ok`). The result is written
# fail-closed: an `{"ok":false}` placeholder is laid down BEFORE any scenario
# runs, so a crash mid-run can never leave a stale "green" result; the real result
# is written atomically (temp file + mv) only after every scenario completes.
# Exit 0 iff every scenario passed.
#
# Mirrors the conventions of the other test/e2e/*.sh smokes (notably cli-smoke.sh).
set -euo pipefail

# NO_COLOR so JSON/message fields carry no ANSI escapes the assertions must strip.
export NO_COLOR=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

CLI="$ROOT/bin/ratchet.js"
FIXTURE="$ROOT/test/e2e/fixtures/proof-of-work-gate/batch.yaml"
BATCH="proof-of-work-gate"
RESULT_DIR="test/e2e/.results"
RESULT_FILE="$RESULT_DIR/proof-of-work-gate.json"

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
[ -f "$FIXTURE" ] || fail "fixture batch missing: $FIXTURE"

# --- Scratch-root scaffolding. -------------------------------------------------
# Lay down a fresh scratch project root: copy the fixture batch under
# .ratchet/batches/<name>/ and archive change `first` so phase 1 is done and
# phase 2 is outstanding. Echoes the root path. `$1` = optional policy override
# (`warn`) flipped into the scratch copy via a single sed.
scaffold() {
  local policy="${1:-}"
  local work batch_dir
  work="$(mktemp -d)"
  batch_dir="$work/.ratchet/batches/$BATCH"
  mkdir -p "$batch_dir"
  mkdir -p "$work/.ratchet/changes/archive/first"
  cp "$FIXTURE" "$batch_dir/batch.yaml"
  if [ "$policy" = "warn" ]; then
    # Flip just the committed `proofOfWork: hard-gate` line to `warn`.
    sed -i.bak 's/proofOfWork: hard-gate/proofOfWork: warn/' "$batch_dir/batch.yaml"
    rm -f "$batch_dir/batch.yaml.bak"
  fi
  echo "$work"
}

# Run the built CLI as a subprocess with cwd = scratch root. `$1` = scratch root,
# rest = ratchet args. Env (incl. RATCHET_E2E_PROOF) is inherited by the child.
run_cli() {
  local work="$1"; shift
  ( cd "$work" && node "$CLI" "$@" )
}

# Assert a JSON boolean expression over the parsed object `j`. `$1` = JSON text,
# `$2` = a JS expression evaluated against `j` (true => pass). Uses `new Function`
# so the expression is data, not interpolated into the script body.
assert_json() {
  local json="$1" expr="$2"
  EXPR="$expr" node -e '
    const src = require("fs").readFileSync(0, "utf8");
    let j;
    try { j = JSON.parse(src); } catch (e) { console.error("not JSON:", src); process.exit(2); }
    const ok = new Function("j", "return (" + process.env.EXPR + ");")(j);
    process.exit(ok ? 0 : 1);
  ' <<<"$json"
}

# --- Per-scenario accumulation. ------------------------------------------------
CHECK_JSON=()
OVERALL_OK=true

record() {
  CHECK_JSON+=("{\"name\":\"$1\",\"passed\":$2}")
  if [ "$2" != "true" ]; then OVERALL_OK=false; fi
}

# --- Scenario 1: a failing hard-gate proof blocks entry into the next phase. ----
scenario_hard_gate_fail() {
  local work out
  work="$(scaffold)"

  # apply #1 runs p1's boundary proof-of-work. RATCHET_E2E_PROOF unset => fail.
  out="$(RATCHET_E2E_PROOF= run_cli "$work" batch apply "$BATCH" --json)"
  assert_json "$out" "j.state==='proof-of-work' && j.phase==='p1' && j.passed===false && j.gatePassed===false && j.policy==='hard-gate'" \
    || { rm -rf "$work"; return 1; }

  # apply #2: nothing advances; the no-step message cites p1's failing proof.
  out="$(RATCHET_E2E_PROOF= run_cli "$work" batch apply "$BATCH" --json)"
  assert_json "$out" "j.state==='nothing-ready' && /proof-of-work failed/.test(j.message) && /p1/.test(j.message)" \
    || { rm -rf "$work"; return 1; }

  # status: phase 2 is gated with a gatedBy report naming the failing p1 proof.
  out="$(RATCHET_E2E_PROOF= run_cli "$work" batch status "$BATCH" --json)"
  assert_json "$out" "j.phases[1].gated===true && /p1/.test(j.phases[1].gatedBy) && /proof-of-work failed/.test(j.phases[1].gatedBy)" \
    || { rm -rf "$work"; return 1; }

  rm -rf "$work"
}

# --- Scenario 2: the same fixture advances once the proof passes. ---------------
scenario_hard_gate_pass() {
  local work out
  work="$(scaffold)"

  # apply #1 runs p1's boundary proof-of-work. RATCHET_E2E_PROOF=pass => pass.
  # (We do NOT run a second apply: that would select p2's change and spawn a real
  # agent. Status alone proves the gate opened.)
  out="$(RATCHET_E2E_PROOF=pass run_cli "$work" batch apply "$BATCH" --json)"
  assert_json "$out" "j.state==='proof-of-work' && j.phase==='p1' && j.passed===true && j.gatePassed===true && j.policy==='hard-gate'" \
    || { rm -rf "$work"; return 1; }

  # status: p2 is ungated and the batch's next step points at p2's change.
  out="$(RATCHET_E2E_PROOF=pass run_cli "$work" batch status "$BATCH" --json)"
  assert_json "$out" "j.phases[1].gated===false && j.next && j.next.change==='second'" \
    || { rm -rf "$work"; return 1; }

  rm -rf "$work"
}

# --- Scenario 3: warn mode advances while surfacing the failure. ----------------
scenario_warn() {
  local work out

  # 3a: --json apply records the failing-but-gate-passed verdict under `warn`.
  work="$(scaffold warn)"
  out="$(RATCHET_E2E_PROOF= run_cli "$work" batch apply "$BATCH" --json)"
  assert_json "$out" "j.state==='proof-of-work' && j.passed===false && j.gatePassed===true && j.policy==='warn'" \
    || { rm -rf "$work"; return 1; }

  # status: p2 is ungated — warn advances despite the failing proof.
  out="$(RATCHET_E2E_PROOF= run_cli "$work" batch status "$BATCH" --json)"
  assert_json "$out" "j.phases[1].gated===false" \
    || { rm -rf "$work"; return 1; }
  rm -rf "$work"

  # 3b: the HUMAN (non-JSON) apply line surfaces the failure as a ⚠ warning, not
  # a hard-stop ✗. A fresh root so the boundary proof actually runs.
  work="$(scaffold warn)"
  out="$(RATCHET_E2E_PROOF= run_cli "$work" batch apply "$BATCH")"
  rm -rf "$work"
  printf '%s' "$out" | grep -qF '⚠' || return 1
  printf '%s' "$out" | grep -qiF 'warn' || return 1
  # Must NOT be presented as a hard stop (the ✗ red-fail line is hard-gate only).
  if printf '%s' "$out" | grep -qF '✗ failed'; then return 1; fi
}

echo "Driving the built CLI as a subprocess against the fixture (the gate, end to end)..."

if scenario_hard_gate_fail; then
  record hard-gate-fail true;  echo "  ok: a failing hard-gate proof blocks entry into phase 2 with a clear report"
else
  record hard-gate-fail false; echo "  FAIL: failing hard-gate proof did not block phase 2 / report the failing proof"
fi

if scenario_hard_gate_pass; then
  record hard-gate-pass true;  echo "  ok: the same fixture advances once the proof passes (p2 ungated, next is 'second')"
else
  record hard-gate-pass false; echo "  FAIL: passing proof did not unblock phase 2 / point next at 'second'"
fi

if scenario_warn; then
  record warn true;            echo "  ok: warn advances while surfacing the failure (⚠, p2 ungated)"
else
  record warn false;           echo "  FAIL: warn did not advance / surface the failure as a warning"
fi

# --- Write the real result atomically (temp + mv). ----------------------------
joined="$(IFS=,; echo "${CHECK_JSON[*]}")"
tmp="$(mktemp)"
printf '{"ok":%s,"checks":[%s]}\n' "$OVERALL_OK" "$joined" > "$tmp"
mv "$tmp" "$RESULT_FILE"

echo "Wrote machine-readable result: $RESULT_FILE"

if [ "$OVERALL_OK" = true ]; then
  echo "PASS: the proof-of-work phase gate was driven end to end and every scenario held"
  exit 0
fi
echo "FAIL: one or more proof-of-work gate scenarios failed (see $RESULT_FILE)"
exit 1
