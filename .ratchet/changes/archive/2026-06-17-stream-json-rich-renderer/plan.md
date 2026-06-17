# Plan: stream-json-rich-renderer

Phase 3 ("rich-stream-json-renderer") of the `rex-agent-runtime` batch — the
single change `stream-json-rich-renderer`. Phases 1–2 already stream RAW agent
stdout lines live to the terminal (`src/core/batch/engine/runtime/rex-sidecar-runtime.ts`
emits one `AgentEvent{kind:'stdout', line}` per line and `engine.ts:197-199`
prints each line via `this.printLine`). This change makes that output BEAUTIFUL.

## Why

Today every agent line is printed raw. Once the claude adapter switches to
`--output-format stream-json`, each line is an NDJSON event, and raw printing
would dump JSON at the user. We switch claude to structured stream-json and
render those events — assistant text, tool calls (with target), tool results,
and a closing summary — as polished, real-time terminal output, while keeping
every other adapter on raw streaming and never crashing on unexpected output.

## What Changes

- **Claude adapter switches to stream-json** in `src/core/batch/engine/agent.ts`:
  argv becomes `['-p','--output-format','stream-json','--verbose','--include-partial-messages']`
  and the adapter is marked **stream-json-capable**. codex/gemini/cursor argv are
  unchanged and remain non-capable (raw). Implements
  `features/stream-json-renderer/capability-gating.feature`.
- **New renderer module** `src/core/batch/engine/runtime/stream-json-renderer.ts`:
  a generic NDJSON renderer (NOT claude-special-cased) that consumes lines and
  emits polished terminal output for assistant text, tool_use, tool_result, and
  the result summary. Implements `assistant-text.feature`, `tool-calls.feature`,
  `tool-results.feature`, `final-summary.feature`, `graceful-degradation.feature`.
- **Engine routing** in `src/core/batch/engine/engine.ts`: when the resolved
  adapter is stream-json-capable, `onEvent` stdout lines feed the renderer
  instead of raw `printLine`; otherwise raw printing as today. The raw transcript
  accumulation in `AgentSpawnResult.stdout` is untouched. Implements
  `capability-gating.feature` + `transcript-untouched.feature`.
- **Phase proof-of-work** `test/e2e/render-stream-json.sh` (llm-judge): replays
  canned NDJSON fixtures (system/assistant-text/tool_use/tool_result/result +
  a malformed line) through the renderer and captures the rendered transcript to
  a file for the judge; a live-claude path that SKIPs when claude/Python absent.

## Design

### Adapter capability (tool-agnostic, per `multi-agent-support` standard)

The renderer must NOT be Claude-special-cased in shared code. We add an optional
boolean capability to the adapter contract — `AgentAdapter.emitsStreamJson?:
boolean` (or a small `capabilities` bag) in `agent.ts`. `CommandAgentAdapter`
takes the flag in its constructor; `BUILTIN_ADAPTERS.claude` sets it true,
others omit it (falsy). The engine asks the resolved adapter, never the agent
name, so any future stream-json agent reuses the same renderer by setting the
flag. The `RATCHET_BATCH_AGENT_CMD` override (a `bash -c` stand-in,
`engine.ts:249-252`) is NOT stream-json-capable → raw, keeping e2e/eval
deterministic.

### NDJSON event taxonomy handled

One JSON object per line. We branch on top-level `type`:
- `system` (subtype `init`): optional faint header (model/session). Non-fatal if
  absent.
- `assistant`: `message.content[]` items:
  - `{type:"text", text}` → streamed assistant prose.
  - `{type:"tool_use", name, input}` → a labeled tool-call line.
- `user`: `message.content[]` items `{type:"tool_result", content, is_error?}`
  → a concise, truncated result line (error-marked when `is_error`).
- `stream_event` (from `--include-partial-messages`): partial deltas. We read
  `content_block_delta` text deltas (`delta.text`/`delta.partial_json` shape) to
  stream assistant text incrementally; deltas we don't recognize are ignored
  (the full `assistant` message still renders). NOTE: exact partial schema is
  validated against real `claude` at apply (see open questions) — code defends
  with optional chaining and falls back to the full `assistant` message.
- `result` (subtype `success`/`error`): closing summary — `result` text plus a
  concise `usage`/`total_cost_usd` figure when present.
- anything else (unknown `type`, missing `type`, non-JSON) → raw fallback.

### Visual format (uses `chalk`, already a dependency; no new deps)

`chalk` and `ora` are already in `package.json`. We use `chalk` for color/dim;
`ora` is optional (a spinner during long tool runs) and may be deferred to keep
the slice thin — color-only is sufficient for the judge. Format:
- Assistant text: plain/default color, streamed inline (deltas appended without a
  newline until the message closes).
- Tool calls: a distinct glyph + bold tool name + dim target, one per line:
  - `✎ Edit src/foo.ts` (Edit/Write/MultiEdit → `file_path`)
  - `⚙ Bash pnpm test` (Bash → `command`)
  - `🔍 Grep <pattern>` (Grep/Glob → `pattern`/`query`)
  - generic `• <ToolName> <best-effort target>` for unfamiliar tools.
  Target extraction is a small lookup keyed by tool name with a generic
  fallback (first string-valued input field), so an unknown tool still renders.
- Tool results: dim `  ↳ <first line, truncated to ~200 chars / N lines>`;
  errors as red `  ↳ error: <…>`. Truncation appends `… (+N more)`.
- Summary: a rule line + `✔ success — <result>  (<usage/cost>)` (green) or
  `✘ error — <result>` (red).

### Engine routing

In `runStepLocked` (`engine.ts:196-200`) we resolve the adapter's
`emitsStreamJson`. When true, build a renderer instance and route
`onEvent` stdout lines through `renderer.handleLine(line)` (which itself calls
`this.printLine` for its formatted output so the existing injectable
`LinePrinter` seam — `engine.ts:45,62,110` — stays the single sink and tests can
assert it). On `exit`/end, call `renderer.flush()` to emit any buffered partial
and the summary. When false, the existing `this.printLine(e.line)` path is
unchanged. The renderer is constructed with the `LinePrinter` as its output sink,
keeping it decoupled from the engine and unit-testable with a fake sink.

### Partial / malformed handling & buffering

The sidecar runtime already splits on `\n` and emits one event per line
(`rex-sidecar-runtime.ts:282-297`), so the renderer normally receives whole
NDJSON lines. As a safety net the renderer keeps its own line buffer: `handleLine`
appends, splits on `\n`, processes complete lines, and retains a trailing
partial; `flush()` processes any retained partial as a final (raw if it doesn't
parse). Every parse/handle path is wrapped so a malformed line, an unknown type,
or a handler throw degrades to printing the raw line — never throws. The
`result` summary renders even if intermediate events were unparseable, because
each line is handled independently.

### Transcript-untouched guarantee

Rendering is display-only. The runtime accumulates raw NDJSON into
`AgentSpawnResult.stdout` independently of `onEvent` (`rex-sidecar-runtime.ts:252-256`),
and `mapSessionToOutcome` (`engine.ts:210-218`) consumes that accumulated result.
The renderer only writes to the `LinePrinter`; it never mutates the request,
the result, or the accumulated stdout. Covered by
`transcript-untouched.feature`.

## Tasks

- [x] 1.1 Add a stream-json capability to the adapter contract in `src/core/batch/engine/agent.ts` (`AgentAdapter.emitsStreamJson?`), thread it through `CommandAgentAdapter`'s constructor, and expose it from `resolveAdapter`'s returned adapter.
- [x] 1.2 Switch `BUILTIN_ADAPTERS.claude` argv to `['-p','--output-format','stream-json','--verbose','--include-partial-messages']` and mark it `emitsStreamJson: true`; leave codex/gemini/cursor argv unchanged and non-capable.
- [x] 1.3 Unit test (`test/batch-engine/agent.test.ts` or new): claude is stream-json-capable with the exact argv; codex/gemini/cursor are non-capable with unchanged argv (`capability-gating.feature` scenarios 1–2).
- [x] 2.1 Create `src/core/batch/engine/runtime/stream-json-renderer.ts` with a `makeStreamJsonRenderer(print: LinePrinter)` returning `{ handleLine(line), flush() }`; internal line buffer + per-line try/catch raw fallback.
- [x] 2.2 Implement `assistant` text rendering and `stream_event` partial-delta streaming (incremental), with the full-message fallback when deltas are absent (`assistant-text.feature`).
- [x] 2.3 Implement `tool_use` rendering: tool-name lookup → glyph + target extraction with a generic fallback for unknown tools (`tool-calls.feature`).
- [x] 2.4 Implement `tool_result` rendering: concise, truncated, error-marked (`tool-results.feature`).
- [x] 2.5 Implement `result` summary rendering (success/error, result text + usage/cost) and ensure `flush()` emits buffered partials and the summary (`final-summary.feature`).
- [x] 2.6 Implement graceful degradation: non-JSON, unknown `type`, and missing `type` print raw and never throw; flush emits a buffered partial line (`graceful-degradation.feature`).
- [x] 3.1 Unit tests for the renderer (`test/batch-engine/stream-json-renderer.test.ts`) driving canned NDJSON fixtures through a fake `LinePrinter`: assert formatted assistant text, tool-call lines (Edit/Bash/Grep/unknown), truncated/error results, and the success/error summary.
- [x] 3.2 Unit tests for malformed/unknown/missing-type → raw fallback (no throw) and partial-flush behavior.
- [x] 4.1 Wire routing in `src/core/batch/engine/engine.ts` `runStepLocked`: when the resolved adapter `emitsStreamJson`, route `onEvent` stdout lines through a renderer constructed with `this.printLine`, and `flush()` on exit/end; otherwise keep the raw `this.printLine(e.line)` path.
- [x] 4.2 Unit test (`test/batch-engine/engine.*.test.ts`): a capable adapter routes stdout through the renderer (assert formatted output via the injected `printLine`); a non-capable adapter prints raw lines unchanged; the renderer is not invoked for non-capable adapters (`capability-gating.feature` scenarios 3–4).
- [x] 4.3 Unit test: `AgentSpawnResult.stdout` and the value passed to `mapSessionToOutcome` are byte-identical with and without rendering (`transcript-untouched.feature`).
- [x] 5.1 Author canned NDJSON fixtures (system init, assistant text, assistant tool_use Edit/Bash, user tool_result, a malformed line, and a final result-success) under the change/test fixtures.
- [x] 5.2 Create the phase proof-of-work `test/e2e/render-stream-json.sh`: ALWAYS replay the canned fixtures through the renderer (no external deps) and capture the rendered transcript to a file for the judge; add a live-claude path that SKIPs (explicit SKIP line, exit 0) when `claude`/Python/built dist is absent. Pattern after `test/e2e/rex-local-stream.sh`.
- [x] 5.3 Run `pnpm build` then `bash test/e2e/render-stream-json.sh`; confirm the captured artifact streams assistant text, tool calls, tool results, and a final summary, and that the malformed line degraded to raw without crashing.
