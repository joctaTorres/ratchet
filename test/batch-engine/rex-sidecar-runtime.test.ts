import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
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
} {
  const files = new Map<string, string>();
  const removed: string[] = [];
  const deps: SidecarDeps = {
    spawn: () => child,
    bootstrap: () => LAUNCH,
    mkdirp: () => {},
    writeText: (p, content) => files.set(p, content),
    rmrf: (p) => removed.push(p),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h),
    ...over,
  };
  return { deps, files, removed };
}

describe('makeRexSidecarRuntime', () => {
  it('drives ready→run→stdout→exit→shutdown→closed and accumulates the transcript', async () => {
    const child = new FakeChild();
    const { deps } = fakeDeps(child);
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
    // Child torn down.
    expect(child.killed.length).toBeGreaterThan(0);
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
    const { deps } = fakeDeps(child);
    const runtime = makeRexSidecarRuntime({ projectRoot: '/proj', timeoutMs: 20, deps });
    const events: AgentEvent[] = [];

    // Never reply to ops → the timeout must fire.
    const runPromise = runtime(request(), (e) => events.push(e));
    child.emitLine({ event: 'ready', locus: 'local' });

    const result = await runPromise;
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/timed out/i);
    expect(child.killed.length).toBeGreaterThan(0);
  });
});
