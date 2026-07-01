/**
 * Web binding lifecycle harness: start the app, wait for readiness, run the
 * Playwright spec, always tear the process down.
 *
 * Mirrors `judgeCheck` in `judge.ts` (bash a command, evaluate the result) but
 * adds the missing background-process lifecycle around it — `judgeCheck`'s
 * `realBashRunner` only resolves on `close`, so it cannot represent "started,
 * still running." `runWebLifecycle` starts the binding's `start` command as a
 * background process, polls `readiness` (fail-closed: timeout is a hard
 * failure, never an assumed pass), runs the Playwright spec at `spec` via a
 * plain bash invocation (agent-neutral — no agent-specific runner), and tears
 * the started process down in a `finally` on every path.
 *
 * Deliberately NOT wired into `judgeCase` yet: reducing `WebLifecycleOutcome`
 * into a `CaseVerdict` and folding it into the `deterministic` contributor is
 * `web-deterministic-fold`'s job. This module is the thin, independently
 * provable start/poll/run/teardown contract that change composes on top of.
 */

import { spawn } from 'node:child_process';
import type { WebBinding, WebReadiness } from './spec.js';
import { realBashRunner, type BashRunner, type BashResult } from '../batch/engine/index.js';

/** A background process the harness started, kept alive across the readiness poll and spec run. */
export interface ProcessHandle {
  readonly pid: number | null;
  kill(): void;
}

export type ProcessStarter = (command: string, cwd: string) => ProcessHandle;

/** Starts `command` detached in its own process group so `kill()` can signal the whole group —
 *  a dev-server launcher commonly forks a nested process, and killing only the wrapper shell
 *  would leak the real server. */
export const realProcessStarter: ProcessStarter = (command, cwd) => {
  const child = spawn('bash', ['-c', command], {
    cwd,
    detached: true,
    stdio: 'ignore',
  });
  return {
    pid: child.pid ?? null,
    kill() {
      if (child.pid != null) {
        process.kill(-child.pid, 'SIGTERM');
      } else {
        child.kill('SIGTERM');
      }
    },
  };
};

export type ReadinessChecker = (readiness: WebReadiness, cwd: string, bash: BashRunner) => Promise<boolean>;

/** Command probe: exit zero. URL probe: `fetch(url).ok`. Exactly one of `command`/`url` is
 *  present per `WebReadinessSchema`'s refinement. */
export const defaultReadinessChecker: ReadinessChecker = async (readiness, cwd, bash) => {
  if (readiness.command) {
    const result = await bash(readiness.command, cwd);
    return result.exitCode === 0;
  }
  const response = await fetch(readiness.url as string);
  return response.ok;
};

const DEFAULT_POLL_INTERVAL_MS = 250;

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface WebLifecycleDeps {
  start?: ProcessStarter;
  bash?: BashRunner;
  checkReadiness?: ReadinessChecker;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export type WebLifecycleOutcome =
  | { kind: 'readiness-timeout' }
  | { kind: 'completed'; passed: boolean; result: BashResult };

/**
 * Run a `web` binding's lifecycle: start the app, poll `readiness` until it
 * succeeds or `readiness.timeoutMs` elapses (fail-closed — timeout never runs
 * the spec), run the Playwright spec via plain bash, and always kill the
 * started process in `finally`.
 */
export async function runWebLifecycle(
  binding: WebBinding,
  cwd: string,
  deps: WebLifecycleDeps = {}
): Promise<WebLifecycleOutcome> {
  const start = deps.start ?? realProcessStarter;
  const bash = deps.bash ?? realBashRunner;
  const checkReadiness = deps.checkReadiness ?? defaultReadinessChecker;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;

  const handle = start(binding.start, cwd);
  try {
    const deadline = now() + binding.readiness.timeoutMs;
    let ready = false;
    // Check-then-sleep: a same-tick-ready app is never penalized one poll interval.
    while (now() < deadline) {
      if (await checkReadiness(binding.readiness, cwd, bash)) {
        ready = true;
        break;
      }
      await sleep(pollIntervalMs);
    }
    if (!ready) {
      return { kind: 'readiness-timeout' };
    }
    const result = await bash(`npx playwright test ${binding.spec}`, cwd);
    return { kind: 'completed', passed: result.exitCode === 0, result };
  } finally {
    handle.kill();
  }
}
