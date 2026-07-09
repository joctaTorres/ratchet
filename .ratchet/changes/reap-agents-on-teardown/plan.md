# reap-agents-on-teardown

## Why

Teardown today never reaps the agent, only its transport: the sidecar path SIGTERMs
the Python child while the agent it launched via a bare `nohup … &` keeps running,
the remote path closes the session leaving the nohup'd server-side agent alive, and
`realSpawner` waits forever on a hung agent. Timed-out runs also litter
`ratchet-rex-<token>.log/.done` sentinels at the workdir root (the repository root
for the local locus). Fixes #79.

## What Changes

Implements `features/teardown-reaping/process-group-launch.feature`,
`features/teardown-reaping/teardown-kills-agent.feature`, and
`features/teardown-reaping/sentinel-hygiene.feature`.

- `sidecar.py` launches the agent as a process-group leader (job control, `set -m`)
  and records its pid to a pidfile in the run directory; `shutdown` kills that group
  (TERM → short grace → KILL) before stopping the deployment, and a new SIGTERM
  handler stops the deployment (docker container included) instead of dying silently.
- The `run` op gains an optional `run_dir` field; the Node sidecar runtime passes its
  existing `.ratchet/batches/<batch>/.run/<id>/` directory (docker: translated onto
  the bind mount) and the sidecar writes its `ratchet-rex-<token>.log/.done` sentinels
  and the new pidfile there instead of the workdir root. Absent `run_dir` falls back
  to the current workdir behaviour.
- `RexSidecarRuntime` teardown on ALL paths (overall timeout, error, clean shutdown)
  sends `{op:"shutdown"}` first, then after `killGraceMs` SIGKILLs the sidecar's
  process group (child spawned `detached: true`); the run-dir sweep (already in
  `finish()`) now also removes the sentinels/pidfile that live there.
- `RexRemoteRuntime` launches with job control and writes `$!` to a `pid` file in the
  server runDir; `teardown()` kills that recorded process group (TERM then KILL,
  best-effort) BEFORE `rm -rf` runDir / `close_session` / `close`, on the timeout and
  error paths as well as completion.
- `realSpawner` gains the sidecar's timeout/kill semantics: detached (own-group)
  spawn on POSIX, a default overall timeout, and TERM → grace → KILL escalation on
  the group, resolving with a timeout message in stderr instead of hanging. A
  `makeRealSpawner({ timeoutMs, killGraceMs })` factory exposes the knobs; the
  exported `realSpawner` keeps its `Spawner` shape so the eval judge and mutation
  harness pick the semantics up unchanged.
- No breaking changes: op protocol is extended (optional field), `Spawner`/
  `AgentRuntime` signatures are unchanged.

## Design

**Process groups over lone pids.** Killing the recorded launch pid alone would strand
grandchildren (the agent pipeline is `cat prompt | agent`). The launcher runs under
`set -m` (POSIX job control), so the backgrounded pipeline becomes its own
process-group leader with pgid == pid; one `kill -- -<pid>` reaps the whole tree.
Job control is used instead of `setsid(1)` because macOS ships no `setsid` binary —
`set -m` works in bash and POSIX sh on both macOS (local locus) and Linux
(docker/remote loci). `realSpawner` gets the same property from Node's
`spawn(..., { detached: true })` plus `process.kill(-pid, sig)`, guarded to POSIX
(`process.platform !== 'win32'`; on Windows it falls back to `child.kill()`).

**Sidecar launcher shape.** The current double-`nohup` launcher becomes (inner
command otherwise unchanged, still detached so `execute()` returns immediately):

```
nohup bash -c 'set -m; bash -c <cmd> > <log> 2>&1 & echo $! > <pid>; wait $!; echo $? > <done>' >/dev/null 2>&1 &
```

The sidecar remembers the pidfile of the in-flight run; `shutdown` (op, stdin-EOF,
and the new SIGTERM handler all funnel into the same coroutine) reads it, sends
TERM to the group, waits a short grace, sends KILL, removes log/done/pid, then
`deployment.stop()` — so the docker container is stopped even when the Node parent
kills the sidecar instead of speaking the protocol. The SIGTERM handler is
registered via `loop.add_signal_handler`.

**Teardown ordering on the Node side.** `teardownChild()` currently SIGTERMs the
Python child immediately, which is exactly how agents orphan: the sidecar dies
before it can reap. New order: write `{op:"shutdown"}` (idempotent — the clean path
has already sent it and received `closed`), then arm the existing `killGraceMs`
timer to SIGKILL the child's process group. The child `exit` handler already clears
the kill timer. `SidecarDeps` gains a `killGroup(pid, signal)` seam (default
`process.kill(-pid, signal)`) so unit tests observe the escalation without real
processes. The run-dir sweep stays in `finish()`, covering timeout/error/clean
paths alike; because sentinels now live in the run dir, the sweep is the "no
leftover sentinels" guarantee.

**Remote pidfile.** The launch becomes
`nohup sh -c 'set -m; cd …; ( <agentCmd> ) > <log> 2>&1 & echo $! > <pid>; wait $!; echo $? > <exit.code>' … &`.
`teardown()` prepends a best-effort
`test -f <pid> && { kill -TERM -- -$(cat <pid>); kill -KILL -- -$(cat <pid>); } 2>/dev/null`
before the existing `rm -rf` / `close_session` / `close` — the server session is
still alive at that point on every finish path, so the kill can actually run.

**Delegated lifecycle / multi-agent.** All of this is mechanical orchestration
(spawn, kill, sweep) — no lifecycle instruction text moves into the engine, and the
launchers wrap the adapter argv opaquely, so no agent is special-cased
(`delegated-lifecycle`, `multi-agent-support`).

**Testing (pyramid).** Runtime behaviour is proven at the unit level in
`test/batch-engine/` with the existing injected seams (fake `SidecarChild` + fake
timers; mocked `fetch`): timeout → shutdown op then `killGroup(SIGKILL)` after
grace; run op carries `run_dir` (and its docker translation); remote launch
contains `set -m`/pidfile and teardown kills before `close_session`. One
integration-flavoured test spawns a real child through the timeout-aware spawner
and asserts the process group is dead and no sentinel files remain after a timeout
— the phase's orphan/sentinel assertion. Test headers name the `.feature` they
implement; everything uses tmpdir fixtures.

## Tasks

- [x] 1.1 `sidecar.py`: job-control launcher writing pid/log/done into the run
      directory from the run op's new optional `run_dir` (fallback: workdir), pgid
      recorded via pidfile
- [x] 1.2 `sidecar.py`: shutdown kills the recorded agent group (TERM → grace →
      KILL) and removes log/done/pid before `deployment.stop()`; register a SIGTERM
      handler that runs the same teardown; update `test_sidecar.py`
- [x] 2.1 `rex-sidecar-runtime.ts`: send `run_dir` (host path; docker → in-container
      translation) in the run op; spawn the child `detached: true`
- [x] 2.2 `rex-sidecar-runtime.ts`: teardown = shutdown op first, then
      `killGroup(SIGKILL)` after `killGraceMs` via a new `SidecarDeps.killGroup`
      seam, on timeout/error/clean paths; run-dir sweep covers sentinels+pidfile
- [x] 3.1 `rex-remote-runtime.ts`: job-control launch writing `$!` to a runDir `pid`
      file; `teardown()` kills the recorded group before `rm -rf`/`close_session`/
      `close` on all finish paths
- [x] 4.1 `agent.ts`: `makeRealSpawner({ timeoutMs, killGraceMs })` with detached
      POSIX spawn and TERM → grace → KILL group escalation resolving a timeout
      result; `realSpawner` re-exported from the factory with defaults so the eval
      judge and mutation harness inherit it
- [x] 5.1 Unit tests in `test/batch-engine/` (feature named in each header):
      sidecar timeout → shutdown-then-SIGKILL + run-dir sweep; run op `run_dir`
      incl. docker translation; remote launcher pidfile + kill-before-close;
      spawner timeout semantics
- [x] 5.2 Orphan/sentinel proof test: after a forced timeout the launched process
      group is dead and no `ratchet-rex-*` sentinel or run-dir file survives under
      the project fixture root; run `npm test -- test/batch-engine/` green
- [x] 6.1 Documentation (`documentation` standard, mandatory): update
      `docs/engine/agent-runtime.md` — sidecar protocol (`run_dir` field), launcher
      shape, teardown/reaping contract, sentinel/pidfile locations, spawner timeout
      knobs — keep the existing overview diagram accurate; verify `README.md`
      (no user-facing surface change expected, confirm and leave unchanged if so)
