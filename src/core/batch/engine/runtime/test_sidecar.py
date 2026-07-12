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


class BoundedPartialTests(unittest.TestCase):
    """Cap the sidecar partial: an oversized unterminated line is flushed as a
    truncated stdout event and the offset advances past it (no re-read).

    Implements ``features/bounded-partials/flush-oversized-partial.feature``.
    """

    def test_oversized_partial_is_flushed_truncated_and_not_re_read(self):
        big = "X" * (sidecar.MAX_PARTIAL_BYTES + 10)
        # First chunk: a huge unterminated line (> cap). Second chunk completes a
        # newline plus a normal line, proving the cursor advanced past the flush.
        events, _ = _drive_run([big, "\ndone\n"], exit_code=0)
        stdout = [e for e in events if e.get("event") == "stdout"]
        flushed = [e for e in stdout if len(e["line"]) > sidecar.MAX_PARTIAL_BYTES]
        # The oversized partial is emitted EXACTLY ONCE (not re-read every poll)…
        self.assertEqual(len(flushed), 1)
        # …carries the full partial content…
        self.assertEqual(len(flushed[0]["line"]), sidecar.MAX_PARTIAL_BYTES + 10)
        # …and is marked truncated so a Node consumer can surface it.
        self.assertTrue(flushed[0].get("truncated"))
        # The line after the flushed bytes still streams (offset advanced past it).
        self.assertIn("done", [e["line"] for e in stdout])

    def test_partial_under_the_cap_is_still_pushed_back_not_flushed(self):
        # A sub-cap partial keeps the prior behaviour: held, not flushed truncated.
        events, _ = _drive_run(["par", "tial\ndone\n"], exit_code=0)
        stdout = [e for e in events if e.get("event") == "stdout"]
        self.assertEqual([e["line"] for e in stdout], ["partial", "done"])
        self.assertFalse(any(e.get("truncated") for e in stdout))


class UnifiedDrainTests(unittest.TestCase):
    """The final drain emits the same lines the streaming loop would: interior
    blanks survive, only the empty segment after a trailing newline is dropped,
    and a trailing partial is emitted as its own final line.

    Implements ``features/protocol-diagnostics/unify-blank-line-drain.feature``.
    """

    def test_interior_blank_lines_survive_the_drain(self):
        # The sentinel is present with multi-line content still undrained; the
        # drain must emit the interior blank between "a" and "b".
        events = _drive_drain("a\n\nb\n", exit_code=0)
        stdout = [e["line"] for e in events if e.get("event") == "stdout"]
        self.assertEqual(stdout, ["a", "", "b"])

    def test_only_the_segment_after_a_trailing_newline_is_dropped(self):
        events = _drive_drain("solo\n", exit_code=0)
        stdout = [e["line"] for e in events if e.get("event") == "stdout"]
        # "solo\n".split → ["solo", ""]; the trailing "" is dropped, "solo" stays.
        self.assertEqual(stdout, ["solo"])

    def test_trailing_partial_without_newline_is_emitted_by_the_drain(self):
        events = _drive_drain("a\nb", exit_code=0)
        stdout = [e["line"] for e in events if e.get("event") == "stdout"]
        # No trailing newline → the last segment "b" is a final line, emitted.
        self.assertEqual(stdout, ["a", "b"])


class MakeDeploymentTests(unittest.TestCase):
    def setUp(self):
        for k in (
            "REX_IMAGE", "REX_MOUNT_HOST", "REX_MOUNT_CONTAINER",
            "REX_DOCKER_USER", "REX_DOCKER_MEMORY", "REX_DOCKER_PIDS_LIMIT",
            "REX_DOCKER_CPUS", "REX_DOCKER_NETWORK",
        ):
            os.environ.pop(k, None)
        CAPTURED.clear()

    def _expected_default_args(self, mount_host="/host/project", mount_container="/workspace"):
        """The full default docker_args (mount + hardening defaults).

        ``--user`` defaults to the current host uid:gid (resolved by the sidecar
        via os.getuid()/os.getgid()), so the expected value is dynamic.
        """
        return [
            "-v", f"{mount_host}:{mount_container}",
            "--user", f"{os.getuid()}:{os.getgid()}",
            "--memory", sidecar.DEFAULT_DOCKER_MEMORY,
            "--pids-limit", sidecar.DEFAULT_DOCKER_PIDS_LIMIT,
            "--network", sidecar.DEFAULT_DOCKER_NETWORK,
        ]

    def test_docker_builds_the_v_mount_argv_from_mount_env(self):
        os.environ["REX_IMAGE"] = "my/image:tag"
        os.environ["REX_MOUNT_HOST"] = "/host/project"
        os.environ["REX_MOUNT_CONTAINER"] = "/workspace"
        sidecar._make_deployment("docker")
        self.assertEqual(CAPTURED["docker"]["image"], "my/image:tag")
        self.assertEqual(
            CAPTURED["docker"]["docker_args"],
            self._expected_default_args(),
        )

    def test_docker_uses_rex_image_verbatim(self):
        os.environ["REX_IMAGE"] = "my/image:tag"
        os.environ["REX_MOUNT_HOST"] = "/host/project"
        os.environ["REX_MOUNT_CONTAINER"] = "/workspace"
        sidecar._make_deployment("docker")
        self.assertEqual(CAPTURED["docker"]["image"], "my/image:tag")
        self.assertEqual(
            CAPTURED["docker"]["docker_args"],
            self._expected_default_args(),
        )

    def test_docker_unset_rex_image_raises(self):
        # Unset/empty REX_IMAGE raises a clear error naming REX_IMAGE instead of
        # silently falling back to a built-in image (the default lives solely in
        # config.ts and Node always threads it).
        os.environ["REX_MOUNT_HOST"] = "/host/project"
        with self.assertRaises(ValueError) as ctx:
            sidecar._make_deployment("docker")
        self.assertIn("REX_IMAGE", str(ctx.exception))
        self.assertNotIn("docker", CAPTURED)

    def test_docker_empty_rex_image_raises(self):
        os.environ["REX_IMAGE"] = "   "
        with self.assertRaises(ValueError):
            sidecar._make_deployment("docker")

    def test_docker_omits_v_mount_when_mount_host_unset_but_keeps_hardening(self):
        # No REX_MOUNT_HOST -> no `-v`, but hardening knobs are still applied.
        os.environ["REX_IMAGE"] = "no/mount:image"
        sidecar._make_deployment("docker")
        args = CAPTURED["docker"]["docker_args"]
        self.assertNotIn("-v", args)
        self.assertIn("--user", args)
        self.assertIn("--memory", args)
        self.assertIn("--pids-limit", args)
        self.assertIn("--network", args)
        # cpus is opt-in and unset -> no --cpus flag.
        self.assertNotIn("--cpus", args)

    def test_docker_all_hardening_knobs_threaded_together(self):
        os.environ["REX_IMAGE"] = "all/knobs:image"
        os.environ["REX_MOUNT_HOST"] = "/host/project"
        os.environ["REX_MOUNT_CONTAINER"] = "/workspace"
        os.environ["REX_DOCKER_USER"] = "2000:2000"
        os.environ["REX_DOCKER_MEMORY"] = "4g"
        os.environ["REX_DOCKER_PIDS_LIMIT"] = "1024"
        os.environ["REX_DOCKER_CPUS"] = "2"
        os.environ["REX_DOCKER_NETWORK"] = "none"
        sidecar._make_deployment("docker")
        args = CAPTURED["docker"]["docker_args"]
        self.assertEqual(args, [
            "-v", "/host/project:/workspace",
            "--user", "2000:2000",
            "--memory", "4g",
            "--pids-limit", "1024",
            "--network", "none",
            "--cpus", "2",
        ])

    def test_local_uses_local_deployment(self):
        sidecar._make_deployment("local")
        self.assertTrue(CAPTURED.get("local"))
        self.assertNotIn("docker", CAPTURED)


class DockerHardeningTests(unittest.TestCase):
    """Cover the REX_DOCKER_* knobs (features/docker-locus-hardening)."""

    def setUp(self):
        for k in (
            "REX_IMAGE", "REX_MOUNT_HOST", "REX_MOUNT_CONTAINER",
            "REX_DOCKER_USER", "REX_DOCKER_MEMORY", "REX_DOCKER_PIDS_LIMIT",
            "REX_DOCKER_CPUS", "REX_DOCKER_NETWORK",
        ):
            os.environ.pop(k, None)
        # REX_IMAGE is now required (no Python-side default); give the
        # hardening tests a placeholder so they exercise the knobs, not the
        # image-required guard.
        os.environ["REX_IMAGE"] = "hardening/image:tag"
        CAPTURED.clear()

    def _args(self):
        sidecar._make_deployment("docker")
        return CAPTURED["docker"]["docker_args"]

    def test_user_defaults_to_host_uid_gid(self):
        args = self._args()
        i = args.index("--user")
        self.assertEqual(args[i + 1], f"{os.getuid()}:{os.getgid()}")

    def test_configured_user_overrides_host_default(self):
        os.environ["REX_DOCKER_USER"] = "0:0"
        args = self._args()
        i = args.index("--user")
        self.assertEqual(args[i + 1], "0:0")

    def test_memory_and_pids_default_applied(self):
        args = self._args()
        self.assertIn("--memory", args)
        self.assertEqual(args[args.index("--memory") + 1], sidecar.DEFAULT_DOCKER_MEMORY)
        self.assertIn("--pids-limit", args)
        self.assertEqual(
            args[args.index("--pids-limit") + 1], sidecar.DEFAULT_DOCKER_PIDS_LIMIT
        )

    def test_configured_memory_and_pids_override_defaults(self):
        os.environ["REX_DOCKER_MEMORY"] = "512m"
        os.environ["REX_DOCKER_PIDS_LIMIT"] = "128"
        args = self._args()
        self.assertEqual(args[args.index("--memory") + 1], "512m")
        self.assertEqual(args[args.index("--pids-limit") + 1], "128")

    def test_cpus_omitted_when_unset(self):
        args = self._args()
        self.assertNotIn("--cpus", args)

    def test_configured_cpus_applied(self):
        os.environ["REX_DOCKER_CPUS"] = "1.5"
        args = self._args()
        self.assertEqual(args[args.index("--cpus") + 1], "1.5")

    def test_network_defaults_to_bridge(self):
        args = self._args()
        self.assertEqual(args[args.index("--network") + 1], "bridge")

    def test_configured_network_applied(self):
        os.environ["REX_DOCKER_NETWORK"] = "none"
        args = self._args()
        self.assertEqual(args[args.index("--network") + 1], "none")

    def test_repo_mount_stays_read_write(self):
        os.environ["REX_MOUNT_HOST"] = "/host/project"
        os.environ["REX_MOUNT_CONTAINER"] = "/workspace"
        args = self._args()
        i = args.index("-v")
        mount = args[i + 1]
        self.assertEqual(mount, "/host/project:/workspace")
        self.assertNotIn(":ro", mount)


class DockerHardeningValidationTests(unittest.TestCase):
    """Fail-before-spawn: a malformed REX_DOCKER_* value raises before docker run."""

    def setUp(self):
        for k in (
            "REX_IMAGE", "REX_MOUNT_HOST", "REX_MOUNT_CONTAINER",
            "REX_DOCKER_USER", "REX_DOCKER_MEMORY", "REX_DOCKER_PIDS_LIMIT",
            "REX_DOCKER_CPUS", "REX_DOCKER_NETWORK",
        ):
            os.environ.pop(k, None)
        os.environ["REX_IMAGE"] = "validation/image:tag"
        CAPTURED.clear()

    def test_non_integer_pids_limit_raises(self):
        os.environ["REX_DOCKER_PIDS_LIMIT"] = "lots"
        with self.assertRaises(RuntimeError) as ctx:
            sidecar._make_deployment("docker")
        self.assertIn("REX_DOCKER_PIDS_LIMIT", str(ctx.exception))

    def test_non_positive_pids_limit_raises(self):
        os.environ["REX_DOCKER_PIDS_LIMIT"] = "0"
        with self.assertRaises(RuntimeError):
            sidecar._make_deployment("docker")

    def test_non_numeric_cpus_raises(self):
        os.environ["REX_DOCKER_CPUS"] = "fast"
        with self.assertRaises(RuntimeError) as ctx:
            sidecar._make_deployment("docker")
        self.assertIn("REX_DOCKER_CPUS", str(ctx.exception))

    def test_non_positive_cpus_raises(self):
        os.environ["REX_DOCKER_CPUS"] = "0"
        with self.assertRaises(RuntimeError):
            sidecar._make_deployment("docker")


class RunDirAndPidfileTests(unittest.TestCase):
    """Cover the job-control launcher, run_dir threading, and pidfile tracking
    added by the reap-agents-on-teardown change."""

    def setUp(self):
        sidecar.emit = lambda obj: None  # swallow
        sidecar.POLL_INTERVAL = 0

    def test_run_dir_threads_into_sentinel_paths(self):
        events, runtime, sc = _drive_run_with_run_dir(
            ["line\n"], exit_code=0, run_dir="/custom/run"
        )
        # The launcher writes the log/done/pid sentinels UNDER run_dir.
        launchers = [c for c in runtime.commands if c.startswith("nohup ")]
        self.assertTrue(any("/custom/run/ratchet-rex-" in c for c in launchers))
        # The pre-launch rm also targets run_dir.
        rms = [c for c in runtime.commands if c.startswith("rm -f")]
        self.assertTrue(any("/custom/run/ratchet-rex-" in c for c in rms))

    def test_launcher_uses_job_control_and_writes_pidfile(self):
        events, runtime, sc = _drive_run_with_run_dir(
            ["line\n"], exit_code=0, run_dir="/rd"
        )
        launchers = [c for c in runtime.commands if c.startswith("nohup ")]
        self.assertEqual(len(launchers), 1)
        launcher = launchers[0]
        # `set -m` makes the backgrounded pipeline its own process-group leader.
        self.assertIn("set -m", launcher)
        # The pidfile is written (`echo $! > <pid>`) so shutdown can find the group.
        self.assertIn("echo $! > ", launcher)
        self.assertIn(".pid", launcher)
        # The exit code is collected into the done sentinel.
        self.assertIn("echo $? > ", launcher)
        self.assertIn(".done", launcher)

    def test_run_pidfile_cleared_after_run_completes(self):
        events, runtime, sc = _drive_run_with_run_dir(
            ["line\n"], exit_code=0, run_dir="/rd"
        )
        # After a clean run the pidfile is cleared (the run reaped itself).
        self.assertIsNone(sc.run_pidfile)

    def test_run_dir_absent_falls_back_to_workdir(self):
        events, runtime = _drive_run(["line\n"], exit_code=0)
        launchers = [c for c in runtime.commands if c.startswith("nohup ")]
        # No run_dir -> sentinels under workdir (/tmp).
        self.assertTrue(any("/tmp/ratchet-rex-" in c for c in launchers))


class ReapAgentGroupTests(unittest.TestCase):
    """Cover _reap_agent_group: TERM→grace→KILL, idempotency, and edge cases."""

    def setUp(self):
        sidecar.emit = lambda obj: None
        sidecar.POLL_INTERVAL = 0

    def _make_sidecar_with_pidfile(self, pgid_response=""):
        """Build a Sidecar whose runtime scripts `cat <pidfile>` → pgid."""
        sc = sidecar.Sidecar()
        sc.workdir = "/tmp"
        sc.run_pidfile = "/tmp/ratchet-rex-deadbeef.pid"
        sc._shutdown_grace_s = 0  # no real sleeps in the reap sequence
        runtime = _ReapFakeRuntime(pgid_response=pgid_response)
        sc.runtime = runtime
        return sc, runtime

    def test_term_then_grace_then_kill(self):
        sc, runtime = self._make_sidecar_with_pidfile(pgid_response="4242")
        asyncio.run(sc._reap_agent_group())
        kills = [c for c in runtime.commands if c.startswith("kill ")]
        # Exactly TERM then KILL, in order, targeting the negative pgid.
        self.assertEqual(len(kills), 2)
        self.assertIn("kill -TERM -- -4242", kills[0])
        self.assertIn("kill -KILL -- -4242", kills[1])
        # Pidfile claimed (cleared) so a second call is a no-op.
        self.assertIsNone(sc.run_pidfile)

    def test_idempotent_second_call_is_noop(self):
        sc, runtime = self._make_sidecar_with_pidfile(pgid_response="4242")
        asyncio.run(sc._reap_agent_group())
        n_before = len(runtime.commands)
        asyncio.run(sc._reap_agent_group())
        self.assertEqual(len(runtime.commands), n_before)

    def test_missing_pidfile_is_noop(self):
        sc = sidecar.Sidecar()
        sc.runtime = _ReapFakeRuntime()
        sc.run_pidfile = None
        runtime = sc.runtime
        asyncio.run(sc._reap_agent_group())
        self.assertEqual(runtime.commands, [])

    def test_empty_or_nonnumeric_pgid_skips_kill(self):
        sc, runtime = self._make_sidecar_with_pidfile(pgid_response="")
        asyncio.run(sc._reap_agent_group())
        kills = [c for c in runtime.commands if c.startswith("kill ")]
        self.assertEqual(kills, [])

    def test_sweeps_sentinels_after_reap(self):
        sc, runtime = self._make_sidecar_with_pidfile(pgid_response="4242")
        asyncio.run(sc._reap_agent_group())
        rms = [c for c in runtime.commands if c.startswith("rm -f")]
        self.assertTrue(len(rms) >= 1)
        self.assertIn(".pid", rms[0])


class ShutdownReapsBeforeStopTests(unittest.TestCase):
    """shutdown() must reap the agent group BEFORE stopping the deployment."""

    def setUp(self):
        sidecar.emit = lambda obj: None
        sidecar.POLL_INTERVAL = 0

    def test_shutdown_reaps_group_then_stops_deployment(self):
        sc = sidecar.Sidecar()
        sc.workdir = "/tmp"
        sc.run_pidfile = "/tmp/ratchet-rex-deadbeef.pid"
        sc._shutdown_grace_s = 0
        runtime = _ReapFakeRuntime(pgid_response="4242")
        sc.runtime = runtime
        stop_order: list[str] = []

        class FakeDeployment:
            async def stop(self):
                stop_order.append("stop")

        sc.deployment = FakeDeployment()
        emitted: list[dict] = []
        sidecar.emit = lambda obj: emitted.append(obj)
        asyncio.run(sc.shutdown())
        # The reap kill commands appear BEFORE the deployment.stop() call.
        first_kill_idx = next(
            (i for i, c in enumerate(runtime.commands) if c.startswith("kill ")), None
        )
        self.assertIsNotNone(first_kill_idx)
        self.assertEqual(stop_order, ["stop"])
        self.assertIn({"event": "closed"}, emitted)


class _ReapFakeRuntime:
    """A minimal runtime for _reap_agent_group/shutdown tests: records every
    command and scripts `cat <pidfile>` to return a pgid string."""

    def __init__(self, pgid_response: str = ""):
        self.commands: list[str] = []
        self._pgid = pgid_response

    async def execute(self, command):
        cmd = command.command
        self.commands.append(cmd)
        if cmd.startswith("cat ") and ".pid" in cmd:
            return FakeExecResult(self._pgid + "\n")
        return FakeExecResult("")


def _drive_run_with_run_dir(log_chunks, exit_code, run_dir):
    """Like _drive_run but passes run_dir; returns (events, runtime, sidecar)."""
    events: list[dict] = []
    sidecar.emit = lambda obj: events.append(obj)
    sidecar.POLL_INTERVAL = 0
    sc = sidecar.Sidecar()
    sc.workdir = "/tmp"
    sc.runtime = FakeRuntime(log_chunks, exit_code)
    asyncio.run(sc.run(run_id=1, command="agent --go", run_dir=run_dir))
    return events, sc.runtime, sc


class _DrainFakeRuntime:
    """A runtime that streams nothing, then reveals all content in ONE shot on the
    final drain — the first `tail` is empty, `cat <done>` reports the sentinel
    immediately, and the SECOND `tail` (the post-sentinel drain) returns the whole
    remaining logfile. Exercises the final-drain split discipline in isolation."""

    def __init__(self, drain_content: str, exit_code: int = 0):
        self._drain_content = drain_content
        self._exit_code = exit_code
        self._tail_calls = 0
        self.commands: list[str] = []

    async def execute(self, command):
        cmd = command.command
        self.commands.append(cmd)
        if cmd.startswith("rm -f") or cmd.startswith("nohup"):
            return FakeExecResult("")
        if cmd.startswith("tail -c +"):
            self._tail_calls += 1
            # 1st tail: nothing streamed yet; 2nd tail: the drain returns it all.
            return FakeExecResult(self._drain_content if self._tail_calls >= 2 else "")
        if cmd.startswith("cat "):
            # Sentinel present from the first check so the run enters the drain.
            return FakeExecResult(f"{self._exit_code}\n")
        return FakeExecResult("")


def _drive_drain(drain_content, exit_code=0):
    """Drive Sidecar.run so all output lands in the final drain; return events."""
    events: list[dict] = []
    sidecar.emit = lambda obj: events.append(obj)
    sidecar.POLL_INTERVAL = 0
    sc = sidecar.Sidecar()
    sc.workdir = "/tmp"
    sc.runtime = _DrainFakeRuntime(drain_content, exit_code)
    asyncio.run(sc.run(run_id=1, command="agent --go"))
    return events


class ShquoteContractTests(unittest.TestCase):
    """Cross-language shquote contract test (Python side).

    Implements ``features/shquote-contract/cross-language-vectors.feature``.
    Loads the SAME ``shquote-vectors.json`` the TS vitest contract test loads
    (next to this file), so a change to either ``_shquote`` (Python) or
    ``shquote`` (TS) that breaks parity fails a test in its own language.
    Neither this test nor the TS side embeds a private copy of the vectors.
    """

    VECTORS_PATH = Path(__file__).resolve().parent / "shquote-vectors.json"

    def _vectors(self):
        import json

        with self.VECTORS_PATH.open("r", encoding="utf-8") as fh:
            return json.load(fh)

    def test_vectors_cover_the_required_metacharacter_classes(self):
        inputs = {v["input"] for v in self._vectors()}
        self.assertIn("", inputs)
        self.assertTrue(any(" " in s for s in inputs))
        self.assertTrue(any("'" in s for s in inputs))
        self.assertTrue(any('"' in s for s in inputs))
        self.assertTrue(any("$" in s for s in inputs))
        self.assertTrue(any("`" in s for s in inputs))
        self.assertTrue(any("\n" in s for s in inputs))

    def test_python_shquote_satisfies_every_vector(self):
        for v in self._vectors():
            with self.subTest(input=v["input"]):
                self.assertEqual(sidecar._shquote(v["input"]), v["quoted"])


class CursorContractTests(unittest.TestCase):
    """Cross-language cursor-arithmetic contract test (Python side).

    Implements ``features/cursor-alignment/surrogateescape-byte-cursor.feature``.
    Loads the SAME ``cursor-vectors.json`` the TS vitest contract test loads (next
    to this file), so a change to either the TS ``surrogateEscapeByteLength`` or
    the sidecar's ``encode("utf-8", "surrogateescape")`` cursor arithmetic that
    breaks parity fails a test in its own language. The sidecar's tail-poll offset
    advances by exactly ``len(chunk.encode("utf-8", "surrogateescape"))``, so this
    asserts that quantity equals the vector's recorded byte count.
    """

    VECTORS_PATH = Path(__file__).resolve().parent / "cursor-vectors.json"

    def _vectors(self):
        import json

        with self.VECTORS_PATH.open("r", encoding="utf-8") as fh:
            return json.load(fh)

    def test_vectors_cover_the_required_classes(self):
        texts = [v["text"] for v in self._vectors()]
        self.assertIn("", texts)  # empty string
        self.assertTrue(any(t and all(ord(c) < 0x80 for c in t) for t in texts))  # ASCII
        self.assertTrue(any(any(ord(c) > 0x7F for c in t) for t in texts))  # multibyte
        self.assertTrue(any(any(0xDC80 <= ord(c) <= 0xDCFF for c in t) for t in texts))  # lone surrogate

    def test_sidecar_encode_arithmetic_matches_every_vector(self):
        for v in self._vectors():
            with self.subTest(text=v["text"]):
                self.assertEqual(
                    len(v["text"].encode("utf-8", "surrogateescape")), v["bytes"]
                )


if __name__ == "__main__":
    unittest.main()
