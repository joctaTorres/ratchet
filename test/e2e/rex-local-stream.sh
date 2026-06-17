#!/usr/bin/env bash
#
# Proof-of-work for the `rex-local-agent-runtime` change (Phase 2 gate).
#
# Drives a real step through the ReX-local AgentRuntime (RexSidecarRuntime) with
# a STUB agent that emits one line per second for ~5 lines. Asserts the lines
# arrive INCREMENTALLY (their onEvent print timestamps are spread across the run,
# not bunched at the end) and the final exit code is captured — proving RAW live
# streaming end-to-end against the real Python sidecar.
#
# SKIPs explicitly (prints a SKIP line, exits 0) when a real prerequisite is
# missing — Python >=3.10, the built dist, or (cold cache) network. Never a
# silent pass — mirrors test/e2e/rex-sidecar-bootstrap.sh.
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

skip() { echo "SKIP: $*"; exit 0; }
fail() { echo "FAIL: $*"; exit 1; }

# --- Prerequisite: a usable Python >= 3.10 -----------------------------------
PY=""
for c in python3 python python3.12 python3.11 python3.10; do
  if command -v "$c" >/dev/null 2>&1; then
    if "$c" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] >= (3,10) else 1)' 2>/dev/null; then
      PY="$c"; break
    fi
  fi
done
[ -n "$PY" ] || skip "no Python >= 3.10 found on PATH (required to run the SWE-ReX sidecar)"

# --- Prerequisite: the built dist module (runtime resolves from compiled) ------
RUNTIME_JS="dist/core/batch/engine/runtime/rex-sidecar-runtime.js"
if [ ! -f "$RUNTIME_JS" ]; then
  echo "dist not built — running build first..."
  node build.js >/dev/null 2>&1 || fail "build failed"
fi
[ -f "$RUNTIME_JS" ] || fail "$RUNTIME_JS missing after build"
[ -f "dist/core/batch/engine/runtime/sidecar.py" ] || fail "sidecar.py was not copied into dist"

# --- Cold-cache network probe -------------------------------------------------
# If the venv is not already prepared, building it needs network for swe-rex.
CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
MARKER="$CACHE_HOME/ratchet/rex/venv/.ratchet-rex-ready.json"
if [ ! -f "$MARKER" ]; then
  if ! curl -fsS --max-time 5 https://pypi.org/simple/swe-rex/ >/dev/null 2>&1; then
    skip "ReX venv not yet built and PyPI is unreachable (cold-cache bootstrap needs network)"
  fi
fi

# --- Drive a step through the runtime with a stub agent emitting 1 line/sec ----
# A small Node harness builds the RexSidecarRuntime against a temp project root,
# injects RATCHET_BATCH_AGENT_CMD as the stub agent (so the override flows THROUGH
# the runtime, exactly as the engine drives it), records the wall-clock time each
# stdout line was printed via onEvent, and asserts the spread + the exit code.
echo "Driving a step through RexSidecarRuntime with a streaming stub agent..."
RESULT="$(node --input-type=module -e '
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { makeRexSidecarRuntime } from "./dist/core/batch/engine/runtime/rex-sidecar-runtime.js";

const projectRoot = mkdtempSync(path.join(os.tmpdir(), "rex-stream-"));
// Stub agent: read the piped prompt (ignored), emit 5 timestamped lines, 1/sec,
// then exit 7 so we can prove the exit code is captured (not assumed 0).
const STUB = "cat >/dev/null; for i in 1 2 3 4 5; do echo line-$i; sleep 1; done; exit 7";

const runtime = makeRexSidecarRuntime({ locus: "local", projectRoot });
const req = {
  command: "bash",
  args: ["-c", STUB],
  instructions: "stream me",
  cwd: projectRoot,
  env: { ...process.env, RATCHET_BATCH_NAME: "e2e" },
};

const start = Date.now();
const stamps = [];
const timer = setTimeout(() => { console.error("TIMEOUT"); process.exit(3); }, 90000);

try {
  const result = await runtime(req, (e) => {
    if (e.kind === "stdout" && e.line) {
      const t = Date.now() - start;
      stamps.push({ t, line: e.line });
      console.error(`STREAM +${t}ms: ${e.line}`);
    }
  });
  clearTimeout(timer);
  rmSync(projectRoot, { recursive: true, force: true });

  const lines = stamps.map((s) => s.line);
  if (lines.length < 4) { console.error(`only ${lines.length} lines streamed`); process.exit(4); }
  // Incremental: the spread between the first and last streamed line must be a
  // meaningful fraction of the ~5s run — proving lines were NOT bunched at the
  // end. With 1 line/sec we expect ~4s of spread; require at least 2s.
  const spread = stamps[stamps.length - 1].t - stamps[0].t;
  if (spread < 2000) { console.error(`lines bunched (spread=${spread}ms)`); process.exit(5); }
  if (result.exitCode !== 7) { console.error(`exit code not captured (got ${result.exitCode})`); process.exit(6); }
  if (!result.stdout.includes("line-1") || !result.stdout.includes("line-5")) {
    console.error("accumulated transcript missing streamed lines"); process.exit(7);
  }
  console.error(`spread=${spread}ms exitCode=${result.exitCode}`);
  console.log("PASS");
} catch (err) {
  clearTimeout(timer);
  rmSync(projectRoot, { recursive: true, force: true });
  console.error(String(err && err.message ? err.message : err));
  process.exit(2);
}
')"
RC=$?
echo "$RESULT"
if [ $RC -eq 0 ] && [ "$RESULT" = "PASS" ]; then
  echo "PASS: stub agent output streamed incrementally and the exit code was captured"
  exit 0
fi
fail "ReX-local streaming did not complete cleanly (rc=$RC)"
