#!/usr/bin/env python3
"""
ReX sidecar — drives SWE-ReX over a newline-delimited JSON protocol on stdio.

This script is the Python substrate of ratchet's batch execution runtime. The
Node side launches it (via the resolved command from ``rex-bootstrap.ts``) and
talks to it one JSON object per line:

  Node -> sidecar (stdin):
    {"op":"run","id":N,"command":"<shell command>","run_dir":"<dir>"?}  launch + stream
    {"op":"shutdown"}                                   stop the deployment, exit 0

  sidecar -> Node (stdout):
    {"event":"ready","locus":"local"|"docker"}          emitted once, first
    {"event":"stdout","id":N,"line":"..."}              one per output line
    {"event":"exit","id":N,"exit_code":N}               once per finished command
    {"event":"closed"}                                  on clean shutdown
    {"event":"error","id":N|null,"message":"...",...}   any caught exception

Streaming model (why this shape): SWE-ReX is request/response, not incremental.
To stream a slow command we launch it detached to a per-run logfile and tail-poll
that logfile (~300ms) via ReX ``execute()`` — NOT ``run_in_session()`` (its
pexpect backing is brittle on macOS and threw NoExitCodeError in the spike). We
never run ``exit`` inside the session (it would EOF the shell).

The deployment is selected at runtime by ``REX_LOCUS`` (default ``local`` ->
LocalDeployment; ``docker`` -> DockerDeployment).

Docker locus (env contract, set by the Node side via rex-bootstrap.ts):
  REX_LOCUS=docker
  REX_IMAGE=<image ref>            container image (e.g. python:3.12)
  REX_MOUNT_HOST=<projectRoot>     host path bind-mounted into the container
  REX_MOUNT_CONTAINER=/workspace   in-container mount point (a stable path)
  REX_WORKDIR=/workspace           the agent's cwd AND where tail-poll logfiles
                                   live — for docker this is the IN-CONTAINER
                                   mount path (the host projectRoot may not
                                   exist inside the container), so logfile
                                   writes land on the writable bind mount and
                                   journal writes propagate back to the host.
  REX_DOCKER_USER=<uid:gid>        `docker run --user` (host uid:gid; when unset
                                   the sidecar resolves the current host uid:gid
                                   so container writes land as the host user).
  REX_DOCKER_MEMORY=<2g>           `docker run --memory` (fallback: "2g").
  REX_DOCKER_PIDS_LIMIT=<512>      `docker run --pids-limit` (fallback: 512).
  REX_DOCKER_CPUS=<1.5>            `docker run --cpus` (opt-in; no flag when unset).
  REX_DOCKER_NETWORK=<bridge|none> `docker run --network` (fallback: "bridge" —
                                   the container HAS outbound network; set "none"
                                   to fully isolate).

The repo bind mount is expressed via ``DockerDeploymentConfig.docker_args``
(``["-v", f"{host}:{container}"]``) because swe-rex (1.4.0) has NO dedicated
``volumes``/``mounts`` field; ``DockerDeployment.start()`` splices ``docker_args``
into the ``docker run`` argv.

Follow-on (out of scope here): the e2e proves PLUMBING with a generic image +
stub agent. A REAL agent run needs an image provisioned with node + the chosen
coding agent + ``ratchet`` on PATH so the agent can run ``ratchet batch report``
and the engine can read the journal back over the mount.
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
import uuid

# SWE-ReX logs to a Rich console on STDOUT by default, which would corrupt our
# JSON-lines protocol. Silence its stream handler before swerex is imported so
# only our JSON objects ever reach stdout. (swerex reads this env at import.)
os.environ.setdefault("SWE_REX_LOG_STREAM_LEVEL", "CRITICAL")

# Poll interval for tailing a command's logfile (seconds).
POLL_INTERVAL = 0.3

# Upper bound (bytes) on a held partial line before it is flushed as a truncated
# stdout event rather than pushed back and re-read every poll. MUST match the TS
# `MAX_PARTIAL_BYTES` in spawn-command.ts (the shared cap for both rex runtimes'
# partial buffers) — keep the two in sync if either ever changes.
MAX_PARTIAL_BYTES = 1024 * 1024


def emit(obj: dict) -> None:
    """Write one JSON line to stdout and flush immediately."""
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def _exception_detail(exc: BaseException) -> object:
    """Best-effort structured detail for an error event.

    SWE-ReX surfaces failures as objects carrying a ``swerexception`` shape; we
    mirror that in ``detail`` when present, otherwise fall back to the type name.
    """
    detail: dict = {"type": type(exc).__name__}
    extra = getattr(exc, "extra_info", None)
    if isinstance(extra, dict) and extra:
        detail["swerexception"] = extra
    return detail


# Cross-language fallbacks for the docker hardening knobs. These MUST match the
# TS constants in config.ts (the single source of truth). They are PURE
# UNSET-FALLBACKS: the Node side always threads the resolved value via the
# matching `REX_DOCKER_*` env var, so these are only reached if that env is
# missing. Keep the two languages in sync if any default ever changes.
#
# The docker IMAGE default is owned solely by config.ts
# (`DEFAULT_DOCKER_IMAGE`); the Node side always threads it via `REX_IMAGE`, so
# the Python side has NO image fallback — an unset/empty `REX_IMAGE` on the
# docker locus raises a clear error rather than silently guessing an image.
DEFAULT_DOCKER_MEMORY = "2g"
DEFAULT_DOCKER_PIDS_LIMIT = "512"
DEFAULT_DOCKER_NETWORK = "bridge"


def _make_deployment(locus: str):
    """Construct a deployment for the requested locus. Docker is imported lazily
    so the local path does not require docker-only dependencies (aiohttp).

    For ``docker`` the image comes from ``REX_IMAGE`` (which the Node side
    always threads, defaulting to ``DEFAULT_DOCKER_IMAGE`` in config.ts — the
    single source of truth) and the project root is bind-mounted via
    ``docker_args`` (``-v REX_MOUNT_HOST:REX_MOUNT_CONTAINER``) — swe-rex 1.4.0
    has no dedicated ``volumes`` field; ``start()`` splices ``docker_args`` into
    the run argv.

    Docker hardening knobs (``REX_DOCKER_*``) are appended to ``docker_args``
    conditionally on env presence, so an unset knob never emits a flag (Docker's
    own default then applies). The ``--user`` knob defaults to the current host
    uid:gid so container writes land as the host user rather than root.

    An unset/empty ``REX_IMAGE`` on the docker locus raises a clear ``ValueError``
    naming ``REX_IMAGE`` as required, rather than silently falling back to a
    built-in image — the image default is owned solely by config.ts, and Node
    always threads it, so reaching this branch means a mis-invoked sidecar.
    """
    if locus == "docker":
        from swerex.deployment.docker import DockerDeployment

        image = os.environ.get("REX_IMAGE", "").strip()
        if not image:
            raise ValueError(
                "REX_IMAGE is required for the docker locus but is unset or empty. "
                "The Node side always threads it (defaulting to DEFAULT_DOCKER_IMAGE "
                "in config.ts); a missing value here means the sidecar was launched "
                "without the resolved image."
            )
        mount_host = os.environ.get("REX_MOUNT_HOST", "").strip()
        mount_container = (
            os.environ.get("REX_MOUNT_CONTAINER", "").strip() or "/workspace"
        )
        docker_args: list = []
        if mount_host:
            docker_args += ["-v", f"{mount_host}:{mount_container}"]

        # `--user`: default to the current host uid:gid so container file writes
        # land as the host user (not root). An explicit `REX_DOCKER_USER` wins.
        docker_user = os.environ.get("REX_DOCKER_USER", "").strip()
        if not docker_user:
            docker_user = f"{os.getuid()}:{os.getgid()}"
        docker_args += ["--user", docker_user]

        # `--memory`: always applied (sane default bounds the container).
        docker_memory = os.environ.get("REX_DOCKER_MEMORY", "").strip() or DEFAULT_DOCKER_MEMORY
        docker_args += ["--memory", docker_memory]

        # `--pids-limit`: always applied (bounds fork-bomb-style runaway).
        docker_pids = os.environ.get("REX_DOCKER_PIDS_LIMIT", "").strip() or DEFAULT_DOCKER_PIDS_LIMIT
        # Fail before spawn: a non-integer or non-positive pids limit would
        # otherwise surface as a cryptic docker error. Node validates upstream,
        # but the sidecar is the last gate before `docker run`.
        try:
            if int(docker_pids) <= 0:
                raise ValueError
        except ValueError:
            raise RuntimeError(
                f"REX_DOCKER_PIDS_LIMIT must be a positive integer (got '{docker_pids}')."
            )
        docker_args += ["--pids-limit", docker_pids]

        # `--network`: always applied. `bridge` (default) means the container
        # HAS outbound network; `none` fully isolates. The honest isolation
        # contract documents this explicitly.
        docker_network = os.environ.get("REX_DOCKER_NETWORK", "").strip() or DEFAULT_DOCKER_NETWORK
        docker_args += ["--network", docker_network]

        # `--cpus`: opt-in (no default → no flag when unset, Docker's default).
        docker_cpus = os.environ.get("REX_DOCKER_CPUS", "").strip()
        if docker_cpus:
            # Fail before spawn: a non-numeric or non-positive cpus value would
            # otherwise surface as a cryptic docker error.
            try:
                if float(docker_cpus) <= 0:
                    raise ValueError
            except ValueError:
                raise RuntimeError(
                    f"REX_DOCKER_CPUS must be a positive number (got '{docker_cpus}')."
                )
            docker_args += ["--cpus", docker_cpus]

        return DockerDeployment(image=image, docker_args=docker_args)
    # Default / "local".
    from swerex.deployment.local import LocalDeployment

    return LocalDeployment()


class Sidecar:
    def __init__(self) -> None:
        self.locus = os.environ.get("REX_LOCUS", "local").strip().lower() or "local"
        self.workdir = os.environ.get("REX_WORKDIR", "/tmp")
        self.session = "ratchet-rex"
        self.deployment = None
        self.runtime = None
        # pidfile of the in-flight run's process group (pgid == pid under
        # `set -m`), so `shutdown` can reap the whole tree even when the Node
        # parent SIGKILLs us instead of speaking the protocol. None when no run
        # is in flight (or the run already reaped itself).
        self.run_pidfile: str | None = None
        # Grace (s) between SIGTERM and SIGKILL when reaping the agent group.
        self._shutdown_grace_s = 1.0

    async def start(self) -> None:
        from swerex.runtime.abstract import CreateBashSessionRequest

        self.deployment = _make_deployment(self.locus)
        # Belt-and-braces for the docker locus: the Node side already runs a
        # `docker info` pre-flight before spawning us, but a daemon that dies
        # between that probe and `start()` (or an image-pull failure) would
        # otherwise surface as a raw traceback. Wrap the docker start so any
        # failure becomes a clear, actionable error event instead — the runtime
        # maps `error` -> non-zero + stderr, so the engine stays resumable.
        if self.locus == "docker":
            try:
                await self.deployment.start()
            except Exception as exc:  # noqa: BLE001 — surface, don't crash
                raise RuntimeError(
                    "Docker deployment failed to start for locus=docker. "
                    "Ensure the Docker daemon is running and the configured "
                    f"image is pullable. Detail: {exc}"
                ) from exc
        else:
            await self.deployment.start()
        self.runtime = self.deployment.runtime
        # Open the bash session the protocol promises. Streaming itself uses
        # execute(), but the session is part of the lifecycle contract.
        await self.runtime.create_session(
            CreateBashSessionRequest(session=self.session)
        )
        emit({"event": "ready", "locus": self.locus})

    async def _exec(self, command: str):
        """Run a one-shot shell command via ReX execute() and return its response."""
        from swerex.runtime.abstract import Command

        return await self.runtime.execute(
            Command(command=command, shell=True, check=False)
        )

    async def run(self, run_id, command, run_dir: str | None = None) -> None:
        """Launch ``command`` detached to a logfile and stream its stdout lines,
        then report the exit code exactly once.

        ``run_dir`` (optional, from the run op) is the directory the sidecar
        writes its per-run sentinels (``ratchet-rex-<token>.log/.done``) and the
        new pidfile into — typically ``.ratchet/batches/<batch>/run/<id>/`` on
        the host, or its in-container translation for docker. Absent → fall back
        to the workdir (the prior behaviour, so the op protocol is a pure
        extension)."""
        sentinel_dir = run_dir if run_dir else self.workdir
        token = uuid.uuid4().hex
        log = f"{sentinel_dir.rstrip('/')}/ratchet-rex-{token}.log"
        done = f"{sentinel_dir.rstrip('/')}/ratchet-rex-{token}.done"
        pid = f"{sentinel_dir.rstrip('/')}/ratchet-rex-{token}.pid"

        # Clear any prior sentinels, then launch detached under job control so the
        # backgrounded pipeline becomes its OWN process-group leader (pgid ==
        # pid). One `kill -- -<pid>` then reaps the whole tree (agent + `cat`),
        # which a lone-pid kill would strand. The inner `bash -c <cmd>` runs the
        # agent pipeline; `$!` is its pid (== pgid under `set -m`), recorded to
        # the pidfile so `shutdown` can find the group; `wait` collects the exit
        # code into the done sentinel. macOS ships no `setsid` binary, so `set
        # -m` (POSIX job control) is used — works in bash and POSIX sh on both
        # macOS (local) and Linux (docker/remote).
        await self._exec(f"rm -f {log} {done} {pid}")
        self.run_pidfile = pid
        inner = (
            f"set -m; bash -c {_shquote(command)} > {log} 2>&1 & "
            f"echo $! > {pid}; wait $!; echo $? > {done}"
        )
        launcher = f"nohup bash -c {_shquote(inner)} >/dev/null 2>&1 &"
        await self._exec(launcher)

        offset = 0
        while True:
            # Pull only the new bytes since the last poll.
            #
            # PINNED ASSUMPTION (byte-cursor vs decoded-string round-trip):
            # `tail -c +N` advances a BYTE cursor, but ReX `execute()` hands us
            # `tail.stdout` as an already-DECODED str. We re-derive the byte count
            # with `chunk.encode("utf-8", "surrogateescape")`, which is exact iff
            # the decode→encode round-trips losslessly. That holds when ReX decodes
            # the bytes as UTF-8 with `surrogateescape` (any non-UTF-8 byte survives
            # as a lone surrogate and re-encodes to the SAME byte), so the offset
            # stays byte-accurate even on binary/garbled output. If a backend ever
            # decoded through a DIFFERENT, lossy codec the cursor could drift — but
            # swe-rex's runtime uses surrogateescape, so this is safe as pinned.
            tail = await self._exec(f"tail -c +{offset + 1} {log} 2>/dev/null")
            chunk = tail.stdout or ""
            if chunk:
                offset += len(chunk.encode("utf-8", "surrogateescape"))
                # Emit complete lines; a trailing partial line is left for the
                # next poll by only splitting on newlines we actually have.
                parts = chunk.split("\n")
                # If chunk ended in a newline the split leaves a trailing "" we
                # must drop; otherwise the last element is a partial line.
                flushed_partial: str | None = None
                if chunk.endswith("\n"):
                    parts.pop()
                else:
                    partial = parts.pop()
                    partial_bytes = len(partial.encode("utf-8", "surrogateescape"))
                    if partial_bytes > MAX_PARTIAL_BYTES:
                        # An unterminated line past the cap: flush it TRUNCATED and
                        # do NOT decrement the offset, so the cursor advances past
                        # the flushed bytes and the next poll reads only new bytes
                        # instead of re-reading (and regrowing) the huge partial.
                        flushed_partial = partial
                    else:
                        # Push the partial back via the byte offset so the next
                        # poll completes it.
                        offset -= partial_bytes
                for line in parts:
                    emit({"event": "stdout", "id": run_id, "line": line})
                if flushed_partial is not None:
                    emit({
                        "event": "stdout",
                        "id": run_id,
                        "line": flushed_partial,
                        "truncated": True,
                    })

            # Completion is signalled by the sentinel file existing.
            check = await self._exec(f"cat {done} 2>/dev/null")
            sentinel = (check.stdout or "").strip()
            if sentinel != "":
                # Drain any final bytes that landed between the tail and the
                # sentinel write.
                final = await self._exec(f"tail -c +{offset + 1} {log} 2>/dev/null")
                rest = final.stdout or ""
                if rest:
                    # Use the streaming loop's exact split discipline so blank-line
                    # emission is unified between stream and drain: split on "\n",
                    # drop ONLY the empty segment after a trailing newline, and emit
                    # every remaining segment — including interior blanks and a
                    # trailing partial (final at drain time, emitted as its own line).
                    parts = rest.split("\n")
                    if rest.endswith("\n"):
                        parts.pop()
                    for line in parts:
                        emit({"event": "stdout", "id": run_id, "line": line})
                try:
                    exit_code = int(sentinel.splitlines()[-1])
                except (ValueError, IndexError):
                    exit_code = -1
                emit({"event": "exit", "id": run_id, "exit_code": exit_code})
                await self._exec(f"rm -f {log} {done} {pid}")
                if self.run_pidfile == pid:
                    self.run_pidfile = None
                return

            await asyncio.sleep(POLL_INTERVAL)

    async def _reap_agent_group(self) -> None:
        """Reap the in-flight run's process group: TERM → short grace → KILL,
        then remove its log/done/pid sentinels. Best-effort — a missing pidfile
        or an already-dead group is a no-op. Idempotent (safe to call from both
        the `shutdown` op and the SIGTERM handler)."""
        pidfile = self.run_pidfile
        if not pidfile:
            return
        self.run_pidfile = None  # claim it; idempotent across concurrent calls
        try:
            res = await self._exec(f"cat {pidfile} 2>/dev/null")
            pgid = (res.stdout or "").strip()
            if not pgid or not pgid.lstrip("-").isdigit():
                return
            # TERM the whole group (negative pid = pgid), short grace, then KILL.
            await self._exec(f"kill -TERM -- -{pgid} 2>/dev/null || true")
            await asyncio.sleep(self._shutdown_grace_s)
            await self._exec(f"kill -KILL -- -{pgid} 2>/dev/null || true")
        except Exception:  # noqa: BLE001 — reaping must never raise
            pass
        finally:
            # Sweep the sentinels/pidfile so nothing litters the run dir. The log
            # basename pattern is shared (same token) but we don't track the
            # exact paths here — `rm -f` the pidfile and any ratchet-rex-* in the
            # same dir is over-broad, so derive the log/done from the pidfile's
            # token by best-effort globbing of the recorded names.
            try:
                await self._exec(f"rm -f {pidfile} {pidfile[:-4]}.log {pidfile[:-4]}.done 2>/dev/null || true")
            except Exception:  # noqa: BLE001
                pass

    async def shutdown(self) -> None:
        # Reap the agent process group BEFORE stopping the deployment so the
        # agent (and its `cat` sibling) can't outlive the sidecar — the prior
        # behaviour orphaned them on teardown.
        await self._reap_agent_group()
        if self.deployment is not None:
            try:
                await self.deployment.stop()
            finally:
                self.deployment = None
                self.runtime = None
        emit({"event": "closed"})

    async def serve(self) -> int:
        await self.start()
        loop = asyncio.get_event_loop()
        # Register a SIGTERM handler that funnels into the same teardown as the
        # `shutdown` op and stdin-EOF: the Node parent SIGKILLing us (instead of
        # speaking the protocol) still reaps the agent group and stops the
        # docker container before we die. `loop.add_signal_handler` is POSIX-
        # only; on the unsupported platform (Windows) we skip — the op/EOF paths
        # still tear down cleanly there. After teardown the process exits 0
        # (SystemExit from the coroutine propagates through asyncio.run).
        async def _on_sigterm():
            await self.shutdown()
            raise SystemExit(0)

        try:
            loop.add_signal_handler(signal.SIGTERM, lambda: asyncio.ensure_future(_on_sigterm()))
        except (NotImplementedError, RuntimeError):
            pass
        while True:
            line = await loop.run_in_executor(None, sys.stdin.readline)
            if line == "":
                # stdin closed without a shutdown op — shut down cleanly.
                await self.shutdown()
                return 0
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError as exc:
                emit(
                    {
                        "event": "error",
                        "id": None,
                        "message": f"invalid JSON op: {exc}",
                        "detail": {"type": "JSONDecodeError"},
                    }
                )
                continue

            op = msg.get("op")
            if op == "shutdown":
                await self.shutdown()
                return 0
            if op == "run":
                run_id = msg.get("id")
                command = msg.get("command", "")
                run_dir = msg.get("run_dir")
                if not isinstance(run_dir, str) or not run_dir.strip():
                    run_dir = None
                try:
                    await self.run(run_id, command, run_dir)
                except Exception as exc:  # noqa: BLE001 — surface, don't crash
                    emit(
                        {
                            "event": "error",
                            "id": run_id,
                            "message": str(exc),
                            "detail": _exception_detail(exc),
                        }
                    )
                continue
            emit(
                {
                    "event": "error",
                    "id": msg.get("id"),
                    "message": f"unknown op: {op!r}",
                    "detail": {"type": "UnknownOp"},
                }
            )


def _shquote(s: str) -> str:
    """Single-quote a string for safe embedding in a bash -c argument."""
    return "'" + s.replace("'", "'\\''") + "'"


def main() -> int:
    sidecar = Sidecar()
    try:
        return asyncio.run(sidecar.serve())
    except Exception as exc:  # noqa: BLE001 — never die with a raw traceback
        emit(
            {
                "event": "error",
                "id": None,
                "message": str(exc),
                "detail": _exception_detail(exc),
            }
        )
        # Best-effort clean shutdown.
        try:
            asyncio.run(sidecar.shutdown())
        except Exception:  # noqa: BLE001
            pass
        return 1


if __name__ == "__main__":
    sys.exit(main())
