# rex-remote-locus

## Why

Phases 1–4 gave the batch engine a config-selected `AgentRuntime` that drives
agents through the ReX Python sidecar for the `local` and `docker` loci, with
rich stream-json rendering. The final phase completes the "full ReX" surface:
`locus: remote` drives a `swerex-remote` server over its REST API from a NATIVE
NODE `fetch` client (no Python sidecar on the remote path — the Python lives on
the server), so agents can run on the operator's own infrastructure while
keeping identical live streaming and rich rendering. After this change the
`rex-agent-runtime` batch is complete.

## What Changes

- **New `RexRemoteRuntime`** (`src/core/batch/engine/runtime/rex-remote-runtime.ts`)
  implementing the existing `AgentRuntime` seam
  (`runtime/contract.ts`) via native `fetch`. It health-checks, creates a
  session, writes the prompt onto the SERVER filesystem, launches the agent to a
  server-side logfile, tail-polls that logfile over repeated `POST /execute`
  calls emitting incremental `stdout` `AgentEvent`s, reads an exit-code
  sentinel, and closes the session/runtime. Implements
  `features/remote-locus/run-step-over-rest.feature`,
  `incremental-streaming.feature`, `prompt-delivery-on-server.feature`,
  `auth-and-connection-errors.feature`.
- **Config**: add `remote` to `LOCUS_VALUES` (`src/core/batch/config.ts`), the
  manifest `locus` enum (`src/core/batch/manifest.ts`, kept `.strict()`), and
  the `project-config.ts` `batch.locus` enum. Add flat optional `host`,
  `port`, `authToken` settings (in `BatchSettings`, `SETTING_KEYS`,
  `ALLOWED_VALUES`, `DEFAULT_BATCH_SETTINGS` resolution, manifest +
  project-config schemas) with validation: `remote` requires all three; reject
  empty host/token and non-numeric port. `local`/`docker` are unaffected.
  Implements `features/remote-locus/config-and-validation.feature`.
- **Engine wiring**: extend `selectRuntime` (`src/core/batch/engine/engine.ts`)
  so `locus: remote` returns a `RexRemoteRuntime` built from the resolved
  host/port/authToken; `local`/`docker` keep selecting `makeRexSidecarRuntime`.
  The renderer, `onEvent` routing, and `mapSessionToOutcome` are unchanged —
  remote emits the SAME `AgentEvent`s, so stream-json rendering comes for free.
- **Proof-of-work** `test/e2e/rex-remote-locus.sh` (blackbox, live-runnable
  here): boot a local `swerex-remote` server from the bootstrapped venv with a
  known `--auth-token` on a free port, point `RexRemoteRuntime` at it, run a stub
  step asserting incremental streaming + captured exit code, then assert a bad
  token yields a clear auth error, then tear the server down. SKIPs explicitly
  when `swerex-remote` is unavailable. Implements
  `features/remote-locus/proof-of-work.feature`.

This change touches no agent-facing skills/commands/templates, so the
multi-agent surface is unchanged: the remote runtime is agent-agnostic and runs
whatever adapter argv the resolved agent produces (the prompt is fed on stdin via
`cat prompt | <argv>`, exactly like the sidecar runtime), so every supported
coding agent works over remote identically.

## Design

### The native-Node REST client (verified against the installed server)

Verified against `swerex 1.4.0` at
`~/.cache/ratchet/rex/venv/.../swerex/server.py` and `runtime/abstract.py`. The
`swerex-remote` console script exists and `--version` prints `1.4.0`. The
FastAPI app exposes (all `POST` unless noted), and the runtime uses these:

- `GET /is_alive` → `IsAliveResponse {is_alive: bool, message: str}` — health check.
- `POST /create_session` (`CreateBashSessionRequest {session:"default", startup_source:[]}`)
  → creates the bash session the agent runs in.
- `POST /execute` (`Command`) → `CommandResponse {stdout, stderr, exit_code}`.
  `Command.command` may be `str | list[str]`; with `shell: true` a string is run
  through the shell (needed for pipelines/redirection like `cat … | argv` and
  `tail -c +<offset>`). This is the workhorse for launch + tail-poll.
- `POST /write_file` (`WriteFileRequest {content, path}`) → writes the prompt
  onto the SERVER filesystem.
- `POST /close_session` (`CloseSessionRequest {session:"default"}`) and
  `POST /close` → teardown.

Auth: a global middleware checks header `X-API-Key` against the server's
`--auth-token` when one is set; a mismatch returns `401 {"detail":"Invalid API
Key"}`. Optional `X-Request-ID` enables idempotent retries (last-response cache).
Uncaught runtime exceptions return `511 {"swerexception":{message, class_path,
traceback}}`; HTTP errors (e.g. 401) return `{"detail": …}`. The client maps both
shapes to readable messages.

### Streaming via launch-to-logfile + tail-poll over /execute

ReX is request/response — there is NO SSE/streaming endpoint (confirmed: no
streaming route in `server.py`; the batch spike already established this). The
runtime reproduces the sidecar's launch-to-logfile + tail-poll trick, but over
REST in Node:

1. Choose server-side paths under a tmp run dir, e.g.
   `/tmp/ratchet-rex/<runId>/{prompt.txt, agent.log, exit.code}`.
2. `POST /write_file` the instructions to `prompt.txt` on the server.
3. Launch (non-blocking) via one `POST /execute` with `shell:true` running
   `sh -c '( cat <prompt> | <argv> ) >agent.log 2>&1; echo $? >exit.code' &`
   so `/execute` returns immediately while the agent keeps running server-side.
   (`Command.cwd` sets the working dir; argv is `shquote`d exactly like the
   sidecar's `buildRunCommand`.)
4. Tail-poll loop (~300ms, matching the sidecar cadence): repeated
   `POST /execute` of `tail -c +<offset+1> agent.log` (1-based, like the spike's
   `tail -c +<offset>`), advancing a byte offset; split new bytes into complete
   lines, emit each as `AgentEvent{kind:'stdout'}` AND accumulate into `stdout`.
   A trailing partial line is held until its newline arrives.
5. Termination: each poll also reads `exit.code` (via `/execute` `cat exit.code`
   or `/read_file`); once present, drain the final logfile tail, emit
   `AgentEvent{kind:'exit', exitCode}`, then `POST /close_session` + `POST /close`.
6. Resolve `AgentSpawnResult {exitCode, signal:null, stdout, stderr}` — the SAME
   shape the engine already maps, so `mapSessionToOutcome` is untouched.

This reproduces `makeRexSidecarRuntime`'s emit/accumulate semantics exactly, so
the engine's `onEvent` (raw print OR stream-json renderer) and outcome mapping
work without any change — rich rendering is free.

### Prompt delivery on the SERVER filesystem

The remote FS is the server's, not the host's, so (unlike the sidecar, which
writes a host temp file) the prompt is written via `POST /write_file` to a
server path, and the launch command `cat`s that SERVER path. No host prompt file
and no host-to-container path mapping is involved (that was the docker concern).

### Auth / connection error mapping

Mapped to the existing error-result path (mirroring `RexBootstrapError` in the
sidecar runtime): a failure resolves with a non-zero `exitCode` and a clear
message in `stderr`, and an `AgentEvent{kind:'error'}` is emitted, so the engine
maps it to blocked/failed with no new outcome states:

- `401` / missing token → `"Remote agent auth failed (401) at <host>:<port>:
  Invalid API Key — check authToken"`.
- `fetch` reject / `AbortController` timeout on the initial `/is_alive` →
  `"swerex-remote server unreachable at <host>:<port>"` (bounded so it never
  hangs).
- `swerexception` body → surface `message` (and `class_path`) readably.

The health check runs FIRST with a short timeout so an unreachable server fails
fast with an actionable message rather than hanging mid-run.

### Config shape — flat vs nested (recommendation: FLAT)

Per the locked decision, the default plan adds FLAT optional keys `host`,
`port`, `authToken` alongside the existing flat `locus`/`image`, keeping the
manifest schema `.strict()`. This minimizes churn and risk in the final phase and
stays consistent with the existing surface. The phase-4 change floated a nested
`execution:` namespace; that remains a reasonable FUTURE refactor (group
`locus`/`image`/`host`/`port`/`authToken` under `execution:` and migrate the flat
keys) — documented here as an open question, NOT done now, so existing flat keys
are not restructured. Recommendation: ship flat; revisit nesting as a dedicated
follow-up if the execution surface grows further.

`authToken` is a SECRET. It is validated as a non-empty string but is read from
config like any other setting; the plan does not add secret-redaction beyond not
echoing it in error messages (errors name host/port, never the token).

### Testability

The runtime takes `fetch` (and a `sleep`/clock) as an injectable seam (mirroring
`SidecarDeps`) so unit tests drive a mocked `fetch` through the full
health→create→write→launch→tail→exit→close sequence — incremental event emission,
transcript accumulation, auth-failure (401), connection-failure (reject/timeout),
and the swerexception path — with NO real server. Only `test/e2e/rex-remote-locus.sh`
boots a real local server, and it SKIPs cleanly when `swerex-remote` is absent.

## Tasks

- [x] 1.1 Add `remote` to `LOCUS_VALUES` and the `Locus` type in `src/core/batch/config.ts`; update the doc comment to drop "remote is a later phase".
- [x] 1.2 Add flat optional `host`, `port` (number), `authToken` to `BatchSettings`, `SETTING_KEYS`, `ALLOWED_VALUES` (free-form/null), and the `resolveBatchSettings` `sources` map in `config.ts`.
- [x] 1.3 Extend `validateSetting` (config.ts): non-empty `host`/`authToken`, numeric `port`; and a cross-field check that `locus: remote` requires host+port+authToken (surface as an actionable config error where settings are resolved/consumed).
- [x] 1.4 Add `remote` to the `locus` enum and add `host`/`port`/`authToken` to `BatchSettingsOverrideSchema` in `src/core/batch/manifest.ts`, keeping `.strict()`.
- [x] 1.5 Add `remote` to the `locus` enum and `host`/`port`/`authToken` to the `batch` schema in `src/core/project-config.ts`.
- [x] 1.6 Unit tests for config/manifest/project-config: `remote` accepted; flat keys parsed; strict schema still rejects unknown keys; remote-requires-host/port/token; empty/non-numeric rejected and file left unchanged.

- [x] 2.1 Create `src/core/batch/engine/runtime/rex-remote-runtime.ts` exporting `makeRexRemoteRuntime(options)` returning an `AgentRuntime`, with `RemoteDeps` (injectable `fetch`, `sleep`/clock) and options `{host, port, authToken, projectRoot?, timeoutMs?, pollIntervalMs?}`.
- [x] 2.2 Implement the typed REST client helpers (post/get with `X-API-Key`, JSON, bounded `AbortController` timeout) and map `401`/`{detail}` and `{swerexception}` bodies to readable error messages.
- [x] 2.3 Implement `GET /is_alive` health check first (short timeout); on reject/timeout resolve with the actionable "server unreachable" error result + emit `error` event.
- [x] 2.4 Implement `POST /create_session`, then `POST /write_file` of the prompt to a server-side run dir, then the non-blocking launch `/execute` (`sh -c '( cat prompt | argv ) >log 2>&1; echo $? >exit.code' &`) with `shquote`d argv.
- [x] 2.5 Implement the tail-poll loop over `POST /execute` (`tail -c +<offset+1> log`): advance the byte offset, split complete lines, emit incremental `stdout` events, accumulate the transcript, hold trailing partials.
- [x] 2.6 Detect the exit-code sentinel each poll; on completion drain the final tail, emit the `exit` event, then `POST /close_session` + `POST /close`; resolve `AgentSpawnResult`. Tear down (best-effort close) on timeout/abort too.
- [x] 2.7 Unit tests with mocked `fetch`: full health→create→write→launch→tail→exit→close sequence; incremental event emission; transcript accumulation; auth-failure (401); connection-failure (reject + timeout); swerexception body; teardown calls close. NO real server.

- [x] 3.1 Extend `selectRuntime` in `src/core/batch/engine/engine.ts`: `locus === 'remote'` → `makeRexRemoteRuntime` with resolved host/port/authToken; `local`/`docker` unchanged; keep `onEvent`/renderer/outcome routing untouched.
- [x] 3.2 Surface a missing remote config (host/port/token) as a failed outcome BEFORE any REST call (actionable message), consistent with the auth/connection error path.
- [x] 3.3 Unit test the engine wiring: `remote` selects the remote runtime (injected fake) and gets stream-json rendering via the existing renderer; `local`/`docker` still select the sidecar; missing remote config fails actionably.

- [ ] 4.1 Write `test/e2e/rex-remote-locus.sh` (blackbox): resolve a Python>=3.10 + the venv `swerex-remote` script; SKIP explicitly (exit 0) if genuinely unavailable; build dist if needed.
- [ ] 4.2 Boot a local `swerex-remote` server with a known `--auth-token` on a free port; wait for `/is_alive`; ensure teardown on exit (trap).
- [ ] 4.3 Drive a stub agent step through `RexRemoteRuntime` at `localhost:<port>`; assert output streamed incrementally (timestamp spread) + the exit code captured.
- [ ] 4.4 Assert a BAD token surfaces a clear auth error (non-zero result, message names host, no traceback/hang); tear the server down.

- [ ] 5.1 Run unit tests (`pnpm vitest run test/batch-engine`) and the live `bash test/e2e/rex-remote-locus.sh`; confirm both green on this machine.
- [ ] 5.2 Confirm `local`/`docker` proofs-of-work and existing tests still pass (no regression from the config/enum/engine changes).
