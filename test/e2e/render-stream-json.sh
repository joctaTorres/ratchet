#!/usr/bin/env bash
#
# Proof-of-work for the `stream-json-rich-renderer` change (Phase 3 gate).
#
# Two parts:
#   1) CANNED (always runs, no external deps): replay a fixed NDJSON fixture —
#      including a deliberately MALFORMED line — through the GENERIC stream-json
#      renderer (the compiled dist module), capturing the rendered transcript to
#      a file for the llm-judge. Asserts the transcript streams assistant prose,
#      labeled tool calls with targets, a concise/error tool result, and a final
#      success summary, and that the malformed line degraded to RAW without
#      crashing the run.
#   2) LIVE (best-effort): if `claude` is installed, do one tiny real
#      `--output-format stream-json` capture and render it too, proving the
#      renderer matches the REAL event schema. SKIPs (explicit SKIP line, exit 0)
#      when claude/Python/network/auth is absent — never a silent pass.
#
# Mirrors test/e2e/rex-local-stream.sh.
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

skip() { echo "SKIP: $*"; exit 0; }
fail() { echo "FAIL: $*"; exit 1; }

FIXTURE="test/e2e/fixtures/stream-json-sample.ndjson"
RENDERER_JS="dist/core/batch/engine/runtime/stream-json-renderer.js"
ARTIFACT_DIR="${TMPDIR:-/tmp}"
ARTIFACT="$ARTIFACT_DIR/render-stream-json.rendered.txt"

[ -f "$FIXTURE" ] || fail "fixture missing: $FIXTURE"

# --- Ensure the built dist renderer module exists (renderer resolves compiled) -
if [ ! -f "$RENDERER_JS" ]; then
  echo "dist not built — running build first..."
  node build.js >/dev/null 2>&1 || fail "build failed"
fi
[ -f "$RENDERER_JS" ] || fail "$RENDERER_JS missing after build"

# --- Part 1: CANNED replay through the renderer -------------------------------
# Force color OFF so the captured artifact is plain text the judge can read, and
# so assertions match on literal substrings. (chalk honors FORCE_COLOR=0.)
echo "Replaying canned NDJSON fixture through the stream-json renderer..."
FORCE_COLOR=0 node --input-type=module -e '
import { readFileSync } from "node:fs";
import { makeStreamJsonRenderer } from "./dist/core/batch/engine/runtime/stream-json-renderer.js";

const fixture = process.argv[1];
const artifact = process.argv[2];
const ndjson = readFileSync(fixture, "utf-8");

const out = [];
const renderer = makeStreamJsonRenderer((line) => out.push(line));

// Feed the fixture line-by-line WITH trailing newlines, exactly as the engine
// feeds onEvent stdout lines through the renderer.
for (const line of ndjson.split("\n")) {
  if (line.length === 0) continue;
  renderer.handleLine(line + "\n");
}
renderer.flush();

const text = out.join("\n") + "\n";
import("node:fs").then((fs) => fs.writeFileSync(artifact, text));
process.stdout.write(text);
' "$FIXTURE" "$ARTIFACT"
RC=$?
[ $RC -eq 0 ] || fail "renderer threw while replaying the canned fixture (rc=$RC)"
[ -f "$ARTIFACT" ] || fail "rendered transcript artifact was not written"

echo
echo "Rendered transcript captured at: $ARTIFACT"
echo "--- asserting the rendered transcript ---"

assert_contains() {
  grep -qF -- "$1" "$ARTIFACT" || fail "rendered transcript missing expected content: $1"
  echo "  ok: contains \"$1\""
}
assert_absent() {
  if grep -qF -- "$1" "$ARTIFACT"; then fail "rendered transcript should NOT contain raw JSON: $1"; fi
  echo "  ok: absent \"$1\""
}

# Assistant prose (streamed via deltas, emitted once).
assert_contains "I will add a guard clause to login()."
# Labeled tool calls with their targets.
assert_contains "Edit"
assert_contains "src/auth/login.ts"
assert_contains "Bash"
assert_contains "pnpm test auth"
# Unknown tool still renders a labeled line (generic fallback).
assert_contains "SomeFutureTool"
# Tool results: concise + error-marked.
assert_contains "File edited: src/auth/login.ts"
assert_contains "1 test failed"
# Final summary indicates success and surfaces a usage/cost figure.
assert_contains "success"
assert_contains "Added guard clause to login()"
# The malformed line degraded to RAW (printed verbatim), proving no crash.
assert_contains "this is not valid json"
# Rendering, not raw NDJSON: the structured assistant event braces are NOT dumped.
assert_absent '"type":"assistant"'

echo "PASS: canned NDJSON rendered to a polished transcript (malformed line degraded to raw, no crash)"

# --- Part 2: LIVE real-claude render (best-effort) ----------------------------
if ! command -v claude >/dev/null 2>&1; then
  skip "claude CLI not installed — live stream-json render skipped (canned render PASSED)"
fi

LIVE_NDJSON="$ARTIFACT_DIR/render-stream-json.live.ndjson"
LIVE_ERR="$ARTIFACT_DIR/render-stream-json.live.err"
echo
echo "claude found — attempting one tiny live stream-json capture..."
# Use a timeout wrapper when one is available (not present on stock macOS).
TIMEOUT=""
if command -v timeout >/dev/null 2>&1; then TIMEOUT="timeout 120";
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT="gtimeout 120"; fi
printf 'Reply with exactly: hello' | $TIMEOUT claude -p --output-format stream-json --verbose --include-partial-messages > "$LIVE_NDJSON" 2>"$LIVE_ERR"
LRC=$?
if [ $LRC -ne 0 ] || [ ! -s "$LIVE_NDJSON" ]; then
  rm -f "$LIVE_NDJSON" "$LIVE_ERR"
  skip "live claude capture unavailable (rc=$LRC; likely auth/network/cost) — canned render PASSED"
fi

LIVE_ARTIFACT="$ARTIFACT_DIR/render-stream-json.live.rendered.txt"
FORCE_COLOR=0 node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
import { makeStreamJsonRenderer } from "./dist/core/batch/engine/runtime/stream-json-renderer.js";
const ndjson = readFileSync(process.argv[1], "utf-8");
const out = [];
const r = makeStreamJsonRenderer((l) => out.push(l));
for (const line of ndjson.split("\n")) { if (line) r.handleLine(line + "\n"); }
r.flush();
const text = out.join("\n") + "\n";
writeFileSync(process.argv[2], text);
process.stdout.write(text);
' "$LIVE_NDJSON" "$LIVE_ARTIFACT"
LIVE_RENDER_RC=$?
rm -f "$LIVE_NDJSON" "$LIVE_ERR"
[ $LIVE_RENDER_RC -eq 0 ] || fail "renderer threw on REAL claude stream-json output"

# The real run must produce a final summary (claude always emits a `result` event).
grep -qiE "success|error" "$LIVE_ARTIFACT" || fail "live render produced no summary line"
echo "Live rendered transcript captured at: $LIVE_ARTIFACT"
echo "PASS: real claude stream-json rendered cleanly through the same generic renderer"
exit 0
