/**
 * Engine spawns one PR agent per detected grouping boundary (stacked grouping).
 *
 * Implements:
 *   features/stacked-pr-spawn/boundary-spawn.feature
 *   features/stacked-pr-spawn/per-group-idempotency.feature
 *
 * Drives the engine's PR entry point (`runPrStep`) through the same fake-adapter +
 * `Spawner` seam `pr-spawn-at-completion.test.ts` uses, but with a STACKED group
 * context built by composing the two pure policies (`detectPrGroupBoundaries` +
 * `selectStackedBases`) so the engine consumes their output exactly as production
 * would. It asserts the engine-layer guarantees for `per-phase`/`per-change`
 * independent of any CLI wiring:
 *   - EXACTLY ONE spawn per fired group, delegating to `/rct:pr-open`, with the
 *     group's resolved STACKED base/work branch in the payload (group 0 → batch
 *     base, group N → group N-1's branch);
 *   - the `pr` stage routes the spawn over the fake adapter registry, special-casing
 *     no agent;
 *   - a successful open journals a `completion` keyed `pr:<batch>:<groupId>`, and a
 *     resumed run for that group spawns nothing (`nothing-ready`);
 *   - groups are guarded INDEPENDENTLY: recording group A leaves group B spawnable;
 *   - a non-zero exit → a reported failure with NO per-group completion journaled,
 *     so the group stays retryable;
 *   - `off` spawns nothing;
 *   - a whole-batch step keeps its `pr:<batch>` key unchanged.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { RatchetBatchEngine } from '../../src/core/batch/engine/engine.js';
import { DEFAULT_AGENT } from '../../src/core/batch/engine/agent.js';
import type {
  AgentAdapter,
  Spawner,
  AgentSpawnRequest,
} from '../../src/core/batch/engine/agent.js';
import type { PrStepContext } from '../../src/core/batch/engine/contract.js';
import { prJournalKey } from '../../src/core/batch/engine/instructions.js';
import { hasJournaledPrForGroup } from '../../src/core/batch/engine/transition.js';
import {
  detectPrGroupBoundaries,
  type BoundaryBatchState,
  type PrGroupBoundary,
} from '../../src/core/batch/engine/boundary.js';
import { selectStackedBases } from '../../src/core/batch/engine/stacked-base.js';
import { appendJournalForLocus } from '../../src/core/batch/journal.js';
import { readJournalTolerant } from '../../src/core/batch/engine/run-state.js';
import type { BatchSettings, ProofOfWork, PrGrouping } from '../../src/core/batch/config.js';
import { CommandAdapterRegistry } from '../../src/core/command-generation/index.js';

let projectRoot: string;
const ENV = 'RATCHET_BATCH_AGENT_CMD';
let savedEnv: string | undefined;

const BATCH = 'stk';
const BASE = 'main';
const POW: ProofOfWork = { kind: 'integration', run: 'echo ok', pass: 'exit 0' };

// Two phases (phase-1: c1,c2 — phase-2: c3): three changes across two phases.
const PLAN: BoundaryBatchState = {
  name: BATCH,
  phases: [
    { name: 'phase-1', changes: ['c1', 'c2'] },
    { name: 'phase-2', changes: ['c3'] },
  ],
};

/** Each group's own branch is a plain string derived from its identity. */
const branchForGroup = (b: PrGroupBoundary): string => `feature/${b.groupId}`;

/** Every spawn request the engine built this test, newest last. */
let calls: AgentSpawnRequest[];

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-boundary-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'batches', BATCH), { recursive: true });
  savedEnv = process.env[ENV];
  delete process.env[ENV];
  calls = [];
});

afterEach(async () => {
  if (savedEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = savedEnv;
  await fs.rm(projectRoot, { recursive: true, force: true });
});

/** A fake adapter that stamps its own agent id as the spawn `command`. */
function fakeAdapter(name: string): AgentAdapter {
  return {
    name,
    buildRequest(_ctx, instructions, cwd, env): AgentSpawnRequest {
      return { command: name, args: [], instructions, cwd, env };
    },
  };
}

// Keyed by real agent ids so `resolveAdapter` (builtins ← extra) picks the fake.
const fakeAdapters: Record<string, AgentAdapter> = {
  claude: fakeAdapter('claude'),
  opencode: fakeAdapter('opencode'),
  gemini: fakeAdapter('gemini'),
};

/** Capture the request and exit 0 without reporting anything. */
const capturingSpawner: Spawner = async (request) => {
  calls.push(request);
  return { exitCode: 0, signal: null, stdout: '', stderr: '' };
};

/** Capture the request and exit non-zero without reporting a completion. */
const failingSpawner: Spawner = async (request) => {
  calls.push(request);
  return { exitCode: 1, signal: null, stdout: '', stderr: 'commit failed' };
};

/**
 * Capture the request, then simulate the PR agent reporting a completion for the
 * given per-group KEY at the batch locus — WITHOUT a `transition` field (mirroring
 * what `ratchet batch report --complete` writes), so the test proves the ENGINE
 * records the `transition: 'pr'` mirror entry keyed by group.
 */
function completingSpawner(key: string): Spawner {
  return async (request) => {
    calls.push(request);
    appendJournalForLocus(
      projectRoot,
      { batch: BATCH },
      { change: key, kind: 'completion', message: `opened PR for ${key}` }
    );
    return { exitCode: 0, signal: null, stdout: 'opened PR', stderr: '' };
  };
}

function engine(spawner: Spawner): RatchetBatchEngine {
  return new RatchetBatchEngine({
    spawner,
    adapters: fakeAdapters,
    projectRoot: () => projectRoot,
    // The command-file guarantee is exercised elsewhere; here the command is
    // always "present" so no file is written and routing is the sole variable.
    skillLocusDeps: { exists: () => true, writeText: () => {} },
  });
}

function settings(over: Partial<BatchSettings> = {}): BatchSettings {
  return {
    gate: 'voluntary',
    strategy: 'vertical-slice',
    proofOfWork: 'hard-gate',
    locus: 'local',
    prGrouping: 'per-phase',
    ...over,
  };
}

/**
 * Build the PR step context for the group at `index` under `mode`, composing the
 * two pure policies exactly as production would: detect the ordered boundaries,
 * select each group's stacked base, and hand the engine the fired group's boundary
 * + resolved base/work branch.
 */
function groupCtx(
  mode: PrGrouping,
  index: number,
  over: Partial<BatchSettings> = {}
): PrStepContext {
  const boundaries = detectPrGroupBoundaries(PLAN, mode);
  const stacked = selectStackedBases(boundaries, BASE, branchForGroup);
  const g = stacked[index];
  return {
    batch: BATCH,
    phase: { name: 'phase', goal: 'open the PR', success: 's', proofOfWork: POW },
    settings: settings({ prGrouping: mode, ...over }),
    baseBranch: g.baseBranch,
    workBranch: g.headBranch,
    boundary: g.boundary,
  };
}

describe('engine-spawn-at-boundaries — per-phase boundary spawns one stacked PR', () => {
  it('spawns exactly one PR agent for the second phase group, stacked on the first phase branch', async () => {
    const ctx = groupCtx('per-phase', 1); // phase-2 group
    const key = prJournalKey(BATCH, ctx.boundary);
    const result = await engine(completingSpawner(key)).runPrStep(ctx);

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe(DEFAULT_AGENT);

    const instr = calls[0].instructions;
    // Delegates to the shared /rct:pr-open command, not an inline prompt.
    expect(instr).toContain(
      CommandAdapterRegistry.get(DEFAULT_AGENT)!.getInvocation('pr-open')
    );
    expect(instr).toMatch(/Do NOT hand-build|delegate to the skill/);
    // Base = the FIRST phase group's branch; work = the second phase's own branch.
    expect(instr).toContain('feature/phase-1'); // stacked base
    expect(instr).toContain('feature/phase-2'); // work branch
    // Reports under the per-group key.
    expect(instr).toContain(`--change pr:${BATCH}:phase-2`);
    expect(key).toBe(`pr:${BATCH}:phase-2`);

    // Advanced, with a pr completion recorded keyed to THIS group.
    expect(result.state).toBe('advanced');
    expect(result.transition).toBe('pr');
    const journal = readJournalTolerant(projectRoot, BATCH);
    expect(hasJournaledPrForGroup(journal, key)).toBe(true);
    expect(hasJournaledPrForGroup(journal, `pr:${BATCH}:phase-1`)).toBe(false);
  });

  it('the first phase group bases on the batch base branch', async () => {
    const ctx = groupCtx('per-phase', 0); // phase-1 group
    await engine(capturingSpawner).runPrStep(ctx);
    expect(calls).toHaveLength(1);
    expect(ctx.baseBranch).toBe(BASE);
    expect(calls[0].instructions).toContain(BASE);
    expect(calls[0].instructions).toContain('feature/phase-1'); // its own work branch
  });
});

describe('engine-spawn-at-boundaries — per-change boundary spawns one stacked PR', () => {
  it('spawns one PR agent for the third change, stacked on the second change branch', async () => {
    const ctx = groupCtx('per-change', 2); // c3 group
    const key = prJournalKey(BATCH, ctx.boundary);
    await engine(capturingSpawner).runPrStep(ctx);

    expect(calls).toHaveLength(1);
    expect(key).toBe(`pr:${BATCH}:c3`);
    const instr = calls[0].instructions;
    expect(instr).toContain('feature/c2'); // stacked base = previous change branch
    expect(instr).toContain('feature/c3'); // own work branch
    expect(instr).toContain(`--change pr:${BATCH}:c3`);
  });

  it('the first change group bases on the batch base branch', async () => {
    const ctx = groupCtx('per-change', 0); // c1 group
    expect(ctx.baseBranch).toBe(BASE);
    await engine(capturingSpawner).runPrStep(ctx);
    expect(calls[0].instructions).toContain(BASE);
  });
});

describe('engine-spawn-at-boundaries — the pr stage routes the spawn', () => {
  it('routes to the agent the pr stage maps to, with that agent’s invocation syntax', async () => {
    const ctx = groupCtx('per-change', 0, { agent: { pr: 'opencode' } });
    await engine(capturingSpawner).runPrStep(ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('opencode');
    expect(calls[0].instructions).toContain(
      CommandAdapterRegistry.get('opencode')!.getInvocation('pr-open')
    );
  });

  it('a scalar agent routes the pr stage to it (agent-neutral over the registry)', async () => {
    for (const agent of ['claude', 'opencode', 'gemini']) {
      calls = [];
      const ctx = groupCtx('per-phase', 0, { agent });
      await engine(capturingSpawner).runPrStep(ctx);
      expect(calls).toHaveLength(1);
      expect(calls[0].command).toBe(agent);
      expect(calls[0].instructions).toContain(
        CommandAdapterRegistry.get(agent)!.getInvocation('pr-open')
      );
    }
  });
});

describe('engine-spawn-at-boundaries — per-group idempotency on resume', () => {
  it('a recorded group is not re-opened; nothing-ready with no new spawn', async () => {
    const ctx = groupCtx('per-phase', 0);
    const key = prJournalKey(BATCH, ctx.boundary);
    // First run opens and records the group.
    await engine(completingSpawner(key)).runPrStep(ctx);
    expect(calls).toHaveLength(1);

    // Resume: the same group's PR is recorded → no second spawn.
    calls = [];
    const result = await engine(capturingSpawner).runPrStep(ctx);
    expect(calls).toHaveLength(0);
    expect(result.state).toBe('nothing-ready');
    // Still exactly one completion for this group — nothing appended.
    const journal = readJournalTolerant(projectRoot, BATCH);
    expect(
      journal.filter(
        (e) => e.kind === 'completion' && e.transition === 'pr' && e.change === key
      )
    ).toHaveLength(1);
  });

  it('groups are guarded independently: recording group A leaves group B spawnable', async () => {
    const a = groupCtx('per-change', 0); // c1
    const b = groupCtx('per-change', 1); // c2
    const keyA = prJournalKey(BATCH, a.boundary);

    // Record group A.
    await engine(completingSpawner(keyA)).runPrStep(a);
    calls = [];

    // Group B has no recorded outcome → it still spawns exactly one agent.
    const result = await engine(capturingSpawner).runPrStep(b);
    expect(calls).toHaveLength(1);
    expect(result.state).not.toBe('nothing-ready');
    // Group A's recorded outcome is untouched.
    expect(
      hasJournaledPrForGroup(readJournalTolerant(projectRoot, BATCH), keyA)
    ).toBe(true);
  });
});

describe('engine-spawn-at-boundaries — failures stay retryable, off never spawns', () => {
  it('a non-zero exit → a reported failure with NO per-group completion journaled', async () => {
    const ctx = groupCtx('per-phase', 1);
    const key = prJournalKey(BATCH, ctx.boundary);
    const result = await engine(failingSpawner).runPrStep(ctx);

    expect(calls).toHaveLength(1);
    expect(result.state).toBe('blocked'); // failed → blocked, resumable
    // No per-group pr completion, so a subsequent run re-spawns for this group.
    expect(
      hasJournaledPrForGroup(readJournalTolerant(projectRoot, BATCH), key)
    ).toBe(false);

    calls = [];
    await engine(capturingSpawner).runPrStep(ctx);
    expect(calls).toHaveLength(1); // retried
  });

  it('prGrouping off → zero spawns, nothing-ready, no journal entry', async () => {
    const ctx = groupCtx('per-change', 0, { prGrouping: 'off' });
    const result = await engine(capturingSpawner).runPrStep(ctx);
    expect(calls).toHaveLength(0);
    expect(result.state).toBe('nothing-ready');
    expect(readJournalTolerant(projectRoot, BATCH)).toHaveLength(0);
  });
});

describe('engine-spawn-at-boundaries — whole-batch keeps its batch-level key', () => {
  it('a whole-batch step records under pr:<batch>, unchanged from before', async () => {
    const ctx = groupCtx('whole-batch', 0);
    const key = prJournalKey(BATCH, ctx.boundary);
    expect(key).toBe(`pr:${BATCH}`); // no :groupId suffix
    const result = await engine(completingSpawner(key)).runPrStep(ctx);

    expect(calls).toHaveLength(1);
    expect(result.state).toBe('advanced');
    expect(calls[0].instructions).toContain(`--change pr:${BATCH}`);
    // The whole-batch base is the batch base branch (group 0).
    expect(ctx.baseBranch).toBe(BASE);
    expect(
      hasJournaledPrForGroup(readJournalTolerant(projectRoot, BATCH), key)
    ).toBe(true);
  });
});
