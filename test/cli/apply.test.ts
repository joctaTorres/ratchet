import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { applyCommand } from '../../src/commands/apply.js';
import { appendJournalForLocus } from '../../src/core/batch/journal.js';
import type { EngineDeps } from '../../src/core/batch/engine/index.js';
import type {
  AgentAdapter,
  Spawner,
  AgentSpawnRequest,
} from '../../src/core/batch/engine/agent.js';
import type { ChangeStepContext } from '../../src/core/batch/engine/contract.js';

/**
 * Tests for the headless `ratchet apply <change>` verb. It enforces on-disk
 * preconditions (change must exist; unless `--force`, it must have a plan),
 * resolves settings standalone, appends `-m` guidance, and runs EXACTLY ONE
 * agent for a FORCED apply transition via `runChangeStep` — writing run state
 * change-locally with no batch manifest. An injected agent runtime stands in for
 * a real agent so nothing real is spawned, and a failed precondition spawns
 * nothing at all.
 */

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'apply-cli-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(projectRoot, { recursive: true, force: true });
});

/** Create a change directory, optionally with a plan.md. */
async function makeChange(
  change: string,
  opts: { plan?: string | false } = {}
): Promise<void> {
  const dir = path.join(projectRoot, '.ratchet', 'changes', change);
  await fs.mkdir(dir, { recursive: true });
  if (opts.plan !== false) {
    const plan = opts.plan ?? '## Tasks\n\n- [ ] do the thing\n';
    await fs.writeFile(path.join(dir, 'plan.md'), plan, 'utf-8');
  }
}

/**
 * A fake adapter + spawner: the spawner records each invocation and reports a
 * completion into the CHANGE-LOCAL journal so the step maps to advanced; the
 * adapter captures the `ChangeStepContext` and the built instructions.
 */
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
        message: 'applied',
        transition: 'apply',
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

describe('ratchet apply', () => {
  it('forces the apply transition and spawns exactly one agent', async () => {
    const change = 'doctor-cmd';
    await makeChange(change);
    const { engineDeps, calls, contexts } = deps({ change });

    await applyCommand(change, { agent: 'fake' }, engineDeps);

    expect(calls.length).toBe(1);
    // The forced transition is APPLY, carried on the context and surfaced in the
    // instructions — never re-derived (a plan with an unchecked task would
    // otherwise also derive to apply, but we assert the forced field directly).
    expect(contexts[0].transition).toBe('apply');
    // No batch on the context → run-state locus is change-local.
    expect(contexts[0].batch).toBeUndefined();
    expect(calls[0].instructions).toContain('APPLY');
    expect(calls[0].instructions).toContain(change);
  });

  it('errors with no spawn when the change has no plan', async () => {
    const change = 'doctor-cmd';
    await makeChange(change, { plan: false });
    const { engineDeps, calls } = deps({ change });

    await expect(applyCommand(change, { agent: 'fake' }, engineDeps)).rejects.toThrow(
      /no plan|propose|--force/i
    );
    expect(calls.length).toBe(0);
  });

  it('--force bypasses the missing-plan precondition and spawns one agent', async () => {
    const change = 'doctor-cmd';
    await makeChange(change, { plan: false });
    const { engineDeps, calls, contexts } = deps({ change });

    await applyCommand(change, { agent: 'fake', force: true }, engineDeps);

    expect(calls.length).toBe(1);
    expect(contexts[0].transition).toBe('apply');
  });

  it('errors with no spawn when the change does not exist', async () => {
    const { engineDeps, calls } = deps({ change: 'ghost' });

    await expect(applyCommand('ghost', { agent: 'fake' }, engineDeps)).rejects.toThrow(
      /does not exist/i
    );
    expect(calls.length).toBe(0);
  });

  it('errors with no spawn for a non-existent change even with --force', async () => {
    const { engineDeps, calls } = deps({ change: 'ghost' });

    await expect(
      applyCommand('ghost', { agent: 'fake', force: true }, engineDeps)
    ).rejects.toThrow(/does not exist/i);
    expect(calls.length).toBe(0);
  });

  it('appends -m guidance to the built instructions', async () => {
    const change = 'doctor-cmd';
    await makeChange(change);
    const { engineDeps, calls } = deps({ change });

    await applyCommand(
      change,
      { agent: 'fake', message: ['start with the parser task'] },
      engineDeps
    );

    expect(calls.length).toBe(1);
    // delegated-lifecycle: -m guidance now rides on the /rct:<transition> <change>
    // invocation as an argument, not a detached "Additional guidance:" block.
    expect(calls[0].instructions).not.toContain('Additional guidance:');
    expect(calls[0].instructions).toContain('start with the parser task');
  });

  it('resolves settings flag → project config → default', async () => {
    // Default (no flag, no config) → local.
    {
      await makeChange('a-change');
      const { engineDeps, contexts } = deps({ change: 'a-change' });
      await applyCommand('a-change', { agent: 'fake' }, engineDeps);
      expect(contexts[0].settings.locus).toBe('local');
    }
    // Project config wins over default.
    await writeConfig('batch:\n  locus: docker\n  image: node:20\n');
    {
      await makeChange('b-change');
      const { engineDeps, contexts } = deps({ change: 'b-change' });
      await applyCommand('b-change', { agent: 'fake' }, engineDeps);
      expect(contexts[0].settings.locus).toBe('docker');
      expect(contexts[0].settings.image).toBe('node:20');
    }
    // Explicit flag wins over project config.
    {
      await makeChange('c-change');
      const { engineDeps, contexts } = deps({ change: 'c-change' });
      await applyCommand('c-change', { agent: 'fake', locus: 'local' }, engineDeps);
      expect(contexts[0].settings.locus).toBe('local');
    }
  });

  it('reads from and writes run state change-locally, nothing under .ratchet/batches/', async () => {
    const change = 'doctor-cmd';
    await makeChange(change);
    const { engineDeps } = deps({ change });

    await applyCommand(change, { agent: 'fake' }, engineDeps);

    const journal = await fs.readFile(
      path.join(projectRoot, '.ratchet', 'changes', change, '.run', 'journal.jsonl'),
      'utf-8'
    );
    expect(journal).toContain('applied');

    let batchesExists = true;
    try {
      await fs.access(path.join(projectRoot, '.ratchet', 'batches'));
    } catch {
      batchesExists = false;
    }
    expect(batchesExists).toBe(false);
  });
});
