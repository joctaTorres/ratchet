---
title: Agent runtime (SWE-ReX)
sidebar_position: 4
---

# Agent runtime (SWE-ReX)

The agent runtime is the layer beneath the engine that actually spawns coding
agents. When the engine runs a step it selects exactly one runtime implementation
based on the resolved `locus` setting, then drives exactly one agent through that
runtime for the transition. The runtime is injected into the engine as a seam so
tests can supply a fake without starting Python.

Defined in `src/core/batch/engine/runtime/`.

## Runtime contract

Defined in `src/core/batch/engine/runtime/contract.ts`.

```ts
interface AgentEvent {
  kind: 'stdout' | 'exit' | 'error';
  /** Present for kind 'stdout' — one line of agent output (no trailing newline). */
  line?: string;
  /** Present for kind 'exit' — the agent's process exit code. */
  exitCode?: number;
  /** Present for kind 'error' — an actionable failure message. */
  message?: string;
}

type AgentRuntime = (
  req: AgentSpawnRequest,
  onEvent: (e: AgentEvent) => void
) => Promise<AgentSpawnResult>;
```

The spawn request and result types are defined in
`src/core/batch/engine/agent.ts`:

```ts
interface AgentSpawnRequest {
  command: string;
  args: string[];
  /** Instructions passed to the agent via stdin. */
  instructions: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

interface AgentSpawnResult {
  /** Process exit code (null if killed by signal). */
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}
```

`AgentRuntime` streams `AgentEvent`s live to the `onEvent` callback as the agent
runs and simultaneously accumulates the full `AgentSpawnResult` (stdout
newline-joined, exitCode from the exit event). A bootstrap failure or sidecar
`error` event resolves with a non-zero `exitCode` and the message in `stderr` —
no new outcome states — so the engine maps it to blocked/failed and the step
remains resumable.

## SWE-ReX sidecar

For the `local` and `docker` loci, ratchet bootstraps an isolated Python sidecar
(`sidecar.py`) that wraps SWE-ReX. The Node side manages the sidecar lifecycle;
the Python side drives the SWE-ReX deployment.

### Bootstrap (`rex-bootstrap.ts`)

`bootstrapRexRuntime` provisions a ratchet-owned virtual environment on first use
and returns a `ResolvedLaunch` (the command, args, and env to spawn the sidecar).
It is lazy and idempotent: a ready venv is reused without a rebuild.

```ts
interface ResolvedLaunch {
  /** The venv's Python interpreter (absolute path). */
  command: string;
  /** Arguments — the resolved sidecar.py path. */
  args: string[];
  /** Environment for the sidecar (REX_* passthrough + venv on PATH). */
  env: NodeJS.ProcessEnv;
}
```

Bootstrap behavior:

1. The venv lives at `$XDG_CACHE_HOME/ratchet/rex/venv` (falling back to
   `~/.cache/ratchet/rex/venv` when `XDG_CACHE_HOME` is unset). It never touches
   the user's global Python environment.
2. A JSON readiness marker (`.ratchet-rex-ready.json`) inside the venv dir is
   written last, after a successful import check. A missing or stale marker
   (wrong `sweRexVersion` or missing required extras) triggers a full rebuild
   after clearing the directory so no partial venv is mistaken for ready.
3. The pinned swe-rex version is `1.4.0` (`SWE_REX_VERSION`). A version change
   forces a rebuild.
4. `uv` is preferred for creating the venv and installing packages. When `uv`
   is not on PATH, bootstrap falls back to `python -m venv` and the venv's own
   pip.
5. Python candidates are probed in order — `python3`, `python`, `python3.12`,
   `python3.11`, `python3.10` — and the first interpreter that reports Python
   >= 3.10 is used. A `pythonOverride` skips the probe.
6. After install, bootstrap verifies `import swerex` succeeds from the venv
   interpreter before writing the marker. For the docker locus it additionally
   verifies `import swerex.deployment.docker`.
7. The venv's `bin` directory is prepended to `PATH` and `VIRTUAL_ENV` is set
   in the sidecar's environment.

Environment variables threaded to the sidecar:

| Variable | Set when | Value |
|---|---|---|
| `REX_LOCUS` | always | `'local'` or `'docker'` |
| `REX_WORKDIR` | always | project root (local) or `/workspace` (docker) |
| `REX_IMAGE` | docker only | configured image, or `DEFAULT_DOCKER_IMAGE` (`python:3.12`) |
| `REX_MOUNT_HOST` | docker only | project root (host path bind-mounted into the container) |
| `REX_MOUNT_CONTAINER` | docker only | `/workspace` (in-container mount point) |

### Sidecar process (`sidecar.py`)

The sidecar is a Python script driven over a newline-delimited JSON protocol on
stdio. It starts a SWE-ReX deployment (local or docker), runs shell commands
through it on demand, streams output back, and shuts down cleanly.

The sidecar suppresses SWE-ReX's Rich console logger before import
(`SWE_REX_LOG_STREAM_LEVEL=CRITICAL`) so no non-JSON output contaminates the
protocol channel.

**Node → sidecar (stdin):**

| Message | Effect |
|---|---|
| `{"op":"run","id":N,"command":"<shell>"}` | Launch the shell command, stream stdout, emit exit. |
| `{"op":"shutdown"}` | Stop the deployment and exit 0. |

**Sidecar → Node (stdout):**

| Event | Emitted when |
|---|---|
| `{"event":"ready","locus":"local"\|"docker"}` | Deployment started; emitted once before any `run` op. |
| `{"event":"stdout","id":N,"line":"..."}` | One complete line of command output. |
| `{"event":"exit","id":N,"exit_code":N}` | Command finished; exactly once per `run` op. |
| `{"event":"closed"}` | Clean shutdown complete. |
| `{"event":"error","id":N\|null,"message":"...",...}` | Any caught exception. |

Streaming model: the sidecar launches each shell command detached to a per-run
logfile and tail-polls that logfile at 300 ms intervals (`POLL_INTERVAL = 0.3`)
via the SWE-ReX `execute()` API. It advances a byte cursor over the logfile so
only new bytes are read each poll, and emits complete lines as `stdout` events.
The exit sentinel file signals completion; the sidecar drains any final bytes
before emitting the `exit` event.

## Execution loci

The `locus` setting selects the runtime implementation. The default locus is
`local`.

### `local` — `RexSidecarRuntime` (`rex-sidecar-runtime.ts`)

The local runtime bootstraps the SWE-ReX sidecar, spawns it as a child process,
and drives the JSON-lines protocol described above.

Prompt delivery: the agent's instructions are written to a temporary prompt file
at `.ratchet/batches/<batch>/.run/<id>/prompt.txt` on the host. The run command
sent to the sidecar is `cd <cwd>; cat <promptfile> | <agent argv>`. The prompt
file is removed after the run (in a `finally` block).

The overall run timeout is 10 minutes. On completion or timeout the sidecar
receives `SIGTERM` followed (after a 2 s grace) by `SIGKILL` if it has not
exited.

### `docker` — `RexSidecarRuntime` with `DockerDeployment`

The docker locus runs the same local sidecar but selects `DockerDeployment`
(via `REX_LOCUS=docker`). The project root is bind-mounted into the container
at `/workspace` (`DOCKER_MOUNT_CONTAINER`).

Additional behavior specific to the docker locus:

1. A `docker info` pre-flight runs before any venv work. A non-zero result
   throws `RexBootstrapError` immediately, so the run never hangs on
   SWE-ReX's own startup timeout.
2. The venv must carry the `docker` extra, which installs `aiohttp` explicitly.
   (`swe-rex` 1.4.0 does not declare `aiohttp` in its package metadata, but
   `swerex.deployment.docker` imports it at runtime.) A local-only venv is
   rebuilt the first time the docker locus is requested.
3. `REX_WORKDIR` is set to `/workspace` (the in-container path), not the host
   project root. The prompt file is written on the host and its path is
   translated to the in-container equivalent before it is passed to the sidecar.
4. `REX_IMAGE` is set to the configured `image`, or `DEFAULT_DOCKER_IMAGE`
   (`python:3.12`) when none is configured.

### `remote` — `RexRemoteRuntime` (`rex-remote-runtime.ts`)

The remote runtime drives an external `swerex-remote` server over its REST API
using the Node global `fetch`. No local Python sidecar is started; the Python
lives on the server.

Required settings: `host`, `port`, and `authToken`. The auth token is sent as
the `X-API-Key` request header and is never printed in any error message.

Transport scheme selection:

- A bare loopback host (`localhost`, `127.x.x.x`, `::1`) defaults to `http`.
- A bare non-local host defaults to `https`.
- An explicit `https://` prefix is honored.
- An explicit `http://` prefix to a non-local host is refused unless `insecure:
  true` is set in the settings.

The remote runtime reproduces the sidecar's tail-poll streaming over REST:

1. `GET /is_alive` — health check with a short per-request timeout (30 s default).
2. `POST /create_session` — create the bash session.
3. Write the prompt onto the server filesystem via `POST /execute` (mkdir + `POST /write_file`).
4. `POST /execute` (non-blocking) — detach the agent command to a logfile + exit sentinel.
5. `POST /execute` in a poll loop (300 ms default) — `tail -c +<offset+1>` to
   advance a byte cursor; emit `stdout` events as complete lines arrive.
6. Read the exit sentinel. Drain final bytes, emit `exit`, then close the session
   and runtime (`POST /close_session`, `POST /close`).

The overall run timeout is 10 minutes. A `swerexception` body on any response
is surfaced as an actionable `AgentEvent{kind:'error'}` with the engine mapped to
blocked/failed and no hang.

## Agent adapters

An adapter knows how to build the spawn request for one coding agent. The engine
resolves the adapter by name from the resolved settings before any spawn, and
throws `UnknownAgentError` (listing available adapters) when the name is not
registered.

The default agent when no adapter is configured is `claude`.

Built-in adapters:

| Agent | Command | Base args | Stream-JSON |
|---|---|---|---|
| `claude` | `claude` binary | `-p --output-format stream-json --verbose --include-partial-messages` | yes |
| `codex` | `codex` binary | `exec -` | no |
| `gemini` | `gemini` binary | `-p` | no |
| `cursor` | `cursor` binary | `-p` | no |

All adapters pass the agent instructions on stdin. The binary name for each
adapter is read from the `AI_TOOLS` registry in `src/core/config.ts`
(`agentBinary` field); the adapter code does not hardcode binary names. The same
registry drives `ratchet doctor`'s PATH checks, so the two cannot drift.

Permission flags resolved from the active policy (see
[Agent permissions](#agent-permissions) below) are appended to the base args
after the adapter's own argv.

## Streaming

Defined in `src/core/batch/engine/runtime/stream-json-renderer.ts`.

When an adapter's `emitsStreamJson` capability is `true`, the engine routes each
stdout line through `makeStreamJsonRenderer` rather than printing it raw. The
renderer parses one-event-per-line NDJSON (Claude's `--output-format stream-json`
format) and writes polished output to the engine's line printer. The gating is on
the adapter capability flag, not on the agent name, so any future adapter that
sets `emitsStreamJson: true` reuses the same renderer.

Event handling:

| Top-level `type` | Behavior |
|---|---|
| `system`, `rate_limit_event` | Recognized control noise; silently skipped. |
| `stream_event` | `content_block_delta` with `text_delta` → text streamed live and accumulated. |
| `assistant` | `text` items printed as prose; `tool_use` items printed with glyph + name + target field. |
| `user` | `tool_result` items printed (truncated to 200 chars / 3 lines; errors in red). |
| `result` | Closing summary line with success/error, token counts, and USD cost. |
| Unknown or non-JSON | Raw line printed as fallback; renderer never throws. |

The renderer never mutates the accumulated `AgentSpawnResult.stdout`; the raw
NDJSON transcript that `mapSessionToOutcome` reads is byte-identical with or
without rendering.

## Agent permissions

Defined in `src/core/batch/permissions-policy.ts` (policy schema and types) and
`src/core/batch/runtime/agent-permissions.ts` (per-agent translator).

### Policy shape

```ts
interface ResolvedPermissionsPolicy {
  posture: PermissionPosture;     // 'repo-sandboxed-permissive' | 'curated-allowlist' | 'full-autonomy'
  allow: string[];                // tool-pattern allowlist (agent-neutral)
  deny: string[];                 // tool-pattern denylist (agent-neutral)
  raw: Partial<Record<'claude' | 'codex' | 'gemini' | 'cursor', string[]>>;
}
```

The default posture is `repo-sandboxed-permissive`.

### Postures

- **`repo-sandboxed-permissive`** (default): edits and ordinary build/test shell
  commands run unprompted; the agent is scoped to the repo; a baseline denylist
  forbids destructive/exfiltrating operations.
- **`curated-allowlist`**: nothing runs unprompted except an explicit `allow`
  list; the deny list still applies. Operators must include a `Bash(...)` entry
  in `allow` or any shell step will stall headless.
- **`full-autonomy`**: all permission checks are bypassed.

### Baseline deny patterns (`repo-sandboxed-permissive`)

The following patterns are merged into the effective denylist for the sandboxed
and curated postures (not for `full-autonomy`):

```
Bash(rm -rf *)
Bash(sudo *)
Bash(* > /*)
Bash(curl * | sh)
Bash(curl * | bash)
Bash(wget * | sh)
Bash(wget * | bash)
```

### Per-agent flag translation

`resolvePermissionFlags(agentName, policy, repoRoot)` returns a concrete argv
fragment appended to each adapter's base args. The translation is pure (no I/O).

**claude:**

| Posture | Flags emitted |
|---|---|
| `repo-sandboxed-permissive` | `--permission-mode acceptEdits --add-dir <repoRoot> --allowedTools Bash [<allow>] --disallowedTools <deny>` |
| `curated-allowlist` | `--permission-mode default [--allowedTools <allow>] [--disallowedTools <deny>]` |
| `full-autonomy` | `--dangerously-skip-permissions` |

For `repo-sandboxed-permissive`, `--allowedTools` defaults to `['Bash']` when
the operator's `allow` list is empty. `acceptEdits` covers file edits only;
`Bash` must be explicitly allowed or headless shell calls are denied.

**gemini:**

| Posture | Flags emitted |
|---|---|
| `repo-sandboxed-permissive` | `--approval-mode auto_edit` |
| `curated-allowlist` | `--approval-mode default` |
| `full-autonomy` | `--yolo` |

Known limitation: gemini's `auto_edit` covers file edits only and does not
unblock headless shell calls. An argv-only bounded shell allowance is not
available for gemini (the `--allowed-tools` flag is deprecated; the Policy Engine
is file-based). The sandboxed mapping stays `auto_edit` — it may prompt or stall
on shell steps in headless mode.

**codex:**

| Posture | Flags emitted |
|---|---|
| `repo-sandboxed-permissive` | `--sandbox workspace-write --ask-for-approval never` |
| `curated-allowlist` | `--sandbox workspace-write --ask-for-approval on-request` |
| `full-autonomy` | `--full-auto` |

**cursor:**

| Posture | Flags emitted |
|---|---|
| `repo-sandboxed-permissive` | _(none — cursor's default per-action gating applies; a one-time warning is emitted)_ |
| `curated-allowlist` | _(none — same)_ |
| `full-autonomy` | `--force` |

cursor's allow/deny is config-file only and cannot be injected via argv; the
sandboxed and curated postures rely on cursor's built-in approval prompting.

### Raw override escape hatch

The `raw` field carries per-agent argv fragments appended after the posture-derived
flags for that specific agent. Entries for other agents are ignored. An
unrecognized agent name receives no posture flags but honors its `raw` entry.

### Batch config permissions feed-in

`batch config permissions` sets the `permissions` key in `.ratchet/config.yaml`
under the `batch:` section. The resolved policy from that config is merged with
the user/global scope and per-manifest scope before being injected into the spawn
request. See [batch command](../commands/batch.md).

## Settings resolution

Agent, locus, and image resolve across four scopes in increasing precedence:

```
built-in default ← user/global ← project config (.ratchet/config.yaml batch:) ← per-change manifest
```

Scalar settings (including `locus`, `agent`, `image`, `host`, `port`,
`authToken`, `insecure`) are nearest-wins. Permissions use per-field merge
semantics: posture nearest-wins, `deny` is the union of all scopes, `allow` is
replaced by the nearest defining scope, and each agent's `raw` entry is
nearest-wins.

Built-in defaults:

| Setting | Default |
|---|---|
| `locus` | `local` |
| `agent` | `claude` (via `DEFAULT_AGENT` when settings name none) |
| `image` | `python:3.12` (`DEFAULT_DOCKER_IMAGE`, docker locus only) |
| `permissions.posture` | `repo-sandboxed-permissive` |

For standalone (headless) steps the cascade is `flag → project config → default`
with no manifest scope. See [Standalone settings](./standalone-settings.md) and
[batch command](../commands/batch.md).

## Requirements

- **Agent CLI on PATH**: one of `claude`, `codex`, `gemini`, or `cursor` matching
  the configured `agent`. See [doctor](../commands/doctor.md), which probes each
  registered agent binary.
- **Python >= 3.10**: required for the `local` and `docker` loci. Bootstrap
  probes `python3`, `python`, `python3.12`, `python3.11`, `python3.10` in order.
  `uv` is preferred for venv creation and package install; it falls back to
  `python -m venv` + pip when `uv` is not available.
- **Docker daemon**: required for `locus: docker` only. The bootstrap runs a
  `docker info` pre-flight before any other work; a non-zero result surfaces as
  an actionable error.
- No local Python is required for `locus: remote`; all Python runs on the remote
  server.

See [doctor](../commands/doctor.md) for the full runtime requirements check.
