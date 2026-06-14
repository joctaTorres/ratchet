/**
 * `RexSidecarRuntime` — the LOCAL `AgentRuntime`: drive an agent through the ReX
 * Python sidecar with RAW live streaming.
 *
 * It resolves the launch descriptor via `bootstrapRexRuntime` (rex-bootstrap.ts;
 * we reuse its lazy/cached/idempotent path — we never re-bootstrap), spawns the
 * sidecar child, and drives the newline-delimited JSON protocol (sidecar.py):
 *
 *   ready  -> send one `run` op carrying the agent shell command
 *   stdout -> forward as AgentEvent{kind:'stdout'} AND accumulate into stdout
 *   exit   -> record exitCode, emit AgentEvent{kind:'exit'}, send `shutdown`
 *   closed -> resolve with the accumulated AgentSpawnResult
 *   error  -> emit AgentEvent{kind:'error'} and fail the run (non-zero exitCode +
 *             message in stderr) so mapSessionToOutcome maps it to blocked/failed
 *
 * Prompt delivery: the sidecar runs a SHELL COMMAND (not stdin), and the agents
 * read their prompt on stdin, so we write `request.instructions` to a temp prompt
 * file under `.ratchet/batches/<batch>/.run/<id>/prompt.txt` and build the run
 * command as `cat <promptfile> | <agent argv>` (tool-agnostic). The agent argv is
 * the PLAIN adapter argv — RAW streaming, no `--output-format stream-json` (that
 * is phase 3). The prompt file is removed in a `finally`.
 *
 * The child spawn, fs writes, and clock are injectable seams (mirroring
 * `BootstrapDeps`) so unit tests drive a fake child emitting canned JSON lines
 * and never start Python.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { AgentSpawnRequest, AgentSpawnResult } from '../agent.js';
import type { AgentEvent, AgentRuntime } from './contract.js';
import {
  bootstrapRexRuntime,
  RexBootstrapError,
  type BootstrapOptions,
  type ResolvedLaunch,
} from './rex-bootstrap.js';

/** The minimal child-process surface the runtime drives (a `ChildProcess` subset). */
export interface SidecarChild {
  stdout: {
    setEncoding(enc: string): void;
    on(event: 'data', listener: (chunk: string) => void): void;
  } | null;
  stderr?: {
    setEncoding(enc: string): void;
    on(event: 'data', listener: (chunk: string) => void): void;
  } | null;
  stdin: {
    write(chunk: string): void;
    end(): void;
  } | null;
  on(event: 'error', listener: (err: Error) => void): void;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  kill(signal?: NodeJS.Signals): void;
}

/** Injectable side-effect seams (spawn / fs / clock) for testability. */
export interface SidecarDeps {
  /** Spawn the sidecar child from a resolved launch descriptor. */
  spawn(launch: ResolvedLaunch): SidecarChild;
  /** Resolve the launch descriptor (defaults to the real bootstrap). */
  bootstrap(options: BootstrapOptions): ResolvedLaunch;
  mkdirp(p: string): void;
  writeText(p: string, content: string): void;
  rmrf(p: string): void;
  /** Schedule a callback after `ms` (defaults to setTimeout); returns a handle. */
  setTimer(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimer(handle: ReturnType<typeof setTimeout>): void;
}

export interface RexSidecarRuntimeOptions {
  /** REX_LOCUS to pass through (default 'local'). */
  locus?: string;
  /** Project root → REX_WORKDIR and the `.ratchet/batches/<batch>/.run` parent. */
  projectRoot: string;
  /** Overall guard against a hung child (ms). Default 10 minutes. */
  timeoutMs?: number;
  /** Grace before escalating SIGTERM → SIGKILL on teardown (ms). Default 2s. */
  killGraceMs?: number;
  /** Injected seams; defaults to the real spawn/fs/clock. */
  deps?: SidecarDeps;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_KILL_GRACE_MS = 2000;

const defaultDeps: SidecarDeps = {
  spawn(launch) {
    return spawn(launch.command, launch.args, {
      env: launch.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as unknown as SidecarChild;
  },
  bootstrap: (options) => bootstrapRexRuntime(options),
  mkdirp: (p) => {
    mkdirSync(p, { recursive: true });
  },
  writeText: (p, content) => writeFileSync(p, content),
  rmrf: (p) => {
    rmSync(p, { recursive: true, force: true });
  },
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle),
};

/** Single-quote a string for safe embedding in a bash `-c` argument. */
function shquote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Build the agent shell command the sidecar will run: `cat <promptfile> | <argv>`.
 * The prompt file feeds the instructions to the agent's stdin uniformly for any
 * agent (claude/codex/gemini/cursor or a `bash -c <override>`), so the PLAIN
 * adapter argv stays raw.
 */
export function buildRunCommand(promptFile: string, request: AgentSpawnRequest): string {
  const argv = [request.command, ...request.args].map(shquote).join(' ');
  return `cat ${shquote(promptFile)} | ${argv}`;
}

/**
 * Make a `RexSidecarRuntime` (an `AgentRuntime`). Each `run` resolves a launch,
 * spawns the sidecar, drives the JSON-lines lifecycle while streaming + cleaning
 * up the temp prompt file, and tears the child down on completion/abort/timeout.
 */
export function makeRexSidecarRuntime(options: RexSidecarRuntimeOptions): AgentRuntime {
  const deps = options.deps ?? defaultDeps;
  const locus = options.locus ?? 'local';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;

  return (req: AgentSpawnRequest, onEvent: (e: AgentEvent) => void): Promise<AgentSpawnResult> => {
    // A short, filesystem-safe id for this run's working directory.
    const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const runDir = path.join(
      options.projectRoot,
      '.ratchet',
      'batches',
      runIdBatch(req),
      '.run',
      runId
    );
    const promptFile = path.join(runDir, 'prompt.txt');

    // Resolve the launch descriptor (lazy/cached bootstrap). A missing Python
    // throws RexBootstrapError → surface as a failed result (non-zero exit +
    // message in stderr) so the engine maps it to blocked/failed.
    let launch: ResolvedLaunch;
    try {
      launch = deps.bootstrap({
        locus,
        workdir: options.projectRoot,
      });
    } catch (err) {
      if (err instanceof RexBootstrapError) {
        onEvent({ kind: 'error', message: err.message });
        return Promise.resolve({
          exitCode: 1,
          signal: null,
          stdout: '',
          stderr: err.message,
        });
      }
      return Promise.reject(err);
    }

    // Write the prompt file BEFORE spawning so the run command can read it.
    deps.mkdirp(runDir);
    deps.writeText(promptFile, req.instructions ?? '');

    return new Promise<AgentSpawnResult>((resolve) => {
      const child = deps.spawn(launch);

      let buf = '';
      let stdout = '';
      let stderr = '';
      let exitCode: number | null = null;
      let settled = false;
      let sentRun = false;
      let killHandle: ReturnType<typeof setTimeout> | undefined;

      const timer = deps.setTimer(() => {
        if (settled) return;
        const msg = `ReX sidecar timed out after ${timeoutMs}ms`;
        onEvent({ kind: 'error', message: msg });
        stderr += (stderr ? '\n' : '') + msg;
        finish({ exitCode: exitCode ?? 1 });
      }, timeoutMs);

      const cleanupPromptFile = () => {
        try {
          deps.rmrf(runDir);
        } catch {
          // Best-effort: a failed temp cleanup must not mask the run result.
        }
      };

      const teardownChild = () => {
        // End stdin and ask the child to stop; escalate to SIGKILL after a grace
        // window so no sidecar is orphaned.
        try {
          child.stdin?.end();
        } catch {
          /* already closed */
        }
        try {
          child.kill('SIGTERM');
        } catch {
          /* already gone */
        }
        killHandle = deps.setTimer(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* already gone */
          }
        }, killGraceMs);
      };

      const finish = (over: { exitCode?: number | null } = {}) => {
        if (settled) return;
        settled = true;
        deps.clearTimer(timer);
        teardownChild();
        cleanupPromptFile();
        resolve({
          exitCode: over.exitCode !== undefined ? over.exitCode : exitCode,
          signal: null,
          stdout,
          stderr,
        });
      };

      const send = (obj: unknown) => {
        try {
          child.stdin?.write(JSON.stringify(obj) + '\n');
        } catch {
          /* child stdin gone; the exit handler will settle the run */
        }
      };

      const handleEvent = (obj: { event?: string; line?: string; exit_code?: number; message?: string }) => {
        switch (obj.event) {
          case 'ready':
            if (sentRun) return;
            sentRun = true;
            send({ op: 'run', id: 1, command: buildRunCommand(promptFile, req) });
            return;
          case 'stdout': {
            const line = obj.line ?? '';
            stdout += (stdout ? '\n' : '') + line;
            onEvent({ kind: 'stdout', line });
            return;
          }
          case 'exit':
            exitCode = typeof obj.exit_code === 'number' ? obj.exit_code : null;
            onEvent({ kind: 'exit', exitCode: exitCode ?? undefined });
            send({ op: 'shutdown' });
            return;
          case 'closed':
            finish();
            return;
          case 'error': {
            const msg = obj.message ?? 'sidecar error';
            onEvent({ kind: 'error', message: msg });
            stderr += (stderr ? '\n' : '') + msg;
            // A failure resolves with a non-zero exit so the engine maps it to
            // blocked/failed; then ask the sidecar to shut down cleanly.
            if (exitCode === null || exitCode === 0) exitCode = 1;
            send({ op: 'shutdown' });
            return;
          }
          default:
            return;
        }
      };

      child.stdout?.setEncoding('utf-8');
      child.stdout?.on('data', (chunk: string) => {
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          let obj: { event?: string; line?: string; exit_code?: number; message?: string };
          try {
            obj = JSON.parse(line);
          } catch {
            continue; // a non-JSON line on the protocol channel is ignored
          }
          handleEvent(obj);
        }
      });

      child.stderr?.setEncoding('utf-8');
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });

      child.on('error', (err: Error) => {
        onEvent({ kind: 'error', message: err.message });
        stderr += (stderr ? '\n' : '') + err.message;
        finish({ exitCode: exitCode ?? 1 });
      });

      child.on('exit', (code) => {
        if (killHandle) deps.clearTimer(killHandle);
        // If the child exits before a clean `closed`, settle with whatever we
        // captured (the recorded exit code, or the process code as a fallback).
        finish({ exitCode: exitCode ?? code ?? 1 });
      });
    });
  };
}

/**
 * The batch name is not on `AgentSpawnRequest`, so derive the `.run` parent from
 * the request env when the engine threads it through; otherwise fall back to a
 * stable folder. (The engine sets `RATCHET_BATCH_NAME` in the spawn env.)
 */
function runIdBatch(req: AgentSpawnRequest): string {
  const fromEnv = req.env?.RATCHET_BATCH_NAME;
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv.trim();
  return '_run';
}
