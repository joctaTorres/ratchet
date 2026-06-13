import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { appendJournal } from 'ratchet';
import type { ResolvedStepContext, BatchSettings, ProofOfWork } from 'ratchet';
import { RatchetBatchEngine } from '../../src/core/batch/engine/engine.js';
import type { AgentAdapter, Spawner, AgentSpawnRequest } from '../../src/core/batch/engine/agent.js';

/**
 * The `RATCHET_BATCH_AGENT_CMD` override seam: when set, the engine runs the
 * command via `bash -c` (feeding instructions on stdin) INSTEAD of resolving the
 * configured adapter. Unset → behavior is identical to today. The `Spawner`
 * (unit-test injection seam) stays untouched either way; here we use it to
 * capture the request the engine built.
 */

let projectRoot: string;
const ENV = 'RATCHET_BATCH_AGENT_CMD';
let savedEnv: string | undefined;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-override-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
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
  return { gate: 'voluntary', strategy: 'vertical-slice', proofOfWork: 'hard-gate', agent: 'fake', ...over };
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

/**
 * A fake adapter + capturing spawner. The adapter records when `buildRequest` is
 * called so a test can assert the adapter was (or was NOT) consulted; the spawner
 * captures every spawn request and can simulate a journal report + exit code.
 */
interface FakeAgent {
  adapter: AgentAdapter;
  spawner: Spawner;
  calls: AgentSpawnRequest[];
  /** Mutable counter of how many times `buildRequest` was called. */
  state: { adapterCalls: number };
}

function fakeAgent(behavior: {
  report?: (root: string, batch: string, change: string) => void;
  exitCode?: number;
}): FakeAgent {
  const calls: AgentSpawnRequest[] = [];
  const state = { adapterCalls: 0 };
  const adapter: AgentAdapter = {
    name: 'fake',
    buildRequest(_ctx, instructions, cwd, env): AgentSpawnRequest {
      state.adapterCalls += 1;
      return { command: 'fake-agent', args: [], instructions, cwd, env };
    },
  };
  const spawner: Spawner = async (request) => {
    calls.push(request);
    behavior.report?.(projectRoot, 'b', 'add-login-api');
    return { exitCode: behavior.exitCode ?? 0, signal: null, stdout: '', stderr: '' };
  };
  return { adapter, spawner, calls, state };
}

function engineWith(behavior: Parameters<typeof fakeAgent>[0]) {
  const fake = fakeAgent(behavior);
  const engine = new RatchetBatchEngine({
    spawner: fake.spawner,
    adapters: { fake: fake.adapter },
    projectRoot: () => projectRoot,
  });
  return { engine, fake };
}

describe('RatchetBatchEngine.runStep — RATCHET_BATCH_AGENT_CMD override', () => {
  it('runs the override via `bash -c` with instructions on stdin, skipping the adapter', async () => {
    process.env[ENV] = 'echo stub-agent';
    const { engine, fake } = engineWith({
      report: (root, batch, change) =>
        appendJournal(root, batch, { change, kind: 'completion', message: 'proposed', transition: 'propose' }),
    });

    const result = await engine.runStep(context());

    expect(result.state).toBe('advanced');
    expect(fake.state.adapterCalls).toBe(0); // adapter was NOT resolved/used
    expect(fake.calls.length).toBe(1);
    const req = fake.calls[0];
    expect(req.command).toBe('bash');
    expect(req.args).toEqual(['-c', 'echo stub-agent']);
    expect(req.cwd).toBe(projectRoot);
    expect(req.instructions.length).toBeGreaterThan(0); // step instructions on stdin
  });

  it('treats a blank/whitespace override as unset (configured adapter is used)', async () => {
    process.env[ENV] = '   ';
    const { engine, fake } = engineWith({
      report: (root, batch, change) =>
        appendJournal(root, batch, { change, kind: 'completion', message: 'proposed', transition: 'propose' }),
    });

    const result = await engine.runStep(context());

    expect(result.state).toBe('advanced');
    expect(fake.state.adapterCalls).toBe(1); // adapter resolved as before
    expect(fake.calls[0].command).toBe('fake-agent');
  });

  it('uses the configured adapter when the override is unset', async () => {
    const { engine, fake } = engineWith({
      report: (root, batch, change) =>
        appendJournal(root, batch, { change, kind: 'completion', message: 'proposed', transition: 'propose' }),
    });

    const result = await engine.runStep(context());

    expect(result.state).toBe('advanced');
    expect(fake.state.adapterCalls).toBe(1);
    expect(fake.calls[0].command).toBe('fake-agent');
  });

  it('a non-zero override exit is a failed step that leaves run-state consistent for retry', async () => {
    process.env[ENV] = 'exit 1';
    const { engine, fake } = engineWith({ exitCode: 1 }); // no journal report + non-zero exit

    const result = await engine.runStep(context());

    expect(result.state).toBe('blocked'); // failed surfaces as a resumable blocked step
    expect(result.blocker).toMatch(/exited|completion/i);
    expect(fake.calls[0].command).toBe('bash');

    // The batch run-state stays consistent: a later retry can run again.
    const retry = await engine.runStep(context());
    expect(retry.state).toBe('blocked');
    expect(fake.calls.length).toBe(2);
  });
});
