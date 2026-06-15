#!/usr/bin/env python3
"""Pure-stdlib unit tests for sidecar.py — no pytest, no venv, no Docker.

These cover the two pieces that are otherwise ONLY e2e-asserted (and SKIP without
Python/Docker):

  1. the tail-poll byte-offset loop in ``Sidecar.run`` (sidecar.py:179-220) —
     incremental line emission, a held trailing partial line across polls, the
     final-drain after the exit sentinel, and the byte-cursor advance under a
     multi-byte / surrogateescape chunk;
  2. the docker ``-v`` mount argv built by ``_make_deployment`` (sidecar.py:108-110),
     including the empty-``docker_args`` branch when ``REX_MOUNT_HOST`` is unset.

``swerex`` is stubbed in ``sys.modules`` BEFORE importing the sidecar so the test
runs with no installed dependency. Run with: ``python3 -m unittest`` from this
directory, or ``python3 src/core/batch/engine/runtime/test_sidecar.py``.
"""

from __future__ import annotations

import asyncio
import os
import sys
import types
import unittest
from pathlib import Path


# --- Stub the swerex modules the sidecar imports lazily, before importing it ---
def _install_swerex_stubs() -> dict:
    """Install minimal fake swerex modules; return the captured ctor kwargs map."""
    captured: dict = {}

    # swerex.runtime.abstract: Command / CreateBashSessionRequest (plain holders).
    abstract = types.ModuleType("swerex.runtime.abstract")

    class Command:  # noqa: D401 - simple data holder
        def __init__(self, command="", shell=False, check=False):
            self.command = command
            self.shell = shell
            self.check = check

    class CreateBashSessionRequest:
        def __init__(self, session=""):
            self.session = session

    abstract.Command = Command
    abstract.CreateBashSessionRequest = CreateBashSessionRequest

    # swerex.deployment.docker: DockerDeployment captures its ctor kwargs.
    docker = types.ModuleType("swerex.deployment.docker")

    class DockerDeployment:
        def __init__(self, image=None, docker_args=None):
            captured["docker"] = {"image": image, "docker_args": docker_args}
            self.image = image
            self.docker_args = docker_args
            self.runtime = None

    docker.DockerDeployment = DockerDeployment

    # swerex.deployment.local: LocalDeployment (marker only).
    local = types.ModuleType("swerex.deployment.local")

    class LocalDeployment:
        def __init__(self):
            captured["local"] = True
            self.runtime = None

    local.LocalDeployment = LocalDeployment

    # Package parents so `from swerex.x.y import Z` resolves.
    pkg = types.ModuleType("swerex")
    runtime_pkg = types.ModuleType("swerex.runtime")
    deploy_pkg = types.ModuleType("swerex.deployment")
    for name, mod in [
        ("swerex", pkg),
        ("swerex.runtime", runtime_pkg),
        ("swerex.runtime.abstract", abstract),
        ("swerex.deployment", deploy_pkg),
        ("swerex.deployment.docker", docker),
        ("swerex.deployment.local", local),
    ]:
        sys.modules[name] = mod
    return captured


CAPTURED = _install_swerex_stubs()

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sidecar  # noqa: E402  (must follow the stub install)


class FakeExecResult:
    """Mimics a ReX execute() response: a decoded `.stdout` str."""

    def __init__(self, stdout: str):
        self.stdout = stdout


class FakeRuntime:
    """A scripted runtime: each shell command is answered by a handler that models
    a logfile growing over polls plus an exit sentinel."""

    def __init__(self, log_chunks, exit_code):
        # Successive byte-strings the logfile reveals, one per `tail` poll.
        self._chunks = [c.encode("utf-8", "surrogateescape") for c in log_chunks]
        self._exit_code = exit_code
        self._poll = 0
        self._full = b""  # bytes written to the "logfile" so far
        self.commands: list[str] = []

    async def execute(self, command):
        cmd = command.command
        self.commands.append(cmd)
        # Launch / cleanup are no-ops in the model.
        if cmd.startswith("rm -f") or cmd.startswith("nohup"):
            return FakeExecResult("")
        # tail -c +<n> <log>: reveal the next chunk, then return bytes from offset.
        if cmd.startswith("tail -c +"):
            n = int(cmd.split("tail -c +", 1)[1].split(" ", 1)[0])
            if self._poll < len(self._chunks):
                self._full += self._chunks[self._poll]
                self._poll += 1
            offset = n - 1  # 1-based byte cursor -> 0-based slice
            return FakeExecResult(self._full[offset:].decode("utf-8", "surrogateescape"))
        # cat <done>: the sentinel appears only after all chunks are revealed.
        if cmd.startswith("cat "):
            done = self._poll >= len(self._chunks)
            return FakeExecResult(f"{self._exit_code}\n" if done else "")
        return FakeExecResult("")


def _drive_run(log_chunks, exit_code):
    """Run Sidecar.run with a fake runtime; return the emitted events."""
    events: list[dict] = []
    sidecar.emit = lambda obj: events.append(obj)  # capture instead of stdout
    sidecar.POLL_INTERVAL = 0  # no real sleeps

    sc = sidecar.Sidecar()
    sc.workdir = "/tmp"
    sc.runtime = FakeRuntime(log_chunks, exit_code)
    asyncio.run(sc.run(run_id=1, command="agent --go"))
    return events, sc.runtime


class TailOffsetLoopTests(unittest.TestCase):
    def test_streams_complete_lines_and_captures_exit_code(self):
        events, _ = _drive_run(["line-1\n", "line-2\n", "line-3\n"], exit_code=0)
        stdout = [e["line"] for e in events if e.get("event") == "stdout"]
        self.assertEqual(stdout, ["line-1", "line-2", "line-3"])
        exits = [e for e in events if e.get("event") == "exit"]
        self.assertEqual(len(exits), 1)
        self.assertEqual(exits[0]["exit_code"], 0)

    def test_holds_a_trailing_partial_line_until_its_newline(self):
        # "par" has no newline; its completion ("tial\n") arrives on the next poll.
        events, _ = _drive_run(["par", "tial\ndone\n"], exit_code=0)
        stdout = [e["line"] for e in events if e.get("event") == "stdout"]
        # "partial" is emitted ONCE (not "par" + "tial"), then "done".
        self.assertEqual(stdout, ["partial", "done"])

    def test_captures_a_nonzero_exit_code(self):
        events, _ = _drive_run(["only\n"], exit_code=7)
        exits = [e for e in events if e.get("event") == "exit"]
        self.assertEqual(exits[0]["exit_code"], 7)

    def test_byte_offset_advances_correctly_over_multibyte_output(self):
        # A multi-byte char (é = 2 bytes) must advance the byte cursor by bytes,
        # not chars, so the next poll does not re-read or skip data.
        events, runtime = _drive_run(["café\n", "über\n"], exit_code=0)
        stdout = [e["line"] for e in events if e.get("event") == "stdout"]
        self.assertEqual(stdout, ["café", "über"])
        # Each line was emitted exactly once (no duplication from a drifted offset).
        self.assertEqual(len(stdout), 2)

    def test_surrogateescape_bytes_round_trip_without_drift(self):
        # A raw non-UTF-8 byte (0xff) survives as a lone surrogate and re-encodes
        # to the SAME byte, keeping the byte offset exact (the pinned assumption).
        raw = b"\xff".decode("utf-8", "surrogateescape")
        events, _ = _drive_run([f"a{raw}b\n", "next\n"], exit_code=0)
        stdout = [e["line"] for e in events if e.get("event") == "stdout"]
        self.assertEqual(stdout, [f"a{raw}b", "next"])


class MakeDeploymentTests(unittest.TestCase):
    def setUp(self):
        for k in ("REX_IMAGE", "REX_MOUNT_HOST", "REX_MOUNT_CONTAINER"):
            os.environ.pop(k, None)
        CAPTURED.clear()

    def test_docker_builds_the_v_mount_argv_from_mount_env(self):
        os.environ["REX_IMAGE"] = "my/image:tag"
        os.environ["REX_MOUNT_HOST"] = "/host/project"
        os.environ["REX_MOUNT_CONTAINER"] = "/workspace"
        sidecar._make_deployment("docker")
        self.assertEqual(CAPTURED["docker"]["image"], "my/image:tag")
        self.assertEqual(
            CAPTURED["docker"]["docker_args"],
            ["-v", "/host/project:/workspace"],
        )

    def test_docker_defaults_image_and_container_mount(self):
        os.environ["REX_MOUNT_HOST"] = "/host/project"
        sidecar._make_deployment("docker")
        # Unset image -> the pinned default; unset container mount -> /workspace.
        self.assertEqual(CAPTURED["docker"]["image"], sidecar.DEFAULT_DOCKER_IMAGE)
        self.assertEqual(
            CAPTURED["docker"]["docker_args"],
            ["-v", "/host/project:/workspace"],
        )

    def test_docker_omits_docker_args_when_mount_host_unset(self):
        # No REX_MOUNT_HOST -> empty docker_args (no `-v` spliced into the run argv).
        sidecar._make_deployment("docker")
        self.assertEqual(CAPTURED["docker"]["docker_args"], [])

    def test_local_uses_local_deployment(self):
        sidecar._make_deployment("local")
        self.assertTrue(CAPTURED.get("local"))
        self.assertNotIn("docker", CAPTURED)


if __name__ == "__main__":
    unittest.main()
