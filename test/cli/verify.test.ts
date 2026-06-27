import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { verifyCommand } from '../../src/commands/verify.js';
import { appendJournalForLocus } from '../../src/core/batch/journal.js';
import type { EngineDeps } from '../../src/core/batch/engine/index.js';
import type {
  AgentAdapter,
  Spawner,
  AgentSpawnRequest,
} from '../../src/core/batch/engine/agent.js';
import type { ChangeStepContext } from '../../src/core/batch/engine/contract.js';

/**
 * Tests for the headless `ratchet verify <change>` verb. It enforces on-disk
 * preconditions (change must exist; unless `--force`, every plan task must be
 * checked), resolves settings standalone, appends `-m` guidance, and runs
 * EXACTLY ONE agent for a FORCED verify transition via `runChangeStep` — writing
 * run state change-locally with no batch manifest. An injected agent runtime
 * stands in for a real agent, and a failed precondition spawns nothing.
 */

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'verify-cli-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(projectRoot, { recursive: true, force: true });
});

const ALL_DONE_PLAN = '## Tasks\n\n- [x] did the thing\n- [x] did the other thing\n';
const UNFINISHED_PLAN = '## Tasks\n\n- [x] did the thing\n- [ ] still pending\n';

/** Create a change directory, optionally with a plan.md. */
async function makeChange(
  change: string,
  opts: { plan?: string | false } = {}
): Promise<void> {
  const dir = path.join(projectRoot, '.ratchet', 'changes', change);
  await fs.mkdir(dir, { recursive: true });
  if (opts.plan !== false) {
    await fs.writeFile(path.join(dir, 'plan.md'), opts.plan ?? ALL_DONE_PLAN, 'utf-8');
  }
}

function fakeAgent(behavior: { exitCode?: number; stderr?: string; change: string }) {
  const calls: AgentSpawnRequest[] = [];
  const contexts: ChangeStepContext[] = [];
  const adapter: AgentAdapter = {
    name: 'fake',
    buildRequest(ctx, instructions, cwd, env): AgentSpawnRequest {
      contexts.push(ctx);
      return { command: 'fake-agent', args: [], instructions, cwd, env };
    },
  };
  const spawner: Spawner = async (request) => {
    calls.push(request);
    appendJournalForLocus(
      projectRoot,
      { change: behavior.change },
      {
        change: behavior.change,
        kind: 'completion',
        message: 'verified',
        transition: 'verify',
      }
    );
    return {
      exitCode: behavior.exitCode ?? 0,
      signal: null,
      stdout: '',
      stderr: behavior.stderr ?? '',
    };
  };
  return { adapter, spawner, calls, contexts };
}

function deps(behavior: { exitCode?: number; stderr?: string; change: string }): {
  engineDeps: EngineDeps;
  calls: AgentSpawnRequest[];
  contexts: ChangeStepContext[];
} {
  const { adapter, spawner, calls, contexts } = fakeAgent(behavior);
  return {
    engineDeps: { spawner, adapters: { fake: adapter }, projectRoot: () => projectRoot },
    calls,
    contexts,
  };
}

async function writeConfig(yaml: string): Promise<void> {
  await fs.writeFile(path.join(projectRoot, '.ratchet', 'config.yaml'), yaml, 'utf-8');
}

describe('ratchet verify', () => {
  it('forces the verify transition and spawns exactly one agent when tasks are all done', async () => {
    const change = 'doctor-cmd';
    await makeChange(change, { plan: ALL_DONE_PLAN });
    const { engineDeps, calls, contexts } = deps({ change });

    await verifyCommand(change, { agent: 'fake' }, engineDeps);

    expect(calls.length).toBe(1);
    expect(contexts[0].transition).toBe('verify');
    // No batch on the context → run-state locus is change-local.
    expect(contexts[0].batch).toBeUndefined();
    expect(calls[0].instructions).toContain('VERIFY');
    expect(calls[0].instructions).toContain(change);
  });

  it('errors with no spawn when tasks are not all done', async () => {
    const change = 'doctor-cmd';
    await makeChange(change, { plan: UNFINISHED_PLAN });
    const { engineDeps, calls } = deps({ change });

    await expect(verifyCommand(change, { agent: 'fake' }, engineDeps)).rejects.toThrow(
      /unfinished|not ready|apply|--force/i
    );
    expect(calls.length).toBe(0);
  });

  it('--force bypasses the unfinished-tasks precondition and spawns one agent', async () => {
    const change = 'doctor-cmd';
    await makeChange(change, { plan: UNFINISHED_PLAN });
    const { engineDeps, calls, contexts } = deps({ change });

    await verifyCommand(change, { agent: 'fake', force: true }, engineDeps);

    expect(calls.length).toBe(1);
    expect(contexts[0].transition).toBe('verify');
  });

  it('errors with no spawn when the change does not exist', async () => {
    const { engineDeps, calls } = deps({ change: 'ghost' });

    await expect(verifyCommand('ghost', { agent: 'fake' }, engineDeps)).rejects.toThrow(
      /does not exist/i
    );
    expect(calls.length).toBe(0);
  });

  it('errors with no spawn for a non-existent change even with --force', async () => {
    const { engineDeps, calls } = deps({ change: 'ghost' });

    await expect(
      verifyCommand('ghost', { agent: 'fake', force: true }, engineDeps)
    ).rejects.toThrow(/does not exist/i);
    expect(calls.length).toBe(0);
  });

  it('appends -m guidance to the built instructions', async () => {
    const change = 'doctor-cmd';
    await makeChange(change, { plan: ALL_DONE_PLAN });
    const { engineDeps, calls } = deps({ change });

    await verifyCommand(
      change,
      { agent: 'fake', message: ['double-check the error paths'] },
      engineDeps
    );

    expect(calls.length).toBe(1);
    expect(calls[0].instructions).toContain('Additional guidance:');
    expect(calls[0].instructions).toContain('double-check the error paths');
  });

  it('resolves settings flag → project config → default', async () => {
    {
      await makeChange('a-change', { plan: ALL_DONE_PLAN });
      const { engineDeps, contexts } = deps({ change: 'a-change' });
      await verifyCommand('a-change', { agent: 'fake' }, engineDeps);
      expect(contexts[0].settings.locus).toBe('local');
    }
    await writeConfig('batch:\n  locus: docker\n  image: node:20\n');
    {
      await makeChange('b-change', { plan: ALL_DONE_PLAN });
      const { engineDeps, contexts } = deps({ change: 'b-change' });
      await verifyCommand('b-change', { agent: 'fake' }, engineDeps);
      expect(contexts[0].settings.locus).toBe('docker');
      expect(contexts[0].settings.image).toBe('node:20');
    }
    {
      await makeChange('c-change', { plan: ALL_DONE_PLAN });
      const { engineDeps, contexts } = deps({ change: 'c-change' });
      await verifyCommand('c-change', { agent: 'fake', locus: 'local' }, engineDeps);
      expect(contexts[0].settings.locus).toBe('local');
    }
  });

  it('reads from and writes run state change-locally, nothing under .ratchet/batches/', async () => {
    const change = 'doctor-cmd';
    await makeChange(change, { plan: ALL_DONE_PLAN });
    const { engineDeps } = deps({ change });

    await verifyCommand(change, { agent: 'fake' }, engineDeps);

    const journal = await fs.readFile(
      path.join(projectRoot, '.ratchet', 'changes', change, '.run', 'journal.jsonl'),
      'utf-8'
    );
    expect(journal).toContain('verified');

    let batchesExists = true;
    try {
      await fs.access(path.join(projectRoot, '.ratchet', 'batches'));
    } catch {
      batchesExists = false;
    }
    expect(batchesExists).toBe(false);
  });
});
