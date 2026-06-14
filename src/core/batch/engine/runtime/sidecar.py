#!/usr/bin/env python3
"""
ReX sidecar — drives SWE-ReX over a newline-delimited JSON protocol on stdio.

This script is the Python substrate of ratchet's batch execution runtime. The
Node side launches it (via the resolved command from ``rex-bootstrap.ts``) and
talks to it one JSON object per line:

  Node -> sidecar (stdin):
    {"op":"run","id":N,"command":"<shell command>"}   launch + stream a command
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
import sys
import uuid

# SWE-ReX logs to a Rich console on STDOUT by default, which would corrupt our
# JSON-lines protocol. Silence its stream handler before swerex is imported so
# only our JSON objects ever reach stdout. (swerex reads this env at import.)
os.environ.setdefault("SWE_REX_LOG_STREAM_LEVEL", "CRITICAL")

# Poll interval for tailing a command's logfile (seconds).
POLL_INTERVAL = 0.3


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


DEFAULT_DOCKER_IMAGE = "python:3.12"


def _make_deployment(locus: str):
    """Construct a deployment for the requested locus. Docker is imported lazily
    so the local path does not require docker-only dependencies (aiohttp).

    For ``docker`` the image comes from ``REX_IMAGE`` (default
    ``python:3.12``) and the project root is bind-mounted via ``docker_args``
    (``-v REX_MOUNT_HOST:REX_MOUNT_CONTAINER``) — swe-rex 1.4.0 has no dedicated
    ``volumes`` field; ``start()`` splices ``docker_args`` into the run argv.
    """
    if locus == "docker":
        from swerex.deployment.docker import DockerDeployment

        image = os.environ.get("REX_IMAGE", "").strip() or DEFAULT_DOCKER_IMAGE
        mount_host = os.environ.get("REX_MOUNT_HOST", "").strip()
        mount_container = (
            os.environ.get("REX_MOUNT_CONTAINER", "").strip() or "/workspace"
        )
        docker_args: list = []
        if mount_host:
            docker_args = ["-v", f"{mount_host}:{mount_container}"]
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

    async def run(self, run_id, command: str) -> None:
        """Launch ``command`` detached to a logfile and stream its stdout lines,
        then report the exit code exactly once."""
        token = uuid.uuid4().hex
        log = f"{self.workdir.rstrip('/')}/ratchet-rex-{token}.log"
        done = f"{self.workdir.rstrip('/')}/ratchet-rex-{token}.done"

        # Clear any prior sentinels, then launch detached, recording the exit
        # code to a sentinel file when the command finishes.
        await self._exec(f"rm -f {log} {done}")
        launcher = (
            f"nohup bash -c {_shquote(command)} > {log} 2>&1; "
            f"echo $? > {done}"
        )
        await self._exec(f"nohup bash -c {_shquote(launcher)} >/dev/null 2>&1 &")

        offset = 0
        while True:
            # Pull only the new bytes since the last poll.
            tail = await self._exec(f"tail -c +{offset + 1} {log} 2>/dev/null")
            chunk = tail.stdout or ""
            if chunk:
                offset += len(chunk.encode("utf-8", "surrogateescape"))
                # Emit complete lines; a trailing partial line is left for the
                # next poll by only splitting on newlines we actually have.
                parts = chunk.split("\n")
                # If chunk ended in a newline the split leaves a trailing "" we
                # must drop; otherwise the last element is a partial line we push
                # back via the byte offset so the next poll completes it.
                if chunk.endswith("\n"):
                    parts.pop()
                else:
                    partial = parts.pop()
                    offset -= len(partial.encode("utf-8", "surrogateescape"))
                for line in parts:
                    emit({"event": "stdout", "id": run_id, "line": line})

            # Completion is signalled by the sentinel file existing.
            check = await self._exec(f"cat {done} 2>/dev/null")
            sentinel = (check.stdout or "").strip()
            if sentinel != "":
                # Drain any final bytes that landed between the tail and the
                # sentinel write.
                final = await self._exec(f"tail -c +{offset + 1} {log} 2>/dev/null")
                rest = final.stdout or ""
                if rest:
                    for line in rest.split("\n"):
                        if line != "":
                            emit({"event": "stdout", "id": run_id, "line": line})
                try:
                    exit_code = int(sentinel.splitlines()[-1])
                except (ValueError, IndexError):
                    exit_code = -1
                emit({"event": "exit", "id": run_id, "exit_code": exit_code})
                await self._exec(f"rm -f {log} {done}")
                return

            await asyncio.sleep(POLL_INTERVAL)

    async def shutdown(self) -> None:
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
                try:
                    await self.run(run_id, command)
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
