#!/usr/bin/env bash
#
# Proof-of-work for the `rex-docker-locus` change (Phase 4 gate).
#
# Drives a real step through the ReX AgentRuntime with `locus: docker`, against a
# generic small image and a STUB agent that prints an IN-CONTAINER marker (the
# container's hostname, which differs from the host's). Asserts:
#   - the in-container marker value is observed in the streamed output AND differs
#     from the host hostname (proving the step ran INSIDE the container),
#   - lines stream INCREMENTALLY (their onEvent timestamps are spread across the
#     run, not bunched at the end),
#   - the captured exit code matches the stub's exit status.
# Exit 0 on pass — this is the honest plumbing proof.
#
# SKIPs explicitly (prints a SKIP line, exits 0) when a real prerequisite is
# missing — Docker daemon, Python >=3.10, the built dist, or (cold cache) the
# package index. NEVER a silent pass: a SKIP never claims the in-container
# behavior was verified. Mirrors test/e2e/rex-local-stream.sh.
#
# FOLLOW-ON (out of scope here): this proves the PLUMBING — that a step runs in a
# container with streaming + a captured exit code — with a generic image + stub
# agent. A REAL agent run needs an image provisioned with node + the chosen
# coding agent (e.g. claude) + `ratchet` on PATH, so the agent can run
# `ratchet batch report` and the engine can read the journal back over the bind
# mount. Building that production image is a separate follow-on change.
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

skip() { echo "SKIP: $*"; exit 0; }
fail() { echo "FAIL: $*"; exit 1; }

# --- Prerequisite: a running Docker daemon (the PRIMARY gate) -----------------
# This is the Node-side `docker info` pre-flight, mirrored here so the script
# SKIPs loudly on a Docker-less machine instead of failing or hanging.
command -v docker >/dev/null 2>&1 || skip "Docker not available (no \`docker\` on PATH) — required for locus=docker"
if ! docker info >/dev/null 2>&1; then
  skip "Docker not available (\`docker info\` failed — daemon not running) — required for locus=docker"
fi

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
# A docker-capable venv needs swe-rex[docker]; if it is not already prepared,
# building it needs the package index. SKIP (not fail) when offline + cold.
CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
MARKER="$CACHE_HOME/ratchet/rex/venv/.ratchet-rex-ready.json"
NEEDS_DOCKER_EXTRA=1
if [ -f "$MARKER" ] && grep -q '"docker"' "$MARKER" 2>/dev/null; then
  NEEDS_DOCKER_EXTRA=0
fi
if [ "$NEEDS_DOCKER_EXTRA" -eq 1 ]; then
  if ! curl -fsS --max-time 5 https://pypi.org/simple/swe-rex/ >/dev/null 2>&1; then
    skip "docker-capable ReX venv not yet built and PyPI is unreachable (cold-cache bootstrap needs network)"
  fi
fi

# --- Pull a generic small image (no agent provisioning required) --------------
IMAGE="python:3.12"
echo "Pulling generic image $IMAGE (plumbing proof only)..."
docker pull "$IMAGE" >/dev/null 2>&1 || skip "could not pull $IMAGE (registry unreachable) — needed for the container plumbing proof"

# --- Drive a step through the runtime with locus=docker + a stub agent --------
# The stub prints the container hostname (the in-container marker), emits a few
# timestamped lines 1/sec so we can prove incremental streaming, and exits 7 so
# we can prove the exit code is captured. The marker is asserted to differ from
# the HOST hostname — proof the step executed inside the container, not the host.
echo "Driving a step through the docker locus with a streaming stub agent..."
HOST_HOSTNAME="$(hostname)"
RESULT="$(HOST_HOSTNAME="$HOST_HOSTNAME" DOCKER_IMAGE="$IMAGE" node --input-type=module -e '
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { makeRexSidecarRuntime } from "./dist/core/batch/engine/runtime/rex-sidecar-runtime.js";

const projectRoot = mkdtempSync(path.join(os.tmpdir(), "rex-docker-"));
const hostHostname = process.env.HOST_HOSTNAME || "";
const image = process.env.DOCKER_IMAGE || "python:3.12";

// Stub agent: read the piped prompt (ignored), print an IN-CONTAINER marker
// (the container hostname), then 5 timestamped lines 1/sec, then exit 7.
const STUB = [
  "cat >/dev/null;",
  "echo MARKER=$(hostname);",
  "for i in 1 2 3 4 5; do echo line-$i; sleep 1; done;",
  "exit 7",
].join(" ");

const runtime = makeRexSidecarRuntime({ locus: "docker", projectRoot, image });
const req = {
  command: "bash",
  args: ["-c", STUB],
  instructions: "stream me",
  cwd: projectRoot,
  env: { ...process.env, RATCHET_BATCH_NAME: "e2e-docker" },
};

const start = Date.now();
const stamps = [];
// Generous timeout: a cold venv build + image pull + container start can be slow.
const timer = setTimeout(() => { console.error("TIMEOUT"); process.exit(3); }, 300000);

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
  rmSync(projectRoot, { recursive: true, force: true });

  const lines = stamps.map((s) => s.line);
  const markerLine = lines.find((l) => l.startsWith("MARKER="));
  if (!markerLine) { console.error("no in-container MARKER observed"); process.exit(4); }
  const containerHostname = markerLine.slice("MARKER=".length).trim();
  if (!containerHostname) { console.error("empty container hostname"); process.exit(5); }
  if (containerHostname === hostHostname) {
    console.error(`marker matches HOST hostname (${hostHostname}) — not proven in-container`);
    process.exit(6);
  }

  const dataLines = stamps.filter((s) => /^line-\d$/.test(s.line));
  if (dataLines.length < 4) { console.error(`only ${dataLines.length} data lines streamed`); process.exit(7); }
  const spread = dataLines[dataLines.length - 1].t - dataLines[0].t;
  if (spread < 2000) { console.error(`lines bunched (spread=${spread}ms)`); process.exit(8); }

  if (result.exitCode !== 7) { console.error(`exit code not captured (got ${result.exitCode})`); process.exit(9); }
  if (!result.stdout.includes("line-1") || !result.stdout.includes("line-5")) {
    console.error("accumulated transcript missing streamed lines"); process.exit(10);
  }

  console.error(`container=${containerHostname} host=${hostHostname} spread=${spread}ms exitCode=${result.exitCode}`);
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
  echo "PASS: a step ran INSIDE the container (marker differs from host), streamed incrementally, and the exit code was captured"
  exit 0
fi
fail "ReX-docker container plumbing did not complete cleanly (rc=$RC)"
