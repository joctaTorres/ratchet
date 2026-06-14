# rex-local-agent-runtime

## Why

`batch apply` runs a coding agent through `realSpawner` (`src/core/batch/engine/agent.ts:144`),
which accumulates stdout into a string that never reaches the terminal — a silent
multi-minute wait with no signal of progress. The `python-sidecar-bootstrap` change
(already merged on `batch`) shipped the Python ReX substrate (`runtime/sidecar.py`)
and its bootstrap (`runtime/rex-bootstrap.ts`), but nothing on the Node side drives
it. This change adds the Node-side `AgentRuntime` that drives the sidecar and wires
it into the engine, ending the silent-run UX with RAW live line-by-line streaming.
This is the second and final change of Phase 2 ("rex-local-runtime").

## What Changes

- Add an **`AgentRuntime`** seam beside `Spawner` (`runtime/contract.ts`): an
  injectable interface `run(req, onEvent): Promise<AgentSpawnResult>` that both
  STREAMS `AgentEvent`s live and returns the accumulated `AgentSpawnResult`, so
  `mapSessionToOutcome` is unchanged. Implements the behaviors in
  `features/agent-runtime/transcript-and-exit.feature` and
  `features/agent-runtime/live-streaming.feature`.
- Add **`RexSidecarRuntime`** (`runtime/rex-sidecar-runtime.ts`) implementing
  `AgentRuntime`: resolves the launch descriptor via `bootstrapRexRuntime` from
  `rex-bootstrap.ts`, spawns the sidecar child, drives the JSON-lines lifecycle
  (`ready` → one `run` op → `stdout` events → `exit` → `shutdown` → `closed`),
  surfaces `error` events as failures, and tears the child down on
  completion/abort/timeout. Implements `features/locus/local-default.feature` and
  `features/agent-runtime/error-handling.feature`.
- Add **prompt-to-agent-via-file** delivery: the sidecar runs a shell command (not
  stdin), so the runtime writes step instructions to a temp prompt file under
  `.ratchet/batches/<batch>/.run/<id>/prompt.txt` and builds a run command that
  feeds the file to the agent. The claude adapter argv stays PLAIN (RAW streaming —
  no `--output-format stream-json`). Implements
  `features/agent-runtime/prompt-delivery.feature`.
- Add a **config-selected execution locus** (`execution`/`locus`, default `local`)
  resolved through `config.ts` (+ optional manifest override via
  `BatchSettingsOverrideSchema`). `local` → `RexSidecarRuntime` with
  `REX_LOCUS=local`. Implements `features/locus/local-default.feature`.
- **Engine wiring + RAW live output**: route `runStep` through the `AgentRuntime`
  when the locus selects ReX, passing an `onEvent` that PRINTS each stdout line as
  it arrives while still accumulating into `AgentSpawnResult`. Keep
  `RATCHET_BATCH_AGENT_CMD` working — but flow it THROUGH the runtime so the
  streaming path is exercised. Preserve the direct-spawn `Spawner` as a documented
  fallback seam for one release. Implements
  `features/agent-runtime/override-and-fallback.feature`.
- Add the **phase proof-of-work** `test/e2e/rex-local-stream.sh` (this change owns
  creating it) plus unit tests that mock the sidecar child / inject a fake runtime
  so they need no Python.

## Design

### The `AgentRuntime` contract (new seam beside `Spawner`)

Defined in `src/core/batch/engine/runtime/contract.ts`:

```ts
export interface AgentEvent {
  kind: 'stdout' | 'exit' | 'error';
  line?: string;       // present for kind 'stdout'
  exitCode?: number;   // present for kind 'exit'
  message?: string;    // present for kind 'error'
}
export type AgentRuntime = (
  req: AgentSpawnRequest,
  onEvent: (e: AgentEvent) => void
) => Promise<AgentSpawnResult>;
```

`AgentSpawnRequest`/`AgentSpawnResult` are reused unchanged from `agent.ts` (lines
29-44). The runtime accumulates every `stdout` line into `result.stdout` (newline-
joined) AND forwards it to `onEvent` as it arrives. `exitCode` is taken from the
`exit` event; a sidecar `error` event becomes a rejected promise (or a result with a
non-null `exitCode` and the message captured in `stderr`) so the engine maps it to a
blocked outcome. The seam is injectable exactly like `Spawner` (a function type), so
unit tests pass a fake runtime and never start Python.

### Sidecar lifecycle / process management (`RexSidecarRuntime`)

`makeRexSidecarRuntime(opts)` returns an `AgentRuntime`. Per `run`:

1. Resolve the launch descriptor with `bootstrapRexRuntime({ locus, workdir, ... })`
   from `rex-bootstrap.ts` — returns `{ command, args, env }` (`ResolvedLaunch`).
   DO NOT re-bootstrap; reuse this lazy/cached/idempotent path. A missing Python
   throws `RexBootstrapError` with the install remedy (surfaced as a failed step).
2. `spawn(command, args, { env, stdio: ['pipe','pipe','pipe'] })`. Set `REX_LOCUS`
   from config and `REX_WORKDIR` to the project root (passed into `bootstrapRexRuntime`'s
   `locus`/`workdir`, which set those env vars).
3. Parse stdout as newline-delimited JSON (same wire the e2e bootstrap harness uses
   in `test/e2e/rex-sidecar-bootstrap.sh`): buffer, split on `\n`, `JSON.parse` each
   non-empty line. Drive the state machine:
   - `{"event":"ready","locus":...}` → send `{"op":"run","id":N,"command":"<runCmd>"}`.
   - `{"event":"stdout","id":N,"line":...}` → forward as `AgentEvent{kind:'stdout'}`
     and append to accumulated stdout.
   - `{"event":"exit","id":N,"exit_code":N}` → record exit code, emit
     `AgentEvent{kind:'exit'}`, then send `{"op":"shutdown"}`.
   - `{"event":"closed"}` → resolve with the accumulated `AgentSpawnResult`.
   - `{"event":"error",...}` → emit `AgentEvent{kind:'error'}` and fail the run.
4. Teardown: on resolve/reject/abort/timeout, end stdin and `child.kill()` (escalate
   to SIGKILL after a grace window) so no sidecar is orphaned. A configurable timeout
   guards against a hung child (mirrors the 90s timeout in the bootstrap e2e harness).

The child spawn, fs writes, and clock are injectable seams (like `BootstrapDeps` in
`rex-bootstrap.ts`) so unit tests drive a fake child emitting canned JSON lines.

### Prompt-to-agent via a temp file

The sidecar runs a SHELL COMMAND STRING and does NOT pipe stdin to the agent
(`sidecar.py` docstring + `run()`), and the claude adapter expects the prompt on
stdin (`passOnStdin: true`, `agent.ts:97`). Bridge: the runtime writes
`request.instructions` to `.ratchet/batches/<batch>/.run/<id>/prompt.txt` under the
project root, then builds the `run` command so the agent reads the file. Decision:
use `cat <promptfile> | <agent argv>` (pipe), which works uniformly for any agent
that reads a prompt on stdin (claude, codex, gemini, cursor) — keeping the
multi-agent contract. The agent argv comes from the resolved adapter (PLAIN, e.g.
`claude -p`) — RAW streaming, no `stream-json` (that is phase 3). The prompt file is
removed in a `finally` after the run completes or fails.

When `RATCHET_BATCH_AGENT_CMD` is set, the `AgentSpawnRequest` already carries
`command: 'bash', args: ['-c', override]` (`engine.ts:185`); the runtime builds the
run command the same way (`cat promptfile | bash -c '<override>'`) so the override
also receives instructions and flows through the streaming path.

### Config locus resolution

Add `locus` to `BatchSettings` (`config.ts`) with `DEFAULT_BATCH_SETTINGS.locus =
'local'`, register it in `SETTING_KEYS` and `ALLOWED_VALUES` (`['local']` for now —
`docker`/`remote` are later phases; the enum is the clean extension point). Add the
matching optional field to `BatchSettingsOverrideSchema` in `manifest.ts` (keeps
`.strict()` valid for per-manifest override). `resolveBatchSettings` already iterates
`SETTING_KEYS`, so the new key resolves defaults ← project ← manifest with no extra
logic. Thread the resolved `locus` into `ResolvedStepContext.settings` (already
`BatchSettings`, contract.ts:27) — no contract change needed.

### Engine routing + onEvent printing

In `engine.ts`, add an injectable `runtime?: AgentRuntime` to `EngineDeps` and a
locus→runtime selector. `runStepLocked` (`engine.ts:89`) builds `request` as today
via `buildSpawnRequest` (unchanged — it still honors `RATCHET_BATCH_AGENT_CMD` then
the adapter), then, when the locus selects ReX (`local`), calls
`this.runtime(request, onEvent)` instead of `this.spawner(request)` at `engine.ts:134`.
The `onEvent` callback writes each `stdout` line to the terminal (a thin printer seam,
injectable so tests assert without real stdout). The resulting `AgentSpawnResult`
flows into `mapSessionToOutcome` exactly as before. The default `runtime` is the
`RexSidecarRuntime`; `realSpawner`/`Spawner` stay wired as the documented fallback
seam for one release (selectable but not default). Per the ReX-everywhere decision,
default local = ReX-local, with `rex-bootstrap`'s actionable error if Python is absent.

### Testability without Python

`AgentRuntime` is a function-type seam injected into the engine (like `Spawner`),
and `RexSidecarRuntime`'s child-spawn/fs/clock are injected seams. Unit tests use a
fake runtime or a fake child emitting canned JSON lines; only `test/e2e/rex-local-stream.sh`
touches real Python and it SKIPs explicitly when Python/swe-rex are unavailable
(mirroring the SKIP discipline in `test/e2e/rex-sidecar-bootstrap.sh`).

### Out of scope (later phases, leave extension points only)

stream-json rich rendering (phase 3), Docker locus (phase 4), remote/REST runtime
(phase 5). The locus enum and the `AgentRuntime` selector are the extension points;
do not build those loci here.

## Tasks

- [ ] 1.1 Define `AgentEvent` and the `AgentRuntime` function-type seam in `src/core/batch/engine/runtime/contract.ts`, reusing `AgentSpawnRequest`/`AgentSpawnResult` from `agent.ts`.
- [ ] 1.2 Unit-test the contract shape: a fake `AgentRuntime` streams `stdout` events and returns an accumulated `AgentSpawnResult` (satisfies `features/agent-runtime/transcript-and-exit.feature`).
- [ ] 2.1 Add `locus` to `BatchSettings` in `config.ts` (default `local`), register it in `SETTING_KEYS` and `ALLOWED_VALUES` (`['local']`), and confirm `resolveBatchSettings` resolves it defaults ← project ← manifest.
- [ ] 2.2 Add the optional `locus` field to `BatchSettingsOverrideSchema` in `manifest.ts`, keeping `.strict()` valid.
- [ ] 2.3 Unit-test locus resolution: default → `local` (source `default`), project value (source `project`), manifest override (source `manifest`) — satisfies `features/locus/local-default.feature` (first two scenarios).
- [ ] 3.1 Implement the prompt-to-agent temp-file mechanism: write `request.instructions` to `.ratchet/batches/<batch>/.run/<id>/prompt.txt` and build the run command `cat <promptfile> | <agent argv>`; remove the file in `finally`.
- [ ] 3.2 Unit-test prompt delivery and cleanup, and that the override command (`bash -c <override>`) also receives the prompt via the file (satisfies `features/agent-runtime/prompt-delivery.feature`).
- [ ] 4.1 Implement `RexSidecarRuntime` in `src/core/batch/engine/runtime/rex-sidecar-runtime.ts`: resolve launch via `bootstrapRexRuntime` (locus + project-root workdir), spawn the child, parse JSON-lines, drive ready→run→stdout→exit→shutdown→closed, with injected child/fs/clock seams.
- [ ] 4.2 Stream `stdout` events to `onEvent` AND accumulate into `AgentSpawnResult`; take `exitCode` from the `exit` event (satisfies `features/agent-runtime/live-streaming.feature` and `transcript-and-exit.feature`).
- [ ] 4.3 Surface a sidecar `error` event as a failed run, and propagate `RexBootstrapError` (missing Python) as a failure with its actionable message (satisfies `features/agent-runtime/error-handling.feature`).
- [ ] 4.4 Implement teardown: end stdin, `child.kill()` with SIGKILL escalation, and a configurable timeout so no sidecar is orphaned on completion/abort/timeout.
- [ ] 4.5 Unit-test `RexSidecarRuntime` against a fake child emitting canned JSON lines (ready/stdout/exit/closed, and an error case) — no real Python.
- [ ] 5.1 Add `runtime?: AgentRuntime` and an injectable line-printer to `EngineDeps`; default `runtime` to `RexSidecarRuntime`.
- [ ] 5.2 Add a locus→runtime selector and route `runStepLocked` through `this.runtime(request, onEvent)` when the locus selects ReX, passing an `onEvent` that prints each stdout line live; keep `mapSessionToOutcome` unchanged.
- [ ] 5.3 Ensure `RATCHET_BATCH_AGENT_CMD` (and a blank override = unset) flows through the runtime streaming path; preserve `realSpawner`/`Spawner` as a documented fallback seam for one release (satisfies `features/agent-runtime/override-and-fallback.feature`).
- [ ] 5.4 Unit-test engine routing with an injected fake runtime: stdout lines are printed live, the override runs through the runtime, and the accumulated result reaches `mapSessionToOutcome` — no Python.
- [ ] 6.1 Create the phase proof-of-work `test/e2e/rex-local-stream.sh`: drive a step (via `ratchet batch apply` or the runtime directly) with a STUB agent emitting one line/second for ~5 lines; assert lines arrive INCREMENTALLY (timestamps spread, not bunched) and the final exit code is captured.
- [ ] 6.2 Make the e2e SKIP explicitly (print SKIP, exit 0) when Python/swe-rex prereqs are unavailable, mirroring `test/e2e/rex-sidecar-bootstrap.sh`; never a silent pass.
- [ ] 6.3 Run `bash test/e2e/rex-local-stream.sh` and the batch-engine unit suite (`pnpm vitest run test/batch-engine`) green to satisfy the phase gate.
