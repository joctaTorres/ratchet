import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  makeRexSidecarRuntime,
  buildRunCommand,
  hostToContainerPath,
  DOCKER_MOUNT_CONTAINER,
  type SidecarChild,
  type SidecarDeps,
} from '../../src/core/batch/engine/runtime/rex-sidecar-runtime.js';
import type { BootstrapOptions } from '../../src/core/batch/engine/runtime/rex-bootstrap.js';
import { RexBootstrapError, type ResolvedLaunch } from '../../src/core/batch/engine/runtime/rex-bootstrap.js';
import type { AgentSpawnRequest } from '../../src/core/batch/engine/agent.js';
import type { AgentEvent } from '../../src/core/batch/engine/runtime/contract.js';

/**
 * A fake sidecar child: a programmable, in-memory stand-in for the spawned
 * Python process. The test scripts the JSON lines the sidecar emits in response
 * to the ops the runtime sends — no real process or Python is started.
 */
class FakeChild extends EventEmitter implements SidecarChild {
  stdoutEmitter = new EventEmitter();
  stderrEmitter = new EventEmitter();
  /** Ops the runtime wrote to stdin (parsed JSON). */
  ops: any[] = [];
  killed: NodeJS.Signals[] = [];
  /** A fake OS pid so teardown's `killGroup(pid, sig)` seam is exercised. */
  pid: number | null = 4242;

  stdout = {
    setEncoding: () => {},
    on: (_e: 'data', listener: (chunk: string) => void) =>
      this.stdoutEmitter.on('data', listener),
  };
  stderr = {
    setEncoding: () => {},
    on: (_e: 'data', listener: (chunk: string) => void) =>
      this.stderrEmitter.on('data', listener),
  };
  stdin = {
    write: (chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (line.trim()) this.ops.push(JSON.parse(line));
      }
      this.onOp?.(this.ops[this.ops.length - 1], this);
    },
    end: () => {},
  };

  /** Called after each op is written, so a test can script the reply. */
  onOp?: (op: any, self: FakeChild) => void;

  kill(signal: NodeJS.Signals = 'SIGTERM') {
    this.killed.push(signal);
  }

  /** Push one JSON line onto the protocol stdout stream. */
  emitLine(obj: unknown) {
    this.stdoutEmitter.emit('data', JSON.stringify(obj) + '\n');
  }
}

const LAUNCH: ResolvedLaunch = { command: 'python', args: ['sidecar.py'], env: {} };

function request(over: Partial<AgentSpawnRequest> = {}): AgentSpawnRequest {
  return {
    command: 'claude',
    args: ['-p'],
    instructions: 'do the thing',
    cwd: '/proj',
    env: { RATCHET_BATCH_NAME: 'b' },
    ...over,
  };
}

/** Build deps backed by a FakeChild + an in-memory fs, with the timer real. */
function fakeDeps(child: FakeChild, over: Partial<SidecarDeps> = {}): {
  deps: SidecarDeps;
  files: Map<string, string>;
  removed: string[];
  killGroups: { pid: number; signal: NodeJS.Signals }[];
} {
  const files = new Map<string, string>();
  const removed: string[] = [];
  const killGroups: { pid: number; signal: NodeJS.Signals }[] = [];
  const deps: SidecarDeps = {
    spawn: () => child,
    bootstrap: () => LAUNCH,
    mkdirp: () => {},
    writeText: (p, content) => files.set(p, content),
    rmrf: (p) => removed.push(p),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h),
    killGroup: (pid, signal) => killGroups.push({ pid, signal }),
    ...over,
  };
  return { deps, files, removed, killGroups };
}

describe('makeRexSidecarRuntime', () => {
  it('drives ready→run→stdout→exit→shutdown→closed and accumulates the transcript', async () => {
    const child = new FakeChild();
    const { deps, removed } = fakeDeps(child);
    const runtime = makeRexSidecarRuntime({ projectRoot: '/proj', deps });
    const events: AgentEvent[] = [];

    // Script the sidecar: ready first; on `run` stream three lines + exit; on
    // `shutdown` emit closed and exit the child.
    child.onOp = (op, self) => {
      if (op.op === 'run') {
        for (const line of ['alpha', 'beta', 'gamma']) {
          self.emitLine({ event: 'stdout', id: op.id, line });
        }
        self.emitLine({ event: 'exit', id: op.id, exit_code: 0 });
      } else if (op.op === 'shutdown') {
        self.emitLine({ event: 'closed' });
        self.emit('exit', 0, null);
      }
    };

    const runPromise = runtime(request(), (e) => events.push(e));
    // Kick off the lifecycle by emitting ready.
    child.emitLine({ event: 'ready', locus: 'local' });

    const result = await runPromise;

    // One run op carrying the agent command.
    const runOps = child.ops.filter((o) => o.op === 'run');
    expect(runOps).toHaveLength(1);
    expect(runOps[0].command).toContain('claude');
    // Streamed AND accumulated.
    expect(events.filter((e) => e.kind === 'stdout').map((e) => e.line)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
    expect(result.stdout).toContain('alpha');
    expect(result.stdout).toContain('beta');
    expect(result.stdout).toContain('gamma');
    expect(result.exitCode).toBe(0);
    // Exit event carried the exit code; shutdown was sent after exit.
    expect(events.find((e) => e.kind === 'exit')?.exitCode).toBe(0);
    expect(child.ops.some((o) => o.op === 'shutdown')).toBe(true);
    // On the CLEAN path the sidecar exits itself (closed → exit), so teardown
    // does NOT escalate to a kill — the run dir is swept instead (the "no
    // leftover" guarantee). No kill, no killGroup.
    expect(child.killed).toHaveLength(0);
    expect(removed.length).toBeGreaterThan(0);
  });

  it('reports a non-zero agent exit in the accumulated result', async () => {
    const child = new FakeChild();
    const { deps } = fakeDeps(child);
    const runtime = makeRexSidecarRuntime({ projectRoot: '/proj', deps });

    child.onOp = (op, self) => {
      if (op.op === 'run') {
        self.emitLine({ event: 'stdout', id: op.id, line: 'one line' });
        self.emitLine({ event: 'exit', id: op.id, exit_code: 2 });
      } else if (op.op === 'shutdown') {
        self.emitLine({ event: 'closed' });
        self.emit('exit', 0, null);
      }
    };

    const runPromise = runtime(request(), () => {});
    child.emitLine({ event: 'ready', locus: 'local' });
    const result = await runPromise;

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain('one line');
  });

  it('surfaces a sidecar error event as a failed result with the message in stderr', async () => {
    const child = new FakeChild();
    const { deps } = fakeDeps(child);
    const runtime = makeRexSidecarRuntime({ projectRoot: '/proj', deps });
    const events: AgentEvent[] = [];

    child.onOp = (op, self) => {
      if (op.op === 'run') {
        self.emitLine({ event: 'error', id: op.id, message: 'boom in the session' });
      } else if (op.op === 'shutdown') {
        self.emitLine({ event: 'closed' });
        self.emit('exit', 0, null);
      }
    };

    const runPromise = runtime(request(), (e) => events.push(e));
    child.emitLine({ event: 'ready', locus: 'local' });
    const result = await runPromise;

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('boom in the session');
    expect(events.find((e) => e.kind === 'error')?.message).toContain('boom');
  });

  it('propagates a RexBootstrapError (missing Python) as a failed result with the remedy', async () => {
    const child = new FakeChild();
    const { deps } = fakeDeps(child, {
      bootstrap: () => {
        throw new RexBootstrapError('no Python interpreter was found on PATH. Install it…');
      },
    });
    const runtime = makeRexSidecarRuntime({ projectRoot: '/proj', deps });
    const events: AgentEvent[] = [];

    const result = await runtime(request(), (e) => events.push(e));

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Python');
    expect(events.find((e) => e.kind === 'error')?.message).toContain('Python');
  });

  it('writes the prompt file under the batch run dir and removes it after the run', async () => {
    const child = new FakeChild();
    const { deps, files, removed } = fakeDeps(child);
    const runtime = makeRexSidecarRuntime({ projectRoot: '/proj', deps });

    child.onOp = (op, self) => {
      if (op.op === 'run') self.emitLine({ event: 'exit', id: op.id, exit_code: 0 });
      else if (op.op === 'shutdown') {
        self.emitLine({ event: 'closed' });
        self.emit('exit', 0, null);
      }
    };

    const runPromise = runtime(request({ instructions: 'PROMPT BODY' }), () => {});
    child.emitLine({ event: 'ready', locus: 'local' });
    await runPromise;

    const promptPath = [...files.keys()].find((p) => p.endsWith('prompt.txt'));
    expect(promptPath).toBeDefined();
    expect(promptPath).toContain('.ratchet/batches/b/.run/');
    expect(files.get(promptPath!)).toBe('PROMPT BODY');
    // The run command fed the prompt file to the agent via `cat … | …`.
    const runOp = child.ops.find((o) => o.op === 'run');
    expect(runOp.command).toContain('cat ');
    expect(runOp.command).toContain('prompt.txt');
    expect(runOp.command).toContain('| ');
    // Cleaned up.
    expect(removed.some((p) => p.includes('.run/'))).toBe(true);
  });

  it('maps a host path under the project root to the in-container mount path', () => {
    expect(
      hostToContainerPath('/host/project/.ratchet/x/prompt.txt', '/host/project', '/workspace')
    ).toBe('/workspace/.ratchet/x/prompt.txt');
    // A path NOT under the root is returned unchanged (defensive fallback).
    expect(hostToContainerPath('/elsewhere/f', '/host/project', '/workspace')).toBe(
      '/elsewhere/f'
    );
  });

  it('threads a cwd as a leading `cd <cwd>;` (parity with the remote runtime)', () => {
    const cmd = buildRunCommand(
      '/tmp/run/prompt.txt',
      { command: 'claude', args: ['-p'], instructions: '', cwd: '/proj', env: {} },
      '/the/workdir'
    );
    expect(cmd).toBe("cd '/the/workdir'; cat '/tmp/run/prompt.txt' | 'claude' '-p'");
  });

  it('omits the `cd` when no cwd is given (inherits the ReX session cwd)', () => {
    const cmd = buildRunCommand('/tmp/run/prompt.txt', {
      command: 'claude',
      args: ['-p'],
      instructions: '',
      cwd: '/proj',
      env: {},
    });
    expect(cmd.startsWith('cat ')).toBe(true);
    expect(cmd).not.toContain('cd ');
  });

  it('feeds the prompt file to a bash -c override command too', () => {
    const cmd = buildRunCommand('/tmp/run/prompt.txt', {
      command: 'bash',
      args: ['-c', 'echo stub-agent'],
      instructions: 'ignored',
      cwd: '/proj',
      env: {},
    });
    expect(cmd).toContain("cat '/tmp/run/prompt.txt'");
    expect(cmd).toContain("'bash' '-c' 'echo stub-agent'");
    expect(cmd.startsWith('cat ')).toBe(true);
    expect(cmd).toContain('| ');
    expect(cmd).not.toContain('--output-format stream-json');
  });

  it('keeps the claude argv plain (no stream-json) in the run command', async () => {
    const child = new FakeChild();
    const { deps } = fakeDeps(child);
    const runtime = makeRexSidecarRuntime({ projectRoot: '/proj', deps });

    child.onOp = (op, self) => {
      if (op.op === 'run') self.emitLine({ event: 'exit', id: op.id, exit_code: 0 });
      else if (op.op === 'shutdown') {
        self.emitLine({ event: 'closed' });
        self.emit('exit', 0, null);
      }
    };

    const runPromise = runtime(request(), () => {});
    child.emitLine({ event: 'ready', locus: 'local' });
    await runPromise;

    const runOp = child.ops.find((o) => o.op === 'run');
    expect(runOp.command).toContain("'claude' '-p'");
    expect(runOp.command).not.toContain('stream-json');
  });

  it('passes locus + workdir into the bootstrap (REX_LOCUS / REX_WORKDIR)', async () => {
    const child = new FakeChild();
    let bootstrapArgs: any;
    const { deps } = fakeDeps(child, {
      bootstrap: (opts) => {
        bootstrapArgs = opts;
        return LAUNCH;
      },
    });
    const runtime = makeRexSidecarRuntime({ projectRoot: '/the/root', locus: 'local', deps });

    child.onOp = (op, self) => {
      if (op.op === 'run') self.emitLine({ event: 'exit', id: op.id, exit_code: 0 });
      else if (op.op === 'shutdown') {
        self.emitLine({ event: 'closed' });
        self.emit('exit', 0, null);
      }
    };

    const runPromise = runtime(request(), () => {});
    child.emitLine({ event: 'ready', locus: 'local' });
    await runPromise;

    expect(bootstrapArgs.locus).toBe('local');
    expect(bootstrapArgs.workdir).toBe('/the/root');
  });

  it('threads docker image + projectRoot→mount and maps REX_WORKDIR to the mount path', async () => {
    const child = new FakeChild();
    let bootstrapArgs: BootstrapOptions | undefined;
    const { deps } = fakeDeps(child, {
      bootstrap: (opts) => {
        bootstrapArgs = opts;
        return LAUNCH;
      },
    });
    const runtime = makeRexSidecarRuntime({
      projectRoot: '/host/project',
      locus: 'docker',
      image: 'my/image:tag',
      deps,
    });

    child.onOp = (op, self) => {
      if (op.op === 'run') self.emitLine({ event: 'exit', id: op.id, exit_code: 0 });
      else if (op.op === 'shutdown') {
        self.emitLine({ event: 'closed' });
        self.emit('exit', 0, null);
      }
    };

    const runPromise = runtime(request({ cwd: '/host/project' }), () => {});
    child.emitLine({ event: 'ready', locus: 'docker' });
    await runPromise;

    expect(bootstrapArgs?.locus).toBe('docker');
    expect(bootstrapArgs?.image).toBe('my/image:tag');
    // The project root is the bind-mount host; the container mount is /workspace
    // and REX_WORKDIR maps to it (NOT the host path).
    expect(bootstrapArgs?.mountHost).toBe('/host/project');
    expect(bootstrapArgs?.mountContainer).toBe(DOCKER_MOUNT_CONTAINER);
    expect(bootstrapArgs?.workdir).toBe(DOCKER_MOUNT_CONTAINER);

    // The run command cats the prompt at its IN-CONTAINER path (under the mount),
    // not the host path.
    const runOp = child.ops.find((o) => o.op === 'run');
    expect(runOp.command).toContain(`${DOCKER_MOUNT_CONTAINER}/.ratchet/batches/`);
    expect(runOp.command).toContain('prompt.txt');
    expect(runOp.command).not.toContain('/host/project/.ratchet');
    // req.cwd (the host project root) is threaded as a `cd` onto the IN-CONTAINER
    // mount path, NOT the host path which does not exist inside the container.
    expect(runOp.command.startsWith(`cd '${DOCKER_MOUNT_CONTAINER}';`)).toBe(true);
    expect(runOp.command).not.toContain(`cd '/host/project'`);
  });

  it('threads req.cwd as a leading `cd` in the local run command', async () => {
    const child = new FakeChild();
    const { deps } = fakeDeps(child, { bootstrap: () => LAUNCH });
    const runtime = makeRexSidecarRuntime({ projectRoot: '/proj', deps });

    child.onOp = (op, self) => {
      if (op.op === 'run') self.emitLine({ event: 'exit', id: op.id, exit_code: 0 });
      else if (op.op === 'shutdown') {
        self.emitLine({ event: 'closed' });
        self.emit('exit', 0, null);
      }
    };

    const runPromise = runtime(request({ cwd: '/proj/sub' }), () => {});
    child.emitLine({ event: 'ready', locus: 'local' });
    await runPromise;

    const runOp = child.ops.find((o) => o.op === 'run');
    // Local: req.cwd is used verbatim (no path translation).
    expect(runOp.command.startsWith(`cd '/proj/sub';`)).toBe(true);
  });

  it('does not pass image/mount and keeps the host workdir for local', async () => {
    const child = new FakeChild();
    let bootstrapArgs: BootstrapOptions | undefined;
    const { deps } = fakeDeps(child, {
      bootstrap: (opts) => {
        bootstrapArgs = opts;
        return LAUNCH;
      },
    });
    const runtime = makeRexSidecarRuntime({
      projectRoot: '/host/project',
      locus: 'local',
      image: 'ignored/for:local',
      deps,
    });

    child.onOp = (op, self) => {
      if (op.op === 'run') self.emitLine({ event: 'exit', id: op.id, exit_code: 0 });
      else if (op.op === 'shutdown') {
        self.emitLine({ event: 'closed' });
        self.emit('exit', 0, null);
      }
    };

    const runPromise = runtime(request(), () => {});
    child.emitLine({ event: 'ready', locus: 'local' });
    await runPromise;

    expect(bootstrapArgs?.locus).toBe('local');
    expect(bootstrapArgs?.workdir).toBe('/host/project');
    expect(bootstrapArgs?.image).toBeUndefined();
    expect(bootstrapArgs?.mountHost).toBeUndefined();
    expect(bootstrapArgs?.mountContainer).toBeUndefined();
  });

  it('surfaces the no-Docker RexBootstrapError as a failed result with the actionable message', async () => {
    const child = new FakeChild();
    const { deps } = fakeDeps(child, {
      bootstrap: () => {
        throw new RexBootstrapError(
          'Docker not available for locus=docker. Install Docker … (`docker info` should succeed)'
        );
      },
    });
    const runtime = makeRexSidecarRuntime({ projectRoot: '/proj', locus: 'docker', deps });
    const events: AgentEvent[] = [];

    const result = await runtime(request(), (e) => events.push(e));

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('locus=docker');
    expect(events.find((e) => e.kind === 'error')?.message).toContain('Docker not available');
  });

  it('tears down the child on a timeout and surfaces a timeout error', async () => {
    const child = new FakeChild();
    const { deps, killGroups, removed } = fakeDeps(child);
    const runtime = makeRexSidecarRuntime({
      projectRoot: '/proj',
      timeoutMs: 20,
      killGraceMs: 1,
      deps,
    });
    const events: AgentEvent[] = [];

    // Never reply to ops → the timeout must fire.
    const runPromise = runtime(request(), (e) => events.push(e));
    child.emitLine({ event: 'ready', locus: 'local' });

    const result = await runPromise;
    // The run settles immediately on timeout, but the kill is scheduled for
    // killGraceMs later — give the timer a tick to fire before asserting.
    await new Promise((r) => setTimeout(r, 30));
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/timed out/i);
    // On the timeout path the sidecar did not exit on its own, so teardown
    // escalates: a shutdown op is sent first, then after the grace the agent
    // process GROUP is SIGKILLed via killGroup (negative-pgid kill). The bare
    // child.kill is NOT used (it cannot reach the agent's group).
    expect(child.ops.some((o) => o.op === 'shutdown')).toBe(true);
    expect(killGroups.some((k) => k.signal === 'SIGKILL' && k.pid === child.pid)).toBe(true);
    expect(child.killed).toHaveLength(0);
    // The run dir is still swept on the timeout path (no leftovers).
    expect(removed.length).toBeGreaterThan(0);
  });

  /**
   * The run op must carry `run_dir` so the sidecar writes its pidfile + sentinels
   * there (the new job-control launcher needs it to reap the agent's process
   * group on teardown). For `local` it is the host runDir verbatim.
   */
  it('threads run_dir in the run op (local locus → host runDir)', async () => {
    const child = new FakeChild();
    const { deps } = fakeDeps(child);
    const runtime = makeRexSidecarRuntime({ projectRoot: '/proj', deps });

    child.onOp = (op, self) => {
      if (op.op === 'run') self.emitLine({ event: 'exit', id: op.id, exit_code: 0 });
      else if (op.op === 'shutdown') {
        self.emitLine({ event: 'closed' });
        self.emit('exit', 0, null);
      }
    };

    const runPromise = runtime(request(), () => {});
    child.emitLine({ event: 'ready', locus: 'local' });
    await runPromise;

    const runOp = child.ops.find((o) => o.op === 'run');
    expect(runOp.run_dir).toBeDefined();
    expect(runOp.run_dir).toContain('/proj/.ratchet/batches/b/.run/');
  });

  /**
   * For `docker` the sidecar runs IN the container, so run_dir must be the
   * IN-CONTAINER path (the host path does not exist there) — same swap as the
   * prompt file onto DOCKER_MOUNT_CONTAINER.
   */
  // -------------------------------------------------------------------------
  // Docker-locus hardening (features/docker-locus-hardening): the five
  // `REX_DOCKER_*` knobs thread from RexSidecarRuntimeOptions into the
  // bootstrap call for docker ONLY — local never receives them.
  // -------------------------------------------------------------------------
  it('threads the docker hardening knobs into the bootstrap call (docker only)', async () => {
    const child = new FakeChild();
    let bootstrapArgs: BootstrapOptions | undefined;
    const { deps } = fakeDeps(child, {
      bootstrap: (opts) => {
        bootstrapArgs = opts;
        return LAUNCH;
      },
    });
    const runtime = makeRexSidecarRuntime({
      projectRoot: '/host/project',
      locus: 'docker',
      image: 'my/image:tag',
      dockerUser: '1000:1000',
      dockerMemory: '4g',
      dockerPidsLimit: 256,
      dockerCpus: 1.5,
      network: 'none',
      deps,
    });

    child.onOp = (op, self) => {
      if (op.op === 'run') self.emitLine({ event: 'exit', id: op.id, exit_code: 0 });
      else if (op.op === 'shutdown') {
        self.emitLine({ event: 'closed' });
        self.emit('exit', 0, null);
      }
    };

    const runPromise = runtime(request({ cwd: '/host/project' }), () => {});
    child.emitLine({ event: 'ready', locus: 'docker' });
    await runPromise;

    expect(bootstrapArgs?.dockerUser).toBe('1000:1000');
    expect(bootstrapArgs?.dockerMemory).toBe('4g');
    expect(bootstrapArgs?.dockerPidsLimit).toBe(256);
    expect(bootstrapArgs?.dockerCpus).toBe(1.5);
    expect(bootstrapArgs?.network).toBe('none');
  });

  it('omits the docker hardening knobs from the bootstrap call for local', async () => {
    const child = new FakeChild();
    let bootstrapArgs: BootstrapOptions | undefined;
    const { deps } = fakeDeps(child, {
      bootstrap: (opts) => {
        bootstrapArgs = opts;
        return LAUNCH;
      },
    });
    const runtime = makeRexSidecarRuntime({
      projectRoot: '/proj',
      locus: 'local',
      // Even if set, they must NOT reach the local bootstrap call.
      dockerUser: '1000:1000',
      dockerMemory: '4g',
      dockerPidsLimit: 256,
      dockerCpus: 1.5,
      network: 'none',
      deps,
    });

    child.onOp = (op, self) => {
      if (op.op === 'run') self.emitLine({ event: 'exit', id: op.id, exit_code: 0 });
      else if (op.op === 'shutdown') {
        self.emitLine({ event: 'closed' });
        self.emit('exit', 0, null);
      }
    };

    const runPromise = runtime(request(), () => {});
    child.emitLine({ event: 'ready', locus: 'local' });
    await runPromise;

    expect(bootstrapArgs?.dockerUser).toBeUndefined();
    expect(bootstrapArgs?.dockerMemory).toBeUndefined();
    expect(bootstrapArgs?.dockerPidsLimit).toBeUndefined();
    expect(bootstrapArgs?.dockerCpus).toBeUndefined();
    expect(bootstrapArgs?.network).toBeUndefined();
  });

  it('threads run_dir translated to the in-container mount (docker locus)', async () => {
    const child = new FakeChild();
    const { deps } = fakeDeps(child);
    const runtime = makeRexSidecarRuntime({
      projectRoot: '/host/project',
      locus: 'docker',
      image: 'img',
      deps,
    });

    child.onOp = (op, self) => {
      if (op.op === 'run') self.emitLine({ event: 'exit', id: op.id, exit_code: 0 });
      else if (op.op === 'shutdown') {
        self.emitLine({ event: 'closed' });
        self.emit('exit', 0, null);
      }
    };

    const runPromise = runtime(request({ cwd: '/host/project' }), () => {});
    child.emitLine({ event: 'ready', locus: 'docker' });
    await runPromise;

    const runOp = child.ops.find((o) => o.op === 'run');
    expect(runOp.run_dir).toContain(`${DOCKER_MOUNT_CONTAINER}/.ratchet/batches/`);
    expect(runOp.run_dir).not.toContain('/host/project');
  });

  /**
   * Teardown ordering: on the dirty (timeout/error) path the runtime sends a
   * `shutdown` op FIRST (asking the sidecar to reap its agent group cleanly),
   * and only SIGKILLs the group after the grace — it does NOT send SIGTERM to
   * the sidecar directly. This proves the fix for the orphan: the prior code
   * SIGTERM'd the sidecar immediately, killing it before it could reap the
   * agent it launched.
   */
  it('teardown sends shutdown BEFORE killGroup (not SIGTERM) on the dirty path', async () => {
    const child = new FakeChild();
    const order: string[] = [];
    const { deps, killGroups } = fakeDeps(child, {
      killGroup: (pid, sig) => {
        order.push(`killGroup:${sig}`);
        killGroups.push({ pid, signal: sig });
      },
    });
    const runtime = makeRexSidecarRuntime({
      projectRoot: '/proj',
      timeoutMs: 20,
      killGraceMs: 1,
      deps,
    });

    // Capture the shutdown op ordering relative to the kill.
    child.onOp = (op) => {
      if (op.op === 'shutdown') order.push('shutdown');
    };

    const runPromise = runtime(request(), () => {});
    child.emitLine({ event: 'ready', locus: 'local' });
    await runPromise;
    await new Promise((r) => setTimeout(r, 30));

    expect(order).toEqual(['shutdown', 'killGroup:SIGKILL']);
  });
});

/**
 * Env threading — the per-step env the engine places on AgentSpawnRequest.env
 * reaches the agent the sidecar launches, with overlay merge semantics.
 *
 * Implements `features/rex-env-threading/env-reaches-spawned-agent.feature`.
 * The run-op assertion uses the FakeChild (no spawn); the execution assertions
 * run the built command through a real `sh -c` with a controlled base env so
 * actual visibility — not just string shape — is proven (per the testing
 * standard: an execution test per builder proves the spawned command observes the
 * request value). Temp dirs are isolated via mkdtemp and removed in afterEach.
 */
describe('makeRexSidecarRuntime — env threading (env-reaches-spawned-agent.feature)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'rex-sidecar-env-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  /**
   * Build the sidecar run command for a request and run it through a real
   * `sh -c` with a controlled base env, returning the spawned command's stdout.
   * Keeps PATH so `sh` and the agent binary resolve; controls only the vars
   * under test so overlay semantics are asserted deterministically.
   */
  function runBuiltCommand(request: AgentSpawnRequest, baseEnv: NodeJS.ProcessEnv): string {
    const promptPath = path.join(tmp, 'prompt.txt');
    writeFileSync(promptPath, request.instructions ?? '');
    const cmd = buildRunCommand(promptPath, request);
    return execFileSync('sh', ['-c', cmd], {
      env: { PATH: process.env.PATH ?? '', ...baseEnv },
      encoding: 'utf-8',
    });
  }

  it('the run-op command exports a per-step env var set on the request env', async () => {
    const child = new FakeChild();
    const { deps } = fakeDeps(child);
    const runtime = makeRexSidecarRuntime({ projectRoot: '/proj', deps });

    child.onOp = (op, self) => {
      if (op.op === 'run') self.emitLine({ event: 'exit', id: op.id, exit_code: 0 });
      else if (op.op === 'shutdown') {
        self.emitLine({ event: 'closed' });
        self.emit('exit', 0, null);
      }
    };

    const runPromise = runtime(
      request({ env: { RATCHET_BATCH_NAME: 'b', RATCHET_STEP_VAR: 'from-engine' } }),
      () => {}
    );
    child.emitLine({ event: 'ready', locus: 'local' });
    await runPromise;

    const runOp = child.ops.find((o) => o.op === 'run');
    // The export sits after the cwd prefix, before the `cat … | …` pipeline.
    expect(runOp.command).toContain("export RATCHET_STEP_VAR='from-engine'; ");
    expect(runOp.command).toContain('cat ');
    expect(runOp.command).toContain('| ');
  });

  it('the spawned agent observes the request env value (execution via sh -c)', () => {
    // The agent argv is `printenv RATCHET_STEP_VAR`, which prints the var it sees.
    const out = runBuiltCommand(
      {
        command: 'printenv',
        args: ['RATCHET_STEP_VAR'],
        instructions: '',
        cwd: '/proj',
        env: { RATCHET_STEP_VAR: 'from-engine' },
      },
      // A colliding SESSION base value — the request must win (overlay).
      { RATCHET_STEP_VAR: 'from-session' }
    );
    expect(out.trim()).toBe('from-engine');
  });

  it('a base var absent from the request env stays visible (overlay, not replace)', () => {
    const out = runBuiltCommand(
      {
        command: 'printenv',
        args: ['BASE_ONLY'],
        instructions: '',
        cwd: '/proj',
        env: { RATCHET_STEP_VAR: 'from-engine' },
      },
      // BASE_ONLY is in the session base but NOT in the request env.
      { BASE_ONLY: 'base-val' }
    );
    expect(out.trim()).toBe('base-val');
  });

  /**
   * Implements: features/agent-cmd-override/shared-spawn-helper.feature
   *
   * Scenario: an override-built request threads env like any other request. An
   * override-shaped request (`bash -c <override>` with a per-step env var) has
   * that var exported in the built launch command — the override path composes
   * with #89's env threading.
   */
  it('an override-built (bash -c) request exports a per-step env var into the launch command', () => {
    const promptPath = path.join(tmp, 'prompt.txt');
    writeFileSync(promptPath, 'PROMPT BODY');
    const cmd = buildRunCommand(promptPath, {
      command: 'bash',
      args: ['-c', 'echo stub-agent'],
      instructions: 'PROMPT BODY',
      cwd: '/proj',
      env: { RATCHET_STEP_VAR: 'from-engine' },
    });
    // The per-step env var is exported before the `cat … | bash -c …` pipeline,
    // so an override-built request threads env exactly like an adapter-built one.
    expect(cmd).toContain("export RATCHET_STEP_VAR='from-engine'; ");
    expect(cmd).toContain("'bash' '-c' 'echo stub-agent'");
    expect(cmd).toContain('cat ');
    expect(cmd).toContain('| ');
  });
});
