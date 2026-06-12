/**
 * Engine integration flow: drives RatchetBatchEngine.runStep with injectable
 * fakes (Spawner, LicenseManager/AuthorizationService) through scenarios the
 * narrower unit suites don't cover:
 *
 *  - a SUCCESS where the fake agent does real on-disk work toward the phase goal
 *    (creates the change directory + plan), proving the structured StepResult
 *    (state, transition, journal pointer) and the engine-written journal record.
 *  - the canonical propose -> apply ordering across two steps on the SAME change,
 *    where the disk state the first step produced drives the second transition.
 *  - resume-after-blocker re-spawns with the recorded answer folded into the
 *    spawned prompt (asserted via the fake spawner's captured request).
 *  - a license whose lease has expired forces re-authorization, and a license
 *    that never authorizes refuses BEFORE any spawn.
 *  - the per-batch single-flight lock refuses a concurrent step on the same batch
 *    through the public runStep entry.
 *  - run-state reconstruction tolerates a partial trailing journal line.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, appendFileSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { appendJournal } from 'ratchet';
import type { ResolvedStepContext, BatchSettings, ProofOfWork } from 'ratchet';
import { RatchetBatchEngine } from '../../packages/batch-engine/src/engine.js';
import {
  LicenseManager,
  FakeAuthorizationService,
  type AuthorizationService,
} from '../../packages/batch-engine/src/license.js';
import { acquireBatchLock } from '../../packages/batch-engine/src/lock.js';
import { readJournalTolerant } from '../../packages/batch-engine/src/run-state.js';
import type {
  AgentAdapter,
  Spawner,
  AgentSpawnRequest,
} from '../../packages/batch-engine/src/agent.js';

const SECRET = 'engine-flow-secret';

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-flow-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

const POW: ProofOfWork = { kind: 'integration', run: 'echo ok', pass: 'exit 0' };

function settings(over: Partial<BatchSettings> = {}): BatchSettings {
  return {
    gate: 'autonomous',
    strategy: 'vertical-slice',
    proofOfWork: 'hard-gate',
    agent: 'fake',
    ...over,
  };
}

function context(over: Partial<ResolvedStepContext> = {}): ResolvedStepContext {
  return {
    contractVersion: 1,
    batch: 'b',
    change: 'add-login-api',
    transition: 'propose',
    phase: { name: 'p1', goal: 'a thin auth slice', success: 's', proofOfWork: POW },
    settings: settings(),
    journal: [],
    ...over,
  };
}

function licensed(): LicenseManager {
  return new LicenseManager({
    licenseKey: 'valid',
    service: new FakeAuthorizationService(SECRET),
    verifyingSecret: SECRET,
  });
}

/**
 * A fake agent whose spawner runs an arbitrary effect (e.g. create a change
 * directory toward the phase goal) and records every spawn request so tests can
 * assert what the engine actually fed the agent.
 */
function fakeAgent(behavior: {
  effect?: (root: string, request: AgentSpawnRequest) => void | Promise<void>;
  exitCode?: number;
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
    await behavior.effect?.(projectRoot, request);
    return { exitCode: behavior.exitCode ?? 0, signal: null, stdout: '', stderr: '' };
  };
  return { adapter, spawner, calls };
}

function engineWith(
  behavior: Parameters<typeof fakeAgent>[0],
  license = licensed()
): { engine: RatchetBatchEngine; calls: AgentSpawnRequest[] } {
  const { adapter, spawner, calls } = fakeAgent(behavior);
  const engine = new RatchetBatchEngine({
    spawner,
    adapters: { fake: adapter },
    license,
    projectRoot: () => projectRoot,
  });
  return { engine, calls };
}

/** A propose-completing agent that scaffolds the change dir + a plan with tasks. */
function proposeEffect(change = 'add-login-api') {
  return async (root: string) => {
    const dir = path.join(root, '.ratchet', 'changes', change);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'plan.md'),
      '## Tasks\n- [ ] 1.1 build the slice\n',
      'utf-8'
    );
    appendJournal(root, 'b', {
      change,
      kind: 'completion',
      message: 'proposed the thin slice',
      transition: 'propose',
    });
  };
}

describe('RatchetBatchEngine.runStep — success with real on-disk work', () => {
  it('drives a propose: creates the change directory and returns a journal pointer', async () => {
    const { engine } = engineWith({ effect: proposeEffect() });

    const result = await engine.runStep(context());

    expect(result.state).toBe('advanced');
    expect(result.change).toBe('add-login-api');
    expect(result.transition).toBe('propose');
    // The agent's real work landed on disk toward the phase goal.
    expect(existsSync(path.join(projectRoot, '.ratchet', 'changes', 'add-login-api'))).toBe(
      true
    );
    // The structured result points back into the journal it observed.
    expect(result.journalRefs).toBeDefined();
    expect((result.journalRefs ?? []).length).toBeGreaterThan(0);

    // The engine recorded the outcome on the journal (resume can see this step).
    const journal = readJournalTolerant(projectRoot, 'b');
    const completions = journal.filter((e) => e.kind === 'completion');
    expect(completions.length).toBeGreaterThan(0);
    expect(completions.some((e) => e.transition === 'propose')).toBe(true);
  });

  it('advances the SAME change from propose to apply across two steps (disk drives the order)', async () => {
    // Step 1: propose. The fake leaves a plan.md with an OPEN task.
    const step1 = engineWith({ effect: proposeEffect() });
    const r1 = await step1.engine.runStep(context());
    expect(r1.transition).toBe('propose');
    expect(r1.state).toBe('advanced');

    // Step 2: with a plan + open tasks on disk, the engine derives `apply`
    // (computeNextTransition), regardless of the coarse context hint.
    const step2 = engineWith({
      effect: async (root) =>
        appendJournal(root, 'b', {
          change: 'add-login-api',
          kind: 'completion',
          message: 'implemented the tasks',
          transition: 'apply',
        }),
    });
    const r2 = await step2.engine.runStep(context({ transition: 'propose' }));
    expect(r2.transition).toBe('apply');
    expect(r2.state).toBe('advanced');
    expect(step2.calls).toHaveLength(1);
    // The apply step's instructions must target implementing the planned tasks.
    expect(step2.calls[0].instructions).toContain('APPLY');
    expect(step2.calls[0].instructions).toContain('Implement the planned tasks');
  });
});

describe('RatchetBatchEngine.runStep — resume after a blocker', () => {
  it('re-spawns with the recorded answer folded into the agent prompt', async () => {
    const { engine, calls } = engineWith({ effect: proposeEffect() });

    const result = await engine.runStep(
      context({
        resume: {
          kind: 'blocked',
          reason: 'cookie or header sessions?',
          answer: 'use signed httpOnly cookies',
        },
      })
    );

    expect(result.state).toBe('advanced');
    expect(calls).toHaveLength(1);
    // The answer is in the captured prompt — proof the resume context reached it.
    expect(calls[0].instructions).toContain('use signed httpOnly cookies');
    expect(calls[0].instructions).toContain('cookie or header sessions?');
  });

  it('parks (no spawn) when a blocker has no answer yet', async () => {
    const { engine, calls } = engineWith({ effect: proposeEffect() });
    const result = await engine.runStep(
      context({ resume: { kind: 'blocked', reason: 'which provider?' } })
    );
    expect(result.state).toBe('blocked');
    expect(result.blocker).toContain('which provider?');
    expect(calls).toHaveLength(0);
  });
});

describe('RatchetBatchEngine.runStep — license lease lifecycle', () => {
  it('reuses a valid lease offline, then re-authorizes once the lease expires', async () => {
    let now = 2_000_000;
    let authCalls = 0;
    const service: AuthorizationService = {
      async authorize(req) {
        authCalls += 1;
        return new FakeAuthorizationService(SECRET, 'iss', 10_000, () => now).authorize(req);
      },
    };
    const license = new LicenseManager({
      licenseKey: 'valid',
      service,
      verifyingSecret: SECRET,
      now: () => now,
    });
    // The lease is keyed by (batch, change, transition); keep the transition
    // stable across steps (no disk mutation) so we isolate lease reuse vs expiry.
    const completeWithoutDiskChange = async (root: string) =>
      appendJournal(root, 'b', {
        change: 'add-login-api',
        kind: 'completion',
        message: 'proposed',
        transition: 'propose',
      });
    const { engine } = engineWith({ effect: completeWithoutDiskChange }, license);

    await engine.runStep(context());
    expect(authCalls).toBe(1);

    // Within the lease window, same run (propose): offline, no second round-trip.
    now += 5_000;
    await engine.runStep(context());
    expect(authCalls).toBe(1);

    // Past the lease window: re-authorization is required before this step runs.
    now += 10_000;
    await engine.runStep(context());
    expect(authCalls).toBe(2);
  });

  it('refuses BEFORE any spawn when the license never authorizes (fail closed)', async () => {
    const refusing: AuthorizationService = {
      async authorize() {
        throw new Error('license server unreachable');
      },
    };
    const license = new LicenseManager({
      licenseKey: 'valid',
      service: refusing,
      verifyingSecret: SECRET,
    });
    const { engine, calls } = engineWith({ effect: proposeEffect() }, license);

    const result = await engine.runStep(context());
    expect(result.state).toBe('blocked'); // license refusal surfaced as blocked
    expect(result.blocker?.toLowerCase()).toContain('license');
    expect(calls).toHaveLength(0); // never spawned an agent
  });
});

describe('RatchetBatchEngine.runStep — single-flight lock', () => {
  it('refuses a concurrent step on the same batch while a lock is held', async () => {
    // Hold the batch lock as if another step were in flight.
    await fs.mkdir(path.join(projectRoot, '.ratchet', 'batches', 'b', 'run'), {
      recursive: true,
    });
    const held = acquireBatchLock(projectRoot, 'b');
    try {
      const { engine, calls } = engineWith({ effect: proposeEffect() });
      await expect(engine.runStep(context())).rejects.toThrow(/already running/i);
      expect(calls).toHaveLength(0); // refused before spawning
    } finally {
      held.release();
    }
  });
});

describe('RatchetBatchEngine.runStep — tolerant run-state reconstruction', () => {
  it('ignores a corrupt journal line and still advances, preserving prior entries', async () => {
    // Seed a complete prior entry, then a torn (unparseable) line that DID keep
    // its newline terminator — modeling a crash that left a corrupt interior line
    // the surrounding entries must survive.
    await fs.mkdir(path.join(projectRoot, '.ratchet', 'batches', 'b', 'run'), {
      recursive: true,
    });
    appendJournal(projectRoot, 'b', {
      change: 'add-login-api',
      kind: 'progress',
      message: 'one',
    });
    const journalFile = path.join(
      projectRoot,
      '.ratchet',
      'batches',
      'b',
      'run',
      'journal.jsonl'
    );
    appendFileSync(journalFile, '{"at":"2026-01-01","change":"add-login-api","kind":"prog\n');

    const { engine } = engineWith({ effect: proposeEffect() });
    // Force the engine to reconstruct from disk by passing an empty context journal.
    const result = await engine.runStep(context({ journal: [] }));
    expect(result.state).toBe('advanced');

    // The prior complete entry and the new completion survive; the corrupt line
    // is dropped rather than aborting the reconstruction.
    const entries = readJournalTolerant(projectRoot, 'b');
    expect(entries.some((e) => e.message === 'one')).toBe(true);
    expect(entries.some((e) => e.kind === 'completion')).toBe(true);
    expect(entries.every((e) => typeof e.kind === 'string')).toBe(true);
  });
});
