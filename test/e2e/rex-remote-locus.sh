#!/usr/bin/env bash
#
# Proof-of-work for the `rex-remote-locus` change (Phase 5 gate).
#
# Boots a REAL local `swerex-remote` FastAPI server from the bootstrapped venv
# with a known --auth-token on a free port, points the native-Node
# RexRemoteRuntime at localhost:<port>, and drives a STUB agent step over the
# REST API. Asserts:
#   1. output streams INCREMENTALLY over REST (onEvent print timestamps spread
#      across the ~5s run, not bunched at the end), and the agent's real exit
#      code is captured from the server-side sentinel;
#   2. a BAD token yields a CLEAR auth error (non-zero result, message names the
#      host:port, no raw traceback, no hang).
# Then it tears the server down.
#
# SKIPs explicitly (prints a SKIP line, exits 0) only when a real prerequisite
# is genuinely missing — Python >=3.10, the venv `swerex-remote` script, or the
# built dist. Never a silent pass — mirrors test/e2e/rex-local-stream.sh.
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

skip() { echo "SKIP: $*"; exit 0; }
fail() { echo "FAIL: $*"; exit 1; }

# --- Prerequisite: the bootstrapped venv's swerex-remote console script --------
CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
VENV_BIN="$CACHE_HOME/ratchet/rex/venv/bin"
SWEREX="$VENV_BIN/swerex-remote"
if [ ! -x "$SWEREX" ]; then
  skip "swerex-remote console script not found at $SWEREX (venv not bootstrapped)"
fi
if ! "$SWEREX" --version >/dev/null 2>&1; then
  skip "swerex-remote present but --version failed (venv unusable)"
fi
echo "swerex-remote: $("$SWEREX" --version 2>&1) at $SWEREX"

# --- Prerequisite: the built dist module --------------------------------------
RUNTIME_JS="dist/core/batch/engine/runtime/rex-remote-runtime.js"
if [ ! -f "$RUNTIME_JS" ]; then
  echo "dist not built — running build first..."
  node build.js >/dev/null 2>&1 || fail "build failed"
fi
[ -f "$RUNTIME_JS" ] || fail "$RUNTIME_JS missing after build"

# --- Pick a free TCP port -----------------------------------------------------
PORT="$(node -e 'const n=require("net");const s=n.createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>console.log(p));});')"
[ -n "$PORT" ] || fail "could not allocate a free port"
TOKEN="e2e-secret-$$-$RANDOM"
echo "Booting swerex-remote on 127.0.0.1:$PORT ..."

# --- Boot the server, ensure teardown on any exit -----------------------------
SERVER_LOG="$(mktemp -t swerex-remote.XXXXXX)"
"$SWEREX" --host 127.0.0.1 --port "$PORT" --auth-token "$TOKEN" >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

cleanup() {
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
  rm -f "$SERVER_LOG"
}
trap cleanup EXIT INT TERM

# --- Wait for /is_alive (bounded) ---------------------------------------------
ALIVE=0
for _ in $(seq 1 50); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "--- server log ---"; cat "$SERVER_LOG"; fail "server process exited during startup"
  fi
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -H "X-API-Key: $TOKEN" "http://127.0.0.1:$PORT/is_alive" 2>/dev/null)"
  if [ "$CODE" = "200" ]; then ALIVE=1; break; fi
  sleep 0.2
done
[ "$ALIVE" = "1" ] || { echo "--- server log ---"; cat "$SERVER_LOG"; fail "server did not become alive on :$PORT"; }
echo "Server is alive on :$PORT"

# --- Drive a streamed stub agent step through RexRemoteRuntime ----------------
echo "Driving a stub agent step over REST (incremental streaming + exit code)..."
RESULT="$(REMOTE_PORT="$PORT" REMOTE_TOKEN="$TOKEN" node --input-type=module -e '
import { makeRexRemoteRuntime } from "./dist/core/batch/engine/runtime/rex-remote-runtime.js";

const port = Number(process.env.REMOTE_PORT);
const authToken = process.env.REMOTE_TOKEN;
// Stub agent: ignore the piped prompt, emit 5 timestamped lines 1/sec, exit 7.
const STUB = "cat >/dev/null; for i in 1 2 3 4 5; do echo line-$i; sleep 1; done; exit 7";

const runtime = makeRexRemoteRuntime({ host: "127.0.0.1", port, authToken, pollIntervalMs: 300 });
const req = { command: "bash", args: ["-c", STUB], instructions: "stream me", cwd: "/tmp", env: {} };

const start = Date.now();
const stamps = [];
const timer = setTimeout(() => { console.error("TIMEOUT"); process.exit(3); }, 90000);
try {
  const result = await runtime(req, (e) => {
    if (e.kind === "stdout" && e.line) {
      const t = Date.now() - start;
      stamps.push({ t, line: e.line });
      console.error(`STREAM +${t}ms: ${e.line}`);
    } else if (e.kind === "error") {
      console.error(`ERROR: ${e.message}`);
    }
  });
  clearTimeout(timer);
  const lines = stamps.map((s) => s.line);
  if (lines.length < 4) { console.error(`only ${lines.length} lines streamed`); process.exit(4); }
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
  console.error(String(err && err.message ? err.message : err));
  process.exit(2);
}
')"
RC=$?
echo "$RESULT"
[ $RC -eq 0 ] && [ "$RESULT" = "PASS" ] || fail "remote streaming step did not complete cleanly (rc=$RC)"
echo "PASS: stub agent output streamed incrementally over REST and the exit code was captured"

# --- Assert a BAD token yields a clear auth error (no hang, no traceback) ------
echo "Asserting a BAD token surfaces a clear auth error..."
AUTH="$(REMOTE_PORT="$PORT" node --input-type=module -e '
import { makeRexRemoteRuntime } from "./dist/core/batch/engine/runtime/rex-remote-runtime.js";
const port = Number(process.env.REMOTE_PORT);
const runtime = makeRexRemoteRuntime({ host: "127.0.0.1", port, authToken: "WRONG-TOKEN", pollIntervalMs: 300 });
const req = { command: "bash", args: ["-c", "echo hi"], instructions: "x", cwd: "/tmp", env: {} };
const timer = setTimeout(() => { console.error("HANG: auth path did not resolve"); process.exit(3); }, 20000);
const result = await runtime(req, () => {});
clearTimeout(timer);
console.error(`AUTH stderr: ${result.stderr}`);
if (result.exitCode === 0) { console.error("auth failure did not produce a non-zero exit"); process.exit(4); }
if (!result.stderr.includes("127.0.0.1:" + port)) { console.error("auth error does not name host:port"); process.exit(5); }
if (/Traceback|File \"/.test(result.stderr)) { console.error("auth error leaked a raw traceback"); process.exit(6); }
if (result.stderr.includes("WRONG-TOKEN")) { console.error("auth error LEAKED the token"); process.exit(7); }
console.log("PASS");
')"
RC=$?
echo "$AUTH"
[ $RC -eq 0 ] && [ "$AUTH" = "PASS" ] || fail "bad-token auth path did not surface a clean error (rc=$RC)"
echo "PASS: a bad token surfaced a clear auth error naming host:port (no traceback, no hang, token not leaked)"

# Teardown happens via the EXIT trap.
echo "ALL PASS: rex-remote-locus proof-of-work"
exit 0
