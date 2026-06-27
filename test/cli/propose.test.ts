import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { proposeCommand, deriveChangeName } from '../../src/commands/propose.js';
import { appendJournalForLocus } from '../../src/core/batch/journal.js';
import type { EngineDeps } from '../../src/core/batch/engine/index.js';
import type {
  AgentAdapter,
  Spawner,
  AgentSpawnRequest,
} from '../../src/core/batch/engine/agent.js';
import type { ChangeStepContext } from '../../src/core/batch/engine/contract.js';

/**
 * Tests for the headless `ratchet propose "<objective>"` verb. It derives (or
 * honours `--name`) a change name, refuses to clobber an existing change,
 * resolves settings standalone, appends `-m` guidance, and runs EXACTLY ONE
 * agent for a forced propose transition via `runChangeStep` — writing run state
 * change-locally with no batch manifest. An injected agent runtime stands in for
 * a real agent so nothing real is spawned.
 */

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'propose-cli-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(projectRoot, { recursive: true, force: true });
});

/**
 * A fake adapter + spawner: the spawner records each invocation and reports a
 * completion into the CHANGE-LOCAL journal so the step maps to advanced; the
 * adapter captures the `ChangeStepContext` (so tests can assert resolved
 * settings) and the built instructions.
 */
function fakeAgent(behavior: { exitCode?: number; stderr?: string; change: string } ) {
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
    appendJournalForLocus(projectRoot, { change: behavior.change }, {
      change: behavior.change,
      kind: 'completion',
      message: 'proposed',
      transition: 'propose',
    });
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

describe('ratchet propose', () => {
  it('derives the change name from the objective and spawns one propose agent', async () => {
    const change = 'add-a-doctor-command';
    const { engineDeps, calls } = deps({ change });

    await proposeCommand('Add a doctor command', { agent: 'fake' }, engineDeps);

    // The derived name is a kebab-case slug of the objective.
    expect(deriveChangeName('Add a doctor command')).toBe(change);
    // Exactly one agent, instructed for the forced PROPOSE transition.
    expect(calls.length).toBe(1);
    expect(calls[0].instructions).toContain('PROPOSE');
    expect(calls[0].instructions).toContain(change);
  });

  it('lets --name override the derived slug', async () => {
    const { engineDeps, calls, contexts } = deps({ change: 'doctor-cmd' });

    await proposeCommand(
      'Add a doctor command',
      { agent: 'fake', name: 'doctor-cmd' },
      engineDeps
    );

    expect(calls.length).toBe(1);
    expect(contexts[0].change).toBe('doctor-cmd');
    expect(contexts[0].transition).toBe('propose');
  });

  it('refuses when the change already exists, with no spawn', async () => {
    await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes', 'doctor-cmd'), {
      recursive: true,
    });
    const { engineDeps, calls } = deps({ change: 'doctor-cmd' });

    await expect(
      proposeCommand('Add a doctor command', { agent: 'fake', name: 'doctor-cmd' }, engineDeps)
    ).rejects.toThrow(/already exists/i);
    expect(calls.length).toBe(0);
  });

  it('rejects a blank objective with no --name, before any spawn', async () => {
    const { engineDeps, calls } = deps({ change: 'unused' });

    await expect(proposeCommand('   ', { agent: 'fake' }, engineDeps)).rejects.toThrow(
      /objective|--name/i
    );
    expect(calls.length).toBe(0);
  });

  it('appends -m guidance to the built instructions', async () => {
    const change = 'add-a-doctor-command';
    const { engineDeps, calls } = deps({ change });

    await proposeCommand(
      'Add a doctor command',
      { agent: 'fake', message: ['keep it to a single file'] },
      engineDeps
    );

    expect(calls.length).toBe(1);
    expect(calls[0].instructions).toContain('Additional guidance:');
    expect(calls[0].instructions).toContain('keep it to a single file');
  });

  it('resolves settings flag → project config → default and feeds them to the engine', async () => {
    // Default (no flag, no config) → local.
    {
      const { engineDeps, contexts } = deps({ change: 'add-a-doctor-command' });
      await proposeCommand('Add a doctor command', { agent: 'fake' }, engineDeps);
      expect(contexts[0].settings.locus).toBe('local');
    }
    // Project config wins over default.
    await writeConfig('batch:\n  locus: docker\n  image: node:20\n');
    {
      const { engineDeps, contexts } = deps({ change: 'add-another-thing' });
      await proposeCommand('Add another thing', { agent: 'fake' }, engineDeps);
      expect(contexts[0].settings.locus).toBe('docker');
      expect(contexts[0].settings.image).toBe('node:20');
    }
    // Explicit flag wins over project config.
    {
      const { engineDeps, contexts } = deps({ change: 'add-a-third-thing' });
      await proposeCommand(
        'Add a third thing',
        { agent: 'fake', locus: 'local' },
        engineDeps
      );
      expect(contexts[0].settings.locus).toBe('local');
    }
  });

  it('writes the run-state journal change-locally and nothing under .ratchet/batches/', async () => {
    const change = 'add-a-doctor-command';
    const { engineDeps } = deps({ change });

    await proposeCommand('Add a doctor command', { agent: 'fake' }, engineDeps);

    const journal = await fs.readFile(
      path.join(projectRoot, '.ratchet', 'changes', change, '.run', 'journal.jsonl'),
      'utf-8'
    );
    expect(journal).toContain('proposed');

    let batchesExists = true;
    try {
      await fs.access(path.join(projectRoot, '.ratchet', 'batches'));
    } catch {
      batchesExists = false;
    }
    expect(batchesExists).toBe(false);
  });
});
