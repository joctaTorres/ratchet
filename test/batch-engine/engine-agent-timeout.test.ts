import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { appendJournal } from 'ratchet-ai';
import type { ResolvedStepContext, BatchSettings, ProofOfWork } from 'ratchet-ai';
import type { AgentAdapter, AgentSpawnRequest, AgentSpawnResult } from '../../src/core/batch/engine/agent.js';
import type { AgentEvent } from '../../src/core/batch/engine/runtime/contract.js';

/**
 * Proves the engine threads the RESOLVED per-agent timeout into the runtime
 * factory it selects: `selectRuntime` calls `resolveAgentTimeoutMs(settings)` and
 * spreads `timeoutMs` into the sidecar/remote option object only when defined.
 * The two runtime factory modules are mocked so we can capture the exact options
 * object the engine constructs (no Python, no REST).
 */

const { sidecarCalls, remoteCalls } = vi.hoisted(() => ({
  sidecarCalls: [] as Record<string, unknown>[],
  remoteCalls: [] as Record<string, unknown>[],
}));

// A captured-options fake runtime: records its options, then on run reports a
// completion for the change so the step advances, and exits cleanly.
function recordingRuntime(report: () => void) {
  return async (_req: AgentSpawnRequest, onEvent: (e: AgentEvent) => void): Promise<AgentSpawnResult> => {
    report();
    onEvent({ kind: 'exit', exitCode: 0 });
    return { exitCode: 0, signal: null, stdout: '', stderr: '' };
  };
}

vi.mock('../../src/core/batch/engine/runtime/rex-sidecar-runtime.js', () => ({
  makeRexSidecarRuntime: (opts: Record<string, unknown>) => {
    sidecarCalls.push(opts);
    return recordingRuntime(() => reportCompletion());
  },
}));

vi.mock('../../src/core/batch/engine/runtime/rex-remote-runtime.js', () => ({
  makeRexRemoteRuntime: (opts: Record<string, unknown>) => {
    remoteCalls.push(opts);
    return recordingRuntime(() => reportCompletion());
  },
}));

// Imported AFTER the mocks are registered so the engine binds to the mocks.
const { RatchetBatchEngine } = await import('../../src/core/batch/engine/engine.js');

let projectRoot: string;
const ENV = 'RATCHET_AGENT_TIMEOUT_MS';
let savedEnv: string | undefined;

function reportCompletion(): void {
  appendJournal(projectRoot, 'b', {
    change: 'add-login-api',
    kind: 'completion',
    message: 'proposed',
    transition: 'propose',
  });
}

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-timeout-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
  sidecarCalls.length = 0;
  remoteCalls.length = 0;
  savedEnv = process.env[ENV];
  delete process.env[ENV];
});

afterEach(async () => {
  if (savedEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = savedEnv;
  await fs.rm(projectRoot, { recursive: true, force: true });
});

const POW: ProofOfWork = { kind: 'integration', run: 'echo ok', pass: 'exit 0' };

function settings(over: Partial<BatchSettings> = {}): BatchSettings {
  return { gate: 'voluntary', strategy: 'vertical-slice', proofOfWork: 'hard-gate', locus: 'local', agent: 'fake', ...over };
}

function context(over: Partial<ResolvedStepContext> = {}): ResolvedStepContext {
  return {
    batch: 'b',
    change: 'add-login-api',
    transition: 'propose',
    phase: { name: 'p1', goal: 'g', success: 's', proofOfWork: POW },
    settings: settings(),
    journal: [],
    ...over,
  };
}

const adapter: AgentAdapter = {
  name: 'fake',
  buildRequest(_ctx, instructions, cwd, env): AgentSpawnRequest {
    return { command: 'fake-agent', args: [], instructions, cwd, env };
  },
};

function engine() {
  return new RatchetBatchEngine({
    adapters: { fake: adapter },
    projectRoot: () => projectRoot,
    printLine: () => {},
  });
}

describe('engine threads the resolved per-agent timeout into the selected runtime', () => {
  it('omits timeoutMs for the sidecar when nothing is configured', async () => {
    await engine().runStep(context({ settings: settings({ locus: 'local' }) }));
    expect(sidecarCalls).toHaveLength(1);
    expect(sidecarCalls[0]).not.toHaveProperty('timeoutMs');
  });

  it('passes the config timeoutMs to the sidecar runtime', async () => {
    await engine().runStep(context({ settings: settings({ locus: 'local', agentTimeoutMs: 1800000 }) }));
    expect(sidecarCalls[0].timeoutMs).toBe(1800000);
  });

  it('passes the resolved timeoutMs to the remote runtime', async () => {
    await engine().runStep(
      context({
        settings: settings({
          locus: 'remote',
          host: 'localhost',
          port: 8123,
          authToken: 'tok',
          agentTimeoutMs: 1800000,
        }),
      })
    );
    expect(remoteCalls).toHaveLength(1);
    expect(remoteCalls[0].timeoutMs).toBe(1800000);
  });

  it('lets the env var override the config value when threading the sidecar timeout', async () => {
    process.env[ENV] = '2400000';
    await engine().runStep(context({ settings: settings({ locus: 'local', agentTimeoutMs: 1800000 }) }));
    expect(sidecarCalls[0].timeoutMs).toBe(2400000);
  });
});
