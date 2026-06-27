import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { appendJournal } from 'ratchet-ai';
import type {
  ChangeStepContext,
  BatchSettings,
  ProofOfWork,
} from 'ratchet-ai';
import { RatchetBatchEngine } from '../../../../src/core/batch/engine/engine.js';
import { appendJournalForLocus } from '../../../../src/core/batch/journal.js';
import { resolveChangeStepSettings } from '../../../../src/core/batch/config.js';
import type {
  AgentAdapter,
  Spawner,
  AgentSpawnRequest,
} from '../../../../src/core/batch/engine/agent.js';

/**
 * Tests for the change-scoped engine core, `runChangeStep(ctx)`: it spawns
 * exactly ONE agent for the FORCED transition in the context, never deriving the
 * transition from disk and never taking the batch lock (those stay `runStep`'s
 * job). It mirrors the batch-engine harness but calls `runChangeStep` directly.
 */

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'change-step-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

const POW: ProofOfWork = { kind: 'integration', run: 'echo ok', pass: 'exit 0' };

function settings(over: Partial<BatchSettings> = {}): BatchSettings {
  return {
    gate: 'voluntary',
    strategy: 'vertical-slice',
    proofOfWork: 'hard-gate',
    locus: 'local',
    agent: 'fake',
    ...over,
  };
}

function context(over: Partial<ChangeStepContext> = {}): ChangeStepContext {
  return {
    batch: 'b',
    change: 'add-login-api',
    changeDone: 'the login API exists and is tested',
    transition: 'propose',
    phase: { name: 'p1', goal: 'g', success: 's', proofOfWork: POW },
    settings: settings(),
    journal: [],
    ...over,
  };
}

/**
 * A fake adapter + spawner: the spawner simulates the agent reporting through
 * the journal, then exits with the configured code, recording each invocation so
 * tests can assert "exactly one agent per change step".
 */
function fakeAgent(behavior: {
  report?: (root: string, batch: string, change: string) => void;
  exitCode?: number;
  stderr?: string;
}): { adapter: AgentAdapter; spawner: Spawner; calls: AgentSpawnRequest[] } {
  const calls: AgentSpawnRequest[] = [];
  const adapter: AgentAdapter = {
    name: 'fake',
    buildRequest(_ctx, instructions, cwd, env): AgentSpawnRequest {
      return { command: 'fake-agent', args: [], instructions, cwd, env };
    },
  };
  const spawner: Spawner = async (request) => {
    calls.push(request);
    behavior.report?.(projectRoot, 'b', 'add-login-api');
    return {
      exitCode: behavior.exitCode ?? 0,
      signal: null,
      stdout: '',
      stderr: behavior.stderr ?? '',
    };
  };
  return { adapter, spawner, calls };
}

function engineWith(behavior: Parameters<typeof fakeAgent>[0]) {
  const { adapter, spawner, calls } = fakeAgent(behavior);
  const engine = new RatchetBatchEngine({
    spawner,
    adapters: { fake: adapter },
    projectRoot: () => projectRoot,
  });
  return { engine, calls };
}

describe('RatchetBatchEngine.runChangeStep', () => {
  it('spawns exactly one agent for the forced transition and returns a matching StepResult', async () => {
    const { engine, calls } = engineWith({
      report: (root, batch, change) =>
        appendJournal(root, batch, {
          change,
          kind: 'completion',
          message: 'proposed',
          transition: 'propose',
        }),
    });

    const result = await engine.runChangeStep(context({ transition: 'propose' }));

    // Exactly one agent, instructed for the forced PROPOSE transition.
    expect(calls.length).toBe(1);
    expect(calls[0].instructions).toContain('PROPOSE');
    // A structured StepResult naming the same change and transition.
    expect(result.change).toBe('add-login-api');
    expect(result.transition).toBe('propose');
  });

  it('honours the forced transition without re-deriving it from disk', async () => {
    // On-disk state that would otherwise derive PAST propose: a change dir with a
    // fully-completed plan derives to verify, not propose.
    const changeDir = path.join(projectRoot, '.ratchet', 'changes', 'add-login-api');
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(path.join(changeDir, 'plan.md'), '## Tasks\n- [x] done it\n');

    const { engine, calls } = engineWith({
      report: (root, batch, change) =>
        appendJournal(root, batch, {
          change,
          kind: 'completion',
          message: 'proposed',
          transition: 'propose',
        }),
    });

    // Force propose even though disk would derive a later transition.
    const result = await engine.runChangeStep(context({ transition: 'propose' }));

    expect(calls.length).toBe(1);
    expect(calls[0].instructions).toContain('PROPOSE');
    expect(result.transition).toBe('propose');
  });

  it('maps a clean, completed session to an advanced result pointing at its journal entries', async () => {
    const { engine } = engineWith({
      report: (root, batch, change) =>
        appendJournal(root, batch, {
          change,
          kind: 'completion',
          message: 'proposed',
          transition: 'propose',
        }),
    });

    const result = await engine.runChangeStep(context({ transition: 'propose' }));

    expect(result.state).toBe('advanced');
    expect(result.journalRefs).toBeDefined();
    expect(result.journalRefs!.length).toBeGreaterThan(0);
  });

  it('surfaces a non-zero exit without completion as blocked, staying resumable', async () => {
    const { engine } = engineWith({ exitCode: 1, stderr: 'agent crashed' });

    const result = await engine.runChangeStep(context({ transition: 'propose' }));

    expect(result.state).toBe('blocked');
    expect(result.blocker).toMatch(/exited|completion|crashed/i);
  });
});

/**
 * The standalone (no-batch) path: with `ctx.batch` undefined, `runChangeStep`
 * reads/writes the journal change-locally under `.ratchet/changes/<change>/.run/`
 * and writes NOTHING under `.ratchet/batches/`, while still spawning exactly one
 * agent for the forced transition and honouring a change-local park.
 */
describe('RatchetBatchEngine.runChangeStep — standalone (no batch)', () => {
  const CHANGE_LOCAL_JOURNAL = path.join(
    '.ratchet',
    'changes',
    'add-login-api',
    '.run',
    'journal.jsonl'
  );

  /** Report a completion into the change-local journal (the agent's own .run/). */
  const reportChangeLocal = (
    root: string,
    _batch: string,
    change: string
  ): void => {
    appendJournalForLocus(root, { change }, {
      change,
      kind: 'completion',
      message: 'proposed',
      transition: 'propose',
    });
  };

  it('writes the outcome journal change-locally and nothing under .ratchet/batches/', async () => {
    const { engine, calls } = engineWith({ report: reportChangeLocal });

    const result = await engine.runChangeStep(
      context({ batch: undefined, transition: 'propose' })
    );

    // Exactly one agent, instructed for the forced PROPOSE transition.
    expect(calls.length).toBe(1);
    expect(calls[0].instructions).toContain('PROPOSE');

    // The journal lives under the change-local .run/.
    const raw = await fs.readFile(path.join(projectRoot, CHANGE_LOCAL_JOURNAL), 'utf-8');
    expect(raw).toContain('proposed');

    // Nothing was written under .ratchet/batches/.
    let batchesExists = true;
    try {
      await fs.access(path.join(projectRoot, '.ratchet', 'batches'));
    } catch {
      batchesExists = false;
    }
    expect(batchesExists).toBe(false);

    // A structured StepResult naming the same change and transition.
    expect(result.change).toBe('add-login-api');
    expect(result.transition).toBe('propose');
  });

  it('reconstructs prior change-local entries on resume and isolates this step’s entries', async () => {
    // A prior entry already recorded under the change-local journal.
    appendJournalForLocus(projectRoot, { change: 'add-login-api' }, {
      change: 'add-login-api',
      kind: 'progress',
      message: 'earlier work',
      transition: 'propose',
    });

    const { engine } = engineWith({ report: reportChangeLocal });

    const result = await engine.runChangeStep(
      context({ batch: undefined, transition: 'propose', journal: [] })
    );

    // The session entries isolate ONLY the new entry (index 1), past the prior one.
    expect(result.journalRefs).toEqual([1]);

    // The prior entry is still present in the change-local journal.
    const raw = await fs.readFile(path.join(projectRoot, CHANGE_LOCAL_JOURNAL), 'utf-8');
    expect(raw).toContain('earlier work');
  });

  it('honours a change-local park (blocked, no answer) without spawning', async () => {
    const { engine, calls } = engineWith({ report: reportChangeLocal });

    const result = await engine.runChangeStep(
      context({
        batch: undefined,
        transition: 'propose',
        resume: { kind: 'blocked', reason: 'which database?' },
      })
    );

    expect(result.state).toBe('blocked');
    expect(calls.length).toBe(0);
  });

  it('folds a recorded change-local answer into the instructions on resume', async () => {
    const { engine, calls } = engineWith({ report: reportChangeLocal });

    const result = await engine.runChangeStep(
      context({
        batch: undefined,
        transition: 'propose',
        resume: { kind: 'blocked', reason: 'which database?', answer: 'use Postgres' },
      })
    );

    expect(calls.length).toBe(1);
    expect(calls[0].instructions).toContain('use Postgres');
    expect(result.transition).toBe('propose');
  });
});

/**
 * Standalone settings resolution: `flag → project config → built-in default`,
 * with each override validated before any agent is spawned, and the resolved
 * locus reaching `selectRuntime`.
 */
describe('resolveChangeStepSettings', () => {
  async function writeConfig(yaml: string): Promise<void> {
    await fs.mkdir(path.join(projectRoot, '.ratchet'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, '.ratchet', 'config.yaml'), yaml, 'utf-8');
  }

  it('uses built-in defaults with no flags and no project config', () => {
    const s = resolveChangeStepSettings(projectRoot);
    expect(s.locus).toBe('local');
    expect(s.agent).toBeUndefined();
    expect(s.image).toBeUndefined();
  });

  it('lets project config override the built-in default', async () => {
    await writeConfig('batch:\n  locus: docker\n  image: node:20\n');
    const s = resolveChangeStepSettings(projectRoot);
    expect(s.locus).toBe('docker');
    expect(s.image).toBe('node:20');
  });

  it('lets an explicit flag win over project config and default', async () => {
    await writeConfig('batch:\n  locus: docker\n');
    const s = resolveChangeStepSettings(projectRoot, { locus: 'local', agent: 'codex' });
    expect(s.locus).toBe('local');
    expect(s.agent).toBe('codex');
  });

  it('rejects an invalid flag value with an actionable error before any spawn', () => {
    expect(() => resolveChangeStepSettings(projectRoot, { locus: 'banana' })).toThrow(
      /Allowed values: local, docker, remote/
    );
  });

  it('flows the resolved locus into selectRuntime (remote with missing config blocks, no real spawn)', async () => {
    await writeConfig('batch:\n  locus: remote\n');
    const s = resolveChangeStepSettings(projectRoot);
    expect(s.locus).toBe('remote');

    // No injected runtime: selectRuntime keys off the resolved locus. A remote
    // locus with missing host/port/authToken yields the failing runtime, which
    // maps to blocked BEFORE any REST call — so no real agent is spawned.
    const engine = new RatchetBatchEngine({ projectRoot: () => projectRoot });
    const result = await engine.runChangeStep(
      context({ batch: undefined, transition: 'propose', settings: s })
    );

    expect(result.state).toBe('blocked');
  });
});
