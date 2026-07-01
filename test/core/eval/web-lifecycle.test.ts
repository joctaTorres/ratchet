/**
 * Unit tests for the web binding lifecycle harness.
 *
 * Implements features/web-lifecycle/readiness.feature (fail-closed readiness
 * polling: URL probe, command probe, and timing out never runs the spec) and
 * features/web-lifecycle/run-and-teardown.feature (Playwright spec execution
 * via plain bash, pass/fail on exit code, teardown-in-finally on every path,
 * and agent-neutral invocation).
 *
 * Every seam (`start`/`bash`/`checkReadiness`/`sleep`/`now`) is injected so no
 * test spawns a real process, hits the network, or waits in real time.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  runWebLifecycle,
  defaultReadinessChecker,
  type ProcessHandle,
  type ProcessStarter,
  type ReadinessChecker,
} from '../../../src/core/eval/web-lifecycle.js';
import type { WebBinding } from '../../../src/core/eval/spec.js';
import type { BashRunner, BashResult } from '../../../src/core/batch/engine/index.js';

const webBinding = (overrides: Partial<WebBinding> = {}): WebBinding => ({
  fixture: 'storefront-app',
  kind: 'web',
  start: 'pnpm dev',
  readiness: { url: 'http://localhost:3000', timeoutMs: 5000 },
  spec: 'e2e/add-to-cart.spec.ts',
  ...overrides,
});

/** A `start` fake that records calls and returns a handle recording `kill()` calls. */
function fakeStarter(): { start: ProcessStarter; calls: Array<{ command: string; cwd: string }>; killed: boolean } {
  const calls: Array<{ command: string; cwd: string }> = [];
  const state = { killed: false };
  const start: ProcessStarter = (command, cwd) => {
    calls.push({ command, cwd });
    const handle: ProcessHandle = {
      pid: 4242,
      kill() {
        state.killed = true;
      },
    };
    return handle;
  };
  return {
    start,
    calls,
    get killed() {
      return state.killed;
    },
  } as { start: ProcessStarter; calls: Array<{ command: string; cwd: string }>; killed: boolean };
}

/** A `bash` fake keyed by exact command, recording every call. */
function fakeBash(responses: Record<string, BashResult | Error>): { bash: BashRunner; calls: Array<{ command: string; cwd: string }> } {
  const calls: Array<{ command: string; cwd: string }> = [];
  const bash: BashRunner = async (command, cwd) => {
    calls.push({ command, cwd });
    const response = responses[command];
    if (response instanceof Error) throw response;
    if (!response) throw new Error(`fakeBash: no response configured for command '${command}'`);
    return response;
  };
  return { bash, calls };
}

/** A manual clock: `now()` starts at 0 and only advances when `sleep` is awaited. */
function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void>; sleeps: number } {
  const state = { current: 0, sleeps: 0 };
  return {
    now: () => state.current,
    sleep: async (ms: number) => {
      state.current += ms;
      state.sleeps++;
    },
    get sleeps() {
      return state.sleeps;
    },
  } as { now: () => number; sleep: (ms: number) => Promise<void>; sleeps: number };
}

const OK_RESULT: BashResult = { exitCode: 0, stdout: '', stderr: '' };

describe('runWebLifecycle readiness', () => {
  it('starts the start command as a background process, polls the URL probe until it succeeds, and proceeds to run the spec', async () => {
    const starter = fakeStarter();
    let checkCalls = 0;
    const checkReadiness: ReadinessChecker = async (readiness) => {
      checkCalls++;
      expect(readiness.url).toBe('http://localhost:3000');
      return checkCalls >= 2; // reachable on the second poll
    };
    const { bash, calls: bashCalls } = fakeBash({
      'npx playwright test e2e/add-to-cart.spec.ts': OK_RESULT,
    });
    const clock = fakeClock();

    const outcome = await runWebLifecycle(webBinding(), '/work', {
      start: starter.start,
      checkReadiness,
      bash,
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(starter.calls).toEqual([{ command: 'pnpm dev', cwd: '/work' }]);
    expect(checkCalls).toBe(2);
    expect(bashCalls).toEqual([{ command: 'npx playwright test e2e/add-to-cart.spec.ts', cwd: '/work' }]);
    expect(outcome).toEqual({ kind: 'completed', passed: true, result: OK_RESULT });
  });

  it('polls the command probe until it exits zero and proceeds to run the spec', async () => {
    const starter = fakeStarter();
    let checkCalls = 0;
    const checkReadiness: ReadinessChecker = async (readiness) => {
      checkCalls++;
      expect(readiness.command).toBe('curl -fs http://localhost:3000/health');
      return checkCalls >= 3;
    };
    const { bash } = fakeBash({
      'npx playwright test e2e/add-to-cart.spec.ts': OK_RESULT,
    });
    const clock = fakeClock();
    const binding = webBinding({
      readiness: { command: 'curl -fs http://localhost:3000/health', timeoutMs: 5000 },
    });

    const outcome = await runWebLifecycle(binding, '/work', {
      start: starter.start,
      checkReadiness,
      bash,
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(checkCalls).toBe(3);
    expect(outcome.kind).toBe('completed');
  });

  it('fails the case once the timeout elapses, never running the spec, and tears the started process down', async () => {
    const starter = fakeStarter();
    const checkReadiness: ReadinessChecker = async () => false; // never succeeds
    const { bash, calls: bashCalls } = fakeBash({});
    const clock = fakeClock();
    const binding = webBinding({ readiness: { url: 'http://localhost:3000', timeoutMs: 1000 } });

    const outcome = await runWebLifecycle(binding, '/work', {
      start: starter.start,
      checkReadiness,
      bash,
      sleep: clock.sleep,
      now: clock.now,
      pollIntervalMs: 250,
    });

    expect(outcome).toEqual({ kind: 'readiness-timeout' });
    expect(bashCalls).toEqual([]); // spec never run
    expect(starter.killed).toBe(true); // started process torn down
  });
});

describe('runWebLifecycle spec execution and teardown', () => {
  it('invokes the spec via a plain bash command and reports passing on exit zero, tearing the process down afterward', async () => {
    const starter = fakeStarter();
    const { bash, calls: bashCalls } = fakeBash({
      'npx playwright test e2e/add-to-cart.spec.ts': OK_RESULT,
    });

    const outcome = await runWebLifecycle(webBinding(), '/work', {
      start: starter.start,
      checkReadiness: async () => true,
      bash,
    });

    expect(bashCalls).toEqual([{ command: 'npx playwright test e2e/add-to-cart.spec.ts', cwd: '/work' }]);
    expect(outcome).toEqual({ kind: 'completed', passed: true, result: OK_RESULT });
    expect(starter.killed).toBe(true);
  });

  it('reports the case as failing when the spec exits non-zero, and still tears the process down', async () => {
    const starter = fakeStarter();
    const failResult: BashResult = { exitCode: 1, stdout: '', stderr: '1 test failed' };
    const { bash } = fakeBash({
      'npx playwright test e2e/add-to-cart.spec.ts': failResult,
    });

    const outcome = await runWebLifecycle(webBinding(), '/work', {
      start: starter.start,
      checkReadiness: async () => true,
      bash,
    });

    expect(outcome).toEqual({ kind: 'completed', passed: false, result: failResult });
    expect(starter.killed).toBe(true);
  });

  it('tears the process down and propagates the error when the spec invocation raises unexpectedly', async () => {
    const starter = fakeStarter();
    const boom = new Error('bash exploded');
    const { bash } = fakeBash({
      'npx playwright test e2e/add-to-cart.spec.ts': boom,
    });

    await expect(
      runWebLifecycle(webBinding(), '/work', {
        start: starter.start,
        checkReadiness: async () => true,
        bash,
      })
    ).rejects.toThrow('bash exploded');

    expect(starter.killed).toBe(true);
  });

  it('tears the process down and propagates the error when readiness checking raises unexpectedly', async () => {
    const starter = fakeStarter();
    const boom = new Error('probe exploded');
    const { bash } = fakeBash({});

    await expect(
      runWebLifecycle(webBinding(), '/work', {
        start: starter.start,
        checkReadiness: async () => {
          throw boom;
        },
        bash,
      })
    ).rejects.toThrow('probe exploded');

    expect(starter.killed).toBe(true);
  });

  it('invokes the Playwright spec through the injected bash function directly — agent-neutral, no spawner involved', async () => {
    const starter = fakeStarter();
    const { bash, calls: bashCalls } = fakeBash({
      'npx playwright test e2e/add-to-cart.spec.ts': OK_RESULT,
    });

    await runWebLifecycle(webBinding(), '/work', {
      start: starter.start,
      checkReadiness: async () => true,
      bash,
    });

    // The spec is invoked as a plain string bash command — no agent request
    // object, adapter, or spawner is part of the call.
    expect(bashCalls).toHaveLength(1);
    expect(typeof bashCalls[0]?.command).toBe('string');
    expect(bashCalls[0]?.command).toBe('npx playwright test e2e/add-to-cart.spec.ts');
  });
});

describe('defaultReadinessChecker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('checks exit code zero for a command probe', async () => {
    const { bash } = fakeBash({ 'curl -fs http://x/health': { exitCode: 0, stdout: '', stderr: '' } });
    const ready = await defaultReadinessChecker({ command: 'curl -fs http://x/health', timeoutMs: 1000 }, '/work', bash);
    expect(ready).toBe(true);
  });

  it('is not ready when a command probe exits non-zero', async () => {
    const { bash } = fakeBash({ 'curl -fs http://x/health': { exitCode: 1, stdout: '', stderr: '' } });
    const ready = await defaultReadinessChecker({ command: 'curl -fs http://x/health', timeoutMs: 1000 }, '/work', bash);
    expect(ready).toBe(false);
  });

  it('checks fetch(url).ok for a URL probe', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const { bash } = fakeBash({});
    const ready = await defaultReadinessChecker({ url: 'http://localhost:3000', timeoutMs: 1000 }, '/work', bash);
    expect(ready).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000');
  });

  it('is not ready when the URL probe response is not ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetchMock);
    const { bash } = fakeBash({});
    const ready = await defaultReadinessChecker({ url: 'http://localhost:3000', timeoutMs: 1000 }, '/work', bash);
    expect(ready).toBe(false);
  });
});
