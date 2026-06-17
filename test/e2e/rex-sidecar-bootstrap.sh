#!/usr/bin/env bash
#
# Proof-of-work for the `python-sidecar-bootstrap` change.
#
# Bootstraps the ratchet-owned ReX venv, launches the Python sidecar via the
# RESOLVED launch command, asserts {"event":"ready"}, sends {"op":"shutdown"},
# and asserts a clean {"event":"closed"} with exit 0. Proves the Python substrate
# works end-to-end WITHOUT the Node runtime (built next change).
#
# SKIPs explicitly (prints a SKIP line, exits 0) when a real prerequisite is
# missing — Python >=3.10 or, for a cold cache, network. Never a silent pass.
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

# --- Prerequisite: the built dist module (bootstrap resolves from compiled) ---
BOOTSTRAP_JS="dist/core/batch/engine/runtime/rex-bootstrap.js"
if [ ! -f "$BOOTSTRAP_JS" ]; then
  echo "dist not built — running build first..."
  node build.js >/dev/null 2>&1 || fail "build failed"
fi
[ -f "$BOOTSTRAP_JS" ] || fail "$BOOTSTRAP_JS missing after build"
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

# --- Bootstrap and emit the resolved launch command as JSON -------------------
echo "Bootstrapping ReX runtime (this builds/reuses the venv)..."
LAUNCH_JSON="$(node --input-type=module -e '
import { bootstrapRexRuntime } from "./dist/core/batch/engine/runtime/rex-bootstrap.js";
try {
  const l = bootstrapRexRuntime({ locus: "local", workdir: "/tmp" });
  process.stdout.write(JSON.stringify({ command: l.command, args: l.args, env: l.env }));
} catch (e) {
  process.stderr.write(String(e && e.message ? e.message : e));
  process.exit(7);
}
')"
RC=$?
if [ $RC -ne 0 ]; then
  # A bootstrap failure on a real prereq gap (e.g. install blocked) is a SKIP,
  # but a code bug is a FAIL. The module distinguishes via RexBootstrapError;
  # surface its message and treat install/network gaps as SKIP.
  echo "bootstrap stderr: $LAUNCH_JSON" >&2
  case "$LAUNCH_JSON" in
    *"installing swe-rex"*|*"network"*|*"creating the venv"*)
      skip "ReX venv could not be built ($LAUNCH_JSON)";;
    *) fail "bootstrap errored: $LAUNCH_JSON";;
  esac
fi

# --- Launch the sidecar via the resolved command, drive the protocol ----------
# A Node harness launches the sidecar, waits for "ready" (with a timeout so a
# hang fails loudly), sends shutdown, and asserts "closed" + exit 0.
echo "Launching sidecar and driving the lifecycle..."
RESULT="$(LAUNCH_JSON="$LAUNCH_JSON" node --input-type=module -e '
import { spawn } from "node:child_process";
const launch = JSON.parse(process.env.LAUNCH_JSON);
const child = spawn(launch.command, launch.args, {
  env: launch.env, stdio: ["pipe", "pipe", "inherit"],
});
let buf = "";
let sawReady = false, sawClosed = false;
const timer = setTimeout(() => {
  console.error("TIMEOUT waiting for ready/closed");
  child.kill("SIGKILL");
  process.exit(3);
}, 90000);
child.stdout.setEncoding("utf-8");
child.stdout.on("data", (d) => {
  buf += d;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    let obj; try { obj = JSON.parse(line); } catch { continue; }
    if (obj.event === "ready") {
      sawReady = true;
      console.error("READY: " + line);
      child.stdin.write(JSON.stringify({ op: "shutdown" }) + "\n");
    } else if (obj.event === "closed") {
      sawClosed = true;
      console.error("CLOSED: " + line);
    }
  }
});
child.on("exit", (code) => {
  clearTimeout(timer);
  if (sawReady && sawClosed && code === 0) { console.log("PASS"); process.exit(0); }
  console.error(`ready=${sawReady} closed=${sawClosed} exit=${code}`);
  process.exit(4);
});
')"
RC=$?
echo "$RESULT"
if [ $RC -eq 0 ] && [ "$RESULT" = "PASS" ]; then
  echo "PASS: sidecar bootstrapped, reported ready, and shut down cleanly (exit 0)"
  exit 0
fi
fail "sidecar lifecycle did not complete cleanly (rc=$RC)"
