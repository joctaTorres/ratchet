# python-sidecar-bootstrap

## Why

Phase 2 ("rex-local-runtime") replaces the silent `spawn('claude', ['-p'])` path
with a SWE-ReX execution substrate. That substrate is driven by a Python sidecar,
so before any Node-side runtime can exist there must be (a) a working sidecar
script that drives ReX over stdio JSON-lines and (b) a clean, verifiable bootstrap
of an isolated Python runtime with `swe-rex` available. This change owns that
Python substrate end-to-end and proves it works WITHOUT the Node runtime; the
sibling change `rex-local-agent-runtime` (gated after this one) owns the Node seam.

## What Changes

- **New sidecar script** `src/core/batch/engine/runtime/sidecar.py`: starts a ReX
  deployment selected by `REX_LOCUS` (default `local` → `LocalDeployment`, `docker`
  → `DockerDeployment`), opens a bash session, and runs a JSON-lines op/event loop
  on stdin/stdout. It streams a command's stdout line-by-line by launching it to a
  logfile and tail-polling (~300ms) via ReX `execute()`. Implements
  `features/rex-sidecar/lifecycle.feature` and `features/rex-sidecar/streaming.feature`.
- **build.js copies the `.py` asset into `dist/`.** `build.js` runs a clean full
  `tsc` (it `rmSync('dist')` then compiles) and tsc only emits `.js`/`.d.ts` from
  `.ts` — it will NOT carry a `.py` file. build.js must explicitly copy
  `src/**/*.py` to the mirrored `dist/**` path after compiling, or the packaged CLI
  ships without the sidecar. This is called out as its own task.
- **New bootstrap module** `src/core/batch/engine/runtime/rex-bootstrap.ts`: locates
  a usable Python (>=3.10), ensures an isolated ratchet-owned venv exists with a
  PINNED `swe-rex`, caches it, and returns a resolved `{ command, args, env }` to
  launch the sidecar. Implements `features/rex-bootstrap/isolated-venv.feature`,
  `features/rex-bootstrap/idempotent-cache.feature`, and
  `features/rex-bootstrap/actionable-errors.feature`.
- **Actionable prereq errors**: a dedicated error type so a missing Python or a
  failed venv build fails fast with a clear remedy — never a hang, never a raw
  traceback.
- **Proof-of-work for THIS change**: `test/e2e/rex-sidecar-bootstrap.sh` that
  bootstraps the env, launches the sidecar, asserts `{"event":"ready"}`, sends
  `{"op":"shutdown"}`, asserts a clean `{"event":"closed"}` + exit 0, and SKIPs
  explicitly (exit 0 with a SKIP line, never a silent pass) when Python or network
  is unavailable.

## Design

### Sidecar home + build.js copy (the non-TS asset problem)
The sidecar lives at `src/core/batch/engine/runtime/sidecar.py`, beside the new
`runtime/` TS modules it pairs with. `tsconfig.json` has `rootDir: ./src`,
`outDir: ./dist`, and `include: ["src/**/*"]` — but tsc only emits from TypeScript
inputs, so a `.py` file is silently dropped from `dist/`. Because `build.js` does a
clean build (`rmSync('dist', {recursive,force})` then a fresh `tsc()`), nothing else
restores it. Fix: after the successful `tsc()` call, `build.js` globs `src/**/*.py`
and copies each to its mirrored `dist/` path (preserving subdirs). The bootstrap
must therefore resolve the sidecar path relative to the COMPILED module location
(`dist/core/batch/engine/runtime/`) so it works both from `dist` (packaged) and,
for tests, from `src`. Resolution uses `import.meta.url` → sibling `sidecar.py`.

### venv location, uv vs pip, pinned version, caching
- **Location**: a ratchet-owned cache dir, NOT global Python. Default
  `~/.cache/ratchet/rex/venv` (honoring `XDG_CACHE_HOME` when set:
  `$XDG_CACHE_HOME/ratchet/rex/venv`). Keeping it under the OS cache dir means it is
  user-scoped, disposable, and never touches the user's project or global
  site-packages — directly answering the "don't pollute global Python" requirement.
- **Builder**: prefer `uv` when present on PATH (`uv venv` + `uv pip install`); the
  spike found uv fast and reliable. Fall back to `python -m venv` + that venv's
  `pip install` when uv is absent. Both paths install the same pinned spec.
- **Pinned swe-rex**: pin a single version (recorded as a constant, e.g.
  `SWE_REX_VERSION = "1.2.0"` — confirm the exact resolvable version at
  implementation time and pin it) so bootstraps are reproducible and a transitive
  break can't silently change behavior.
- **Caching / laziness**: bootstrap is lazy (only invoked on first sidecar use) and
  idempotent. Staleness is detected by a marker file written on success that records
  the pinned swe-rex version (and optionally the interpreter); if the venv dir or
  marker is missing, or the marker's version != the current pin, rebuild. A
  successful build writes the marker LAST so a partially built venv is never treated
  as ready. A rebuild clears the venv dir first so no half-state is mistaken for
  usable.
- **Resolved launch command**: bootstrap returns `{ command, args, env }` where
  `command` is the venv's Python, `args` is `[<sidecar.py path>]`, and `env` carries
  `REX_LOCUS` / `REX_WORKDIR` passthrough plus the venv on `PATH`. This is the seam
  the next change's Node client consumes.

### JSON-lines protocol contract (the Node↔sidecar wire)
Newline-delimited JSON, chosen over TS-over-REST in the spike. One JSON object per
line; the sidecar flushes after every emit.

Node → sidecar (stdin):
- `{"op":"run","id":N,"command":"<shell command>"}` — launch a command, stream it.
- `{"op":"shutdown"}` — stop the deployment and exit.

Sidecar → Node (stdout):
- `{"event":"ready","locus":"local"|"docker"}` — emitted once, after the deployment
  starts and the bash session is open; nothing precedes it.
- `{"event":"stdout","id":N,"line":"..."}` — one per output line as it appears.
- `{"event":"exit","id":N,"exit_code":N}` — emitted exactly once when command N ends.
- `{"event":"closed"}` — emitted on clean shutdown, just before exit 0.
- `{"event":"error","id":N|null,"message":"...","detail":...}` — any exception is
  caught and surfaced as this event (mirroring ReX's `{"swerexception":...}` shape
  in `detail` where useful) instead of dying with an unhandled traceback.

### Streaming via launch-to-log + tail-poll, and why execute() not run_in_session()
ReX is request/response, not incremental. To stream, the sidecar (per the spike
prototype): launches the command with `nohup bash -c '<cmd>; echo $? > <done>' >
<log> 2>&1 &` to a per-run logfile, then loops `execute(tail -c +<offset> <log>)`
every ~300ms, emitting each new line and advancing a byte offset, and `cat <done>`
to detect completion → `exit` event. `run_in_session()` is deliberately avoided:
its pexpect backing is brittle and threw `NoExitCodeError` on macOS in the spike.
`exit` is never run inside the session (it EOFs the shell). Logs go under
`REX_WORKDIR` (default `/tmp`) with a uuid suffix so concurrent/sequential runs
don't collide; the launcher `rm -f`s the log + done sentinel first.

### Seam to the next change (mention only, not built here)
`rex-local-agent-runtime` owns the TS `AgentRuntime` interface, the long-lived Node
sidecar process manager/client, engine wiring into `mapSessionToOutcome`, the
raw/rich renderer, and the phase-level `test/e2e/rex-local-stream.sh`. This change
deliberately stops at the resolved launch command + the wire contract + a
self-contained Python-only proof-of-work.

### Verification path
`test/e2e/rex-sidecar-bootstrap.sh` is a bash script: it first checks for a Python
>=3.10 (and, for a cold cache, network) and prints an explicit `SKIP:` line + exits
0 if absent — never a silent pass. Otherwise it invokes the bootstrap, launches the
sidecar via the resolved command, reads stdout until `{"event":"ready"}` (with a
timeout so a hang fails loudly), writes `{"op":"shutdown"}`, asserts `{"event":
"closed"}` and exit 0. This proves the Python substrate works end-to-end with no
Node runtime.

## Tasks

- [ ] 1.1 Add `src/core/batch/engine/runtime/sidecar.py`: refine the spike prototype
  into a full script — start deployment by `REX_LOCUS` (local/docker), open a bash
  session, emit `{"event":"ready","locus":...}` once; read JSON-line ops from stdin
  and dispatch `run`/`shutdown`; on shutdown stop the deployment and emit
  `{"event":"closed"}` then exit 0.
- [ ] 1.2 Implement streaming in the sidecar: for `{"op":"run","id":N,"command":...}`
  launch to a per-run logfile under `REX_WORKDIR` and tail-poll (~300ms) via ReX
  `execute()`, emitting `{"event":"stdout","id":N,"line":...}` per new line and a
  single `{"event":"exit","id":N,"exit_code":...}` on completion. Never use
  `run_in_session()`; never run `exit` in the session.
- [ ] 1.3 Wrap sidecar operations in exception handling that emits
  `{"event":"error",...}` (mirroring `{"swerexception":...}` in `detail` where
  useful) instead of an unhandled traceback, keeping the loop alive or shutting down
  cleanly.
- [ ] 2.1 Update `build.js` to copy `src/**/*.py` to the mirrored `dist/**` path
  after the successful `tsc()` build (preserving subdirectories), with a log line; add
  a guard/log if no `.py` assets are found so a future rename is noticed.
- [ ] 3.1 Add `src/core/batch/engine/runtime/rex-bootstrap.ts`: locate a usable
  Python (>=3.10) by probing candidate interpreters; expose a `RexBootstrapError`
  with an actionable message; resolve the sidecar `.py` path relative to the compiled
  module (works from both `dist` and `src`).
- [ ] 3.2 Implement venv creation in the cache dir
  (`$XDG_CACHE_HOME`/`~/.cache` → `ratchet/rex/venv`): prefer `uv` when on PATH, else
  `python -m venv` + pip; install the PINNED `swe-rex` version (recorded as a
  constant). Verify `swe-rex` is importable from the venv interpreter.
- [ ] 3.3 Make bootstrap lazy, cached, and idempotent: write a success marker
  (recording the pinned version) LAST; treat a missing venv/marker or a version
  mismatch as stale and rebuild after clearing the dir; reuse otherwise and return
  the resolved `{ command, args, env }` quickly.
- [ ] 3.4 Produce actionable errors: no suitable Python → clear message naming the
  required version and how to install/point ratchet at one; venv build failure →
  message naming what failed (venv vs install) and a remedy (network/uv), leaving no
  partial venv that looks usable. Fail fast, never hang, never raw traceback.
- [ ] 4.1 Add unit tests (vitest) for `rex-bootstrap.ts`: path resolution, the
  uv-vs-pip selection, the cache-hit (no rebuild) vs missing/stale (rebuild) logic,
  and that the missing-Python / failed-build paths throw `RexBootstrapError` with the
  actionable message (injecting the runner/fs seams so no real network/venv is built).
- [ ] 4.2 Add `test/e2e/rex-sidecar-bootstrap.sh`: SKIP explicitly (printed SKIP line,
  exit 0) when Python/network is unavailable; otherwise bootstrap, launch the sidecar
  via the resolved command, assert `{"event":"ready"}` within a timeout, send
  `{"op":"shutdown"}`, assert `{"event":"closed"}` and exit 0. Mark it executable.
- [ ] 4.3 Confirm `pnpm build` carries `sidecar.py` into `dist/` and the e2e script
  passes (or SKIPs cleanly) locally.
