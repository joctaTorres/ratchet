/**
 * Integration tests for the `batch apply` verb.
 *
 * Implements features/batch-command-tests/apply.feature: single-step selection,
 * halt-respecting precheck, and outcome persistence over an isolated tmpdir
 * fixture repo. The bundled `RatchetBatchEngine` is MOCKED so `runStep` returns a
 * canned `StepResult` and NO real agent is ever spawned — the no-advance
 * scenarios assert the engine is never invoked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { StepResult } from '../../../src/core/batch/engine/index.js';
import { getParkedStep } from '../../../src/core/batch/journal.js';
import { makeBatchFixture, type BatchFixture } from './batch-fixture.js';

const {
  runStepMock,
  runDecompositionStepMock,
  runPrStepMock,
  runProofOfWorkMock,
  computeNextTransitionMock,
  readJournalTolerantMock,
  resolvePlanningHomeMock,
} = vi.hoisted(() => ({
  runStepMock: vi.fn(),
  runDecompositionStepMock: vi.fn(),
  runPrStepMock: vi.fn(),
  runProofOfWorkMock: vi.fn(),
  computeNextTransitionMock: vi.fn(),
  readJournalTolerantMock: vi.fn(),
  resolvePlanningHomeMock: vi.fn(),
}));

// The engine is bundled into this package; mock it so `runStep` /
// `runDecompositionStep` / `runPrStep` are controllable fakes (no real agent is
// spawned) and the no-advance scenarios can prove the engine is never reached. The
// decomposition-key, boundary proof-of-work, and PR-step seams `batch apply`
// imports from the same module are mocked here too so the decompose, proof, and PR
// paths can be exercised without shelling out. `prJournalKey` / `hasJournaledPr`
// keep their real (pure) logic — including the per-group `pr:<batch>:<groupId>`
// key a stacked boundary resolves to — so the PR park keys and the already-opened
// gates are honest; `readJournalTolerant` is a controllable fake so a test can
// pre-seed PR completions for the idempotent-resume cases. The two pure stacked
// policies (`detectPrGroupBoundaries`, `selectStackedBases`) are NOT touched:
// `batch apply` imports them from their own modules, so their real logic runs.
vi.mock('../../../src/core/batch/engine/index.js', () => ({
  RatchetBatchEngine: class {
    runStep = runStepMock;
    runDecompositionStep = runDecompositionStepMock;
    runPrStep = runPrStepMock;
  },
  computeNextTransition: computeNextTransitionMock,
  decompositionJournalKey: (phase: string) => phase,
  prJournalKey: (batch: string, boundary?: { kind: string; groupId: string }) =>
    !boundary || boundary.kind === 'batch' ? `pr:${batch}` : `pr:${batch}:${boundary.groupId}`,
  hasJournaledPr: (journal: { kind: string; transition?: string }[] = []) =>
    journal.some((e) => e.kind === 'completion' && e.transition === 'pr'),
  readJournalTolerant: readJournalTolerantMock,
  runProofOfWork: runProofOfWorkMock,
}));

vi.mock('../../../src/core/planning-home.js', () => ({
  resolveCurrentPlanningHomeSync: resolvePlanningHomeMock,
}));

import { batchApplyCommand } from '../../../src/commands/batch/apply.js';

const PHASE = { name: 'p1', goal: 'ship', success: 'works' };

describe('batchApplyCommand', () => {
  let fixture: BatchFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeBatchFixture();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resolvePlanningHomeMock.mockReturnValue({ root: fixture.root });
    computeNextTransitionMock.mockReturnValue('propose');
    // Default: no PR-open completion journaled, so `alreadyOpened` is false unless a
    // scenario pre-seeds one.
    readJournalTolerantMock.mockReturnValue([]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fixture.cleanup();
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  it('reports nothing to do and never invokes the engine when every change is done', async () => {
    await fixture.writeBatch('b', { phases: [{ ...PHASE, changes: [{ name: 'c1' }] }] });
    await fixture.writeChangeWithTasks('c1', { done: 1, total: 1 });
    // A change is only `done` once its tasks are all checked AND a verify
    // completion is journaled; the batch is only `done` once the terminal
    // phase's boundary proof-of-work is recorded as satisfied.
    fixture.completeVerify('b', 'c1');
    fixture.passProof('b', 'p1');

    await batchApplyCommand('b', {});

    expect(output()).toContain('Nothing to do — all changes are done.');
    expect(runStepMock).not.toHaveBeenCalled();
  });

  it('does not advance a parked blocked step without an answer', async () => {
    await fixture.writeBatch('b', { phases: [{ ...PHASE, changes: [{ name: 'c1' }] }] });
    fixture.park('b', { change: 'c1', kind: 'blocked', reason: 'which adapter?' });

    await batchApplyCommand('b', {});

    const out = output();
    expect(out).toContain("did not advance");
    expect(out).toMatch(/record an answer/);
    expect(runStepMock).not.toHaveBeenCalled();
  });

  it('does not advance a parked awaiting-approval step without a decision', async () => {
    await fixture.writeBatch('b', { phases: [{ ...PHASE, changes: [{ name: 'c1' }] }] });
    fixture.park('b', { change: 'c1', kind: 'awaiting-approval', reason: 'review the proposal' });

    await batchApplyCommand('b', {});

    const out = output();
    expect(out).toContain('did not advance');
    expect(out).toMatch(/approve or reject/);
    expect(runStepMock).not.toHaveBeenCalled();
  });

  it('advances a ready step through exactly one engine transition and clears the park', async () => {
    await fixture.writeBatch('b', { phases: [{ ...PHASE, changes: [{ name: 'c1' }] }] });
    // Parked-but-answered: the precheck lets it through, and an advance must clear it.
    fixture.park('b', { change: 'c1', kind: 'blocked', reason: 'which adapter?', answer: 'use postgres' });
    runStepMock.mockResolvedValue({
      state: 'advanced',
      change: 'c1',
      transition: 'propose',
      message: 'step complete',
    } satisfies StepResult);

    await batchApplyCommand('b', {});

    expect(runStepMock).toHaveBeenCalledTimes(1);
    expect(getParkedStep(fixture.root, 'b', 'c1')).toBeUndefined();
    expect(output()).toMatch(/advanced/);
  });

  it('parks the step as blocked when the engine returns a blocked result', async () => {
    await fixture.writeBatch('b', { phases: [{ ...PHASE, changes: [{ name: 'c1' }] }] });
    runStepMock.mockResolvedValue({
      state: 'blocked',
      change: 'c1',
      transition: 'apply',
      blocker: 'missing credentials',
    } satisfies StepResult);

    await batchApplyCommand('b', {});

    const parked = getParkedStep(fixture.root, 'b', 'c1');
    expect(parked?.kind).toBe('blocked');
    expect(parked?.reason).toBe('missing credentials');
    expect(output()).toMatch(/blocked/);
  });

  it('emits the structured step result with --json', async () => {
    await fixture.writeBatch('b', { phases: [{ ...PHASE, changes: [{ name: 'c1' }] }] });
    const result: StepResult = {
      state: 'advanced',
      change: 'c1',
      transition: 'propose',
      message: 'step complete',
    };
    runStepMock.mockResolvedValue(result);

    await batchApplyCommand('b', { json: true });

    expect(JSON.parse(output())).toEqual(result);
  });

  it('parks the step as awaiting-approval when the engine requests approval', async () => {
    await fixture.writeBatch('b', { phases: [{ ...PHASE, changes: [{ name: 'c1' }] }] });
    runStepMock.mockResolvedValue({
      state: 'awaiting-approval',
      change: 'c1',
      transition: 'propose',
      approvalRequest: 'review the proposal',
    } satisfies StepResult);

    await batchApplyCommand('b', {});

    const parked = getParkedStep(fixture.root, 'b', 'c1');
    expect(parked?.kind).toBe('awaiting-approval');
    expect(parked?.reason).toBe('review the proposal');
    expect(output()).toMatch(/awaiting approval/);
  });

  it('emits a structured parked notice in --json for an un-answered blocked step', async () => {
    await fixture.writeBatch('b', { phases: [{ ...PHASE, changes: [{ name: 'c1' }] }] });
    fixture.park('b', { change: 'c1', kind: 'blocked', reason: 'which adapter?' });

    await batchApplyCommand('b', { json: true });

    const parsed = JSON.parse(output()) as { state: string; change: string; reason: string };
    expect(parsed.state).toBe('parked');
    expect(parsed.change).toBe('c1');
    expect(parsed.reason).toMatch(/which adapter/);
    expect(runStepMock).not.toHaveBeenCalled();
  });

  it('runs the prior phase boundary proof-of-work before entering the next phase', async () => {
    // p1 is done+verified but its boundary proof is not yet recorded, so the next
    // apply runs that proof (not p2's change) and journals the verdict.
    await fixture.writeBatch('b', {
      phases: [
        { name: 'p1', changes: [{ name: 'c1' }] },
        { name: 'p2', changes: [{ name: 'c2' }] },
      ],
    });
    await fixture.writeChangeWithTasks('c1', { done: 1, total: 1 });
    fixture.completeVerify('b', 'c1');
    runProofOfWorkMock.mockResolvedValue({
      kind: 'integration',
      passed: true,
      gatePassed: true,
      policy: 'hard-gate',
      reason: 'pass-condition-met',
      detail: 'suite green',
    });

    await batchApplyCommand('b', {});

    expect(runProofOfWorkMock).toHaveBeenCalledTimes(1);
    expect(runStepMock).not.toHaveBeenCalled();
    const out = output();
    expect(out).toContain('Proof-of-work: p1');
    expect(out).toMatch(/passed/);
  });

  it('reports a failed hard-gate boundary proof-of-work', async () => {
    await fixture.writeBatch('b', {
      phases: [
        { name: 'p1', changes: [{ name: 'c1' }] },
        { name: 'p2', changes: [{ name: 'c2' }] },
      ],
    });
    await fixture.writeChangeWithTasks('c1', { done: 1, total: 1 });
    fixture.completeVerify('b', 'c1');
    runProofOfWorkMock.mockResolvedValue({
      kind: 'integration',
      passed: false,
      gatePassed: false,
      policy: 'hard-gate',
      reason: 'nonzero-exit',
      detail: 'command exited 1',
    });

    await batchApplyCommand('b', { json: true });

    const parsed = JSON.parse(output()) as { state: string; phase: string; passed: boolean };
    expect(parsed.state).toBe('proof-of-work');
    expect(parsed.phase).toBe('p1');
    expect(parsed.passed).toBe(false);
  });

  it('runs a decomposition step for a reachable, undecomposed phase', async () => {
    // p1 is done+verified with its boundary proof recorded; p2 is reachable but
    // has no concrete changes yet, so the next apply is a decomposition step.
    await fixture.writeBatch('b', {
      phases: [
        { name: 'p1', changes: [{ name: 'c1' }] },
        { name: 'p2', changes: [] },
      ],
    });
    await fixture.writeChangeWithTasks('c1', { done: 1, total: 1 });
    fixture.completeVerify('b', 'c1');
    fixture.passProof('b', 'p1');
    runDecompositionStepMock.mockResolvedValue({
      state: 'advanced',
      change: 'p2',
      transition: 'propose',
      message: 'authored p2 change intents',
    } satisfies StepResult);

    await batchApplyCommand('b', {});

    expect(runDecompositionStepMock).toHaveBeenCalledTimes(1);
    expect(runStepMock).not.toHaveBeenCalled();
    // The prior phase's shipped result is threaded into the decomposition context.
    const context = runDecompositionStepMock.mock.calls[0][0];
    expect(context.priorResults).toHaveLength(1);
    expect(context.priorResults[0].phase).toBe('p1');
    expect(output()).toMatch(/advanced/);
  });

  // ---- Completion PR step (whole-batch PR opening) ----

  /** Fake branch resolution injected via the `branches` seam — no git shell-out. */
  const fakeBranches = () => ({ workBranch: 'feat/x', baseBranch: 'main' });

  /** Write a completed single-phase batch with the given prGrouping setting. */
  async function completedBatch(settings?: Record<string, unknown>): Promise<void> {
    await fixture.writeBatch('b', {
      ...(settings ? { settings } : {}),
      phases: [{ ...PHASE, changes: [{ name: 'c1' }] }],
    });
    await fixture.writeChangeWithTasks('c1', { done: 1, total: 1 });
    fixture.completeVerify('b', 'c1');
    fixture.passProof('b', 'p1');
  }

  it('routes a completed whole-batch batch to runPrStep exactly once with the resolved branches', async () => {
    await completedBatch({ prGrouping: 'whole-batch' });
    runPrStepMock.mockResolvedValue({
      state: 'advanced',
      change: 'pr:b',
      transition: 'pr',
      message: 'opened the whole-batch PR',
    } satisfies StepResult);

    await batchApplyCommand('b', {}, { branches: fakeBranches });

    expect(runPrStepMock).toHaveBeenCalledTimes(1);
    expect(runStepMock).not.toHaveBeenCalled();
    const ctx = runPrStepMock.mock.calls[0][0];
    expect(ctx.batch).toBe('b');
    expect(ctx.workBranch).toBe('feat/x');
    expect(ctx.baseBranch).toBe('main');
    expect(ctx.phase.name).toBe('p1');
    expect(ctx.settings.prGrouping).toBe('whole-batch');
    // The whole-batch completion PR carries NO group boundary: it keeps the
    // boundary-less context (and so the batch-level `pr:<batch>` key) unchanged.
    expect(ctx.boundary).toBeUndefined();
    expect(output()).toMatch(/advanced/);
  });

  it('prints the unchanged nothing-to-do message and never calls runPrStep when grouping is off', async () => {
    await completedBatch({ prGrouping: 'off' });

    await batchApplyCommand('b', {}, { branches: fakeBranches });

    expect(output()).toContain('Nothing to do — all changes are done.');
    expect(runPrStepMock).not.toHaveBeenCalled();
  });

  it('prints the unchanged nothing-to-do message and never calls runPrStep when grouping is unset', async () => {
    await completedBatch(); // no settings → prGrouping defaults to off

    await batchApplyCommand('b', {}, { branches: fakeBranches });

    expect(output()).toContain('Nothing to do — all changes are done.');
    expect(runPrStepMock).not.toHaveBeenCalled();
  });

  it('never re-opens the PR: a pre-seeded PR completion prints the done message and skips runPrStep', async () => {
    await completedBatch({ prGrouping: 'whole-batch' });
    // A PR-open completion already recorded → `hasJournaledPr` is true → no target.
    readJournalTolerantMock.mockReturnValue([
      { change: 'pr:b', kind: 'completion', transition: 'pr', message: 'opened' },
    ]);

    await batchApplyCommand('b', {}, { branches: fakeBranches });

    expect(output()).toContain('Nothing to do — all changes are done.');
    expect(runPrStepMock).not.toHaveBeenCalled();
  });

  it('parks a blocked PR step under the PR journal key and renders a reported failure', async () => {
    await completedBatch({ prGrouping: 'whole-batch' });
    runPrStepMock.mockResolvedValue({
      state: 'blocked',
      change: 'pr:b',
      transition: 'pr',
      blocker: 'git push was rejected',
    } satisfies StepResult);

    await batchApplyCommand('b', {}, { branches: fakeBranches });

    expect(runPrStepMock).toHaveBeenCalledTimes(1);
    const parked = getParkedStep(fixture.root, 'b', 'pr:b');
    expect(parked?.kind).toBe('blocked');
    expect(parked?.reason).toBe('git push was rejected');
    expect(output()).toMatch(/blocked/);
  });

  // ---- Stacked per-boundary PR steps (per-phase / per-change) ----

  /** Fake group-branch naming injected via the `groupBranch` seam — no git shell-out. */
  const fakeGroupBranch = (b: { groupId: string }) => `branch/${b.groupId}`;

  /** Write a completed TWO-phase batch (c1 in p1, c2 in p2) with the given settings. */
  async function completedTwoPhaseBatch(settings: Record<string, unknown>): Promise<void> {
    await fixture.writeBatch('b', {
      settings,
      phases: [
        { name: 'p1', changes: [{ name: 'c1' }] },
        { name: 'p2', changes: [{ name: 'c2' }] },
      ],
    });
    for (const change of ['c1', 'c2']) {
      await fixture.writeChangeWithTasks(change, { done: 1, total: 1 });
      fixture.completeVerify('b', change);
    }
    fixture.passProof('b', 'p1');
    fixture.passProof('b', 'p2');
  }

  /** A journaled PR-open completion for a per-group key (pre-seeded resume state). */
  const prCompletion = (key: string) => ({
    change: key,
    kind: 'completion',
    transition: 'pr',
    message: 'opened',
  });

  it('routes a completed per-phase batch to runPrStep once with the first boundary based on the batch base', async () => {
    await completedTwoPhaseBatch({ prGrouping: 'per-phase' });
    runPrStepMock.mockResolvedValue({
      state: 'advanced',
      change: 'pr:b:p1',
      transition: 'pr',
      message: 'opened the p1 group PR',
    } satisfies StepResult);

    await batchApplyCommand('b', {}, { branches: fakeBranches, groupBranch: fakeGroupBranch });

    expect(runPrStepMock).toHaveBeenCalledTimes(1);
    expect(runStepMock).not.toHaveBeenCalled();
    const ctx = runPrStepMock.mock.calls[0][0];
    expect(ctx.boundary).toMatchObject({ index: 0, kind: 'phase', groupId: 'p1' });
    // Group 0 stacks on the BATCH base branch and opens from its own group branch.
    expect(ctx.baseBranch).toBe('main');
    expect(ctx.workBranch).toBe('branch/p1');
    expect(ctx.phase.name).toBe('p1');
    expect(ctx.settings.prGrouping).toBe('per-phase');
    expect(output()).toMatch(/advanced/);
  });

  it('skips a pre-seeded group and selects the next boundary stacked on the previous group branch', async () => {
    await completedTwoPhaseBatch({ prGrouping: 'per-phase' });
    // p1's group PR is already recorded → the next apply selects p2's boundary.
    readJournalTolerantMock.mockReturnValue([prCompletion('pr:b:p1')]);
    runPrStepMock.mockResolvedValue({
      state: 'advanced',
      change: 'pr:b:p2',
      transition: 'pr',
      message: 'opened the p2 group PR',
    } satisfies StepResult);

    await batchApplyCommand('b', {}, { branches: fakeBranches, groupBranch: fakeGroupBranch });

    expect(runPrStepMock).toHaveBeenCalledTimes(1);
    const ctx = runPrStepMock.mock.calls[0][0];
    expect(ctx.boundary).toMatchObject({ index: 1, kind: 'phase', groupId: 'p2' });
    // Group N stacks on group N-1's own branch — never the batch base.
    expect(ctx.baseBranch).toBe('branch/p1');
    expect(ctx.workBranch).toBe('branch/p2');
    expect(ctx.phase.name).toBe('p2');
  });

  it('prints the unchanged done message and never calls runPrStep once every group is recorded', async () => {
    await completedTwoPhaseBatch({ prGrouping: 'per-phase' });
    readJournalTolerantMock.mockReturnValue([
      prCompletion('pr:b:p1'),
      prCompletion('pr:b:p2'),
    ]);

    await batchApplyCommand('b', {}, { branches: fakeBranches, groupBranch: fakeGroupBranch });

    expect(output()).toContain('Nothing to do — all changes are done.');
    expect(runPrStepMock).not.toHaveBeenCalled();
    expect(runStepMock).not.toHaveBeenCalled();
  });

  it('drives one stacked PR per change under per-change, in order, as completions accrue', async () => {
    await completedTwoPhaseBatch({ prGrouping: 'per-change' });
    runPrStepMock.mockImplementation(async (ctx: { boundary: { groupId: string } }) => ({
      state: 'advanced',
      change: `pr:b:${ctx.boundary.groupId}`,
      transition: 'pr',
      message: `opened the ${ctx.boundary.groupId} PR`,
    }));

    // First apply: c1's boundary, based on the batch base.
    await batchApplyCommand('b', {}, { branches: fakeBranches, groupBranch: fakeGroupBranch });
    // Second apply (c1 recorded): c2's boundary, stacked on c1's branch.
    readJournalTolerantMock.mockReturnValue([prCompletion('pr:b:c1')]);
    await batchApplyCommand('b', {}, { branches: fakeBranches, groupBranch: fakeGroupBranch });
    // Third apply (both recorded): nothing left to do.
    readJournalTolerantMock.mockReturnValue([prCompletion('pr:b:c1'), prCompletion('pr:b:c2')]);
    await batchApplyCommand('b', {}, { branches: fakeBranches, groupBranch: fakeGroupBranch });

    expect(runPrStepMock).toHaveBeenCalledTimes(2);
    const [first, second] = runPrStepMock.mock.calls.map((call) => call[0]);
    expect(first.boundary).toMatchObject({ index: 0, kind: 'change', groupId: 'c1' });
    expect(first.baseBranch).toBe('main');
    expect(first.workBranch).toBe('branch/c1');
    expect(second.boundary).toMatchObject({ index: 1, kind: 'change', groupId: 'c2' });
    expect(second.baseBranch).toBe('branch/c1');
    expect(second.workBranch).toBe('branch/c2');
    expect(runStepMock).not.toHaveBeenCalled();
    expect(output()).toContain('Nothing to do — all changes are done.');
  });

  it('parks a blocked stacked PR step under its per-group key and renders a reported failure', async () => {
    await completedTwoPhaseBatch({ prGrouping: 'per-change' });
    runPrStepMock.mockResolvedValue({
      state: 'blocked',
      change: 'pr:b:c1',
      transition: 'pr',
      blocker: 'no forge CLI is authenticated',
    } satisfies StepResult);

    await batchApplyCommand('b', {}, { branches: fakeBranches, groupBranch: fakeGroupBranch });

    expect(runPrStepMock).toHaveBeenCalledTimes(1);
    const parked = getParkedStep(fixture.root, 'b', 'pr:b:c1');
    expect(parked?.kind).toBe('blocked');
    expect(parked?.reason).toBe('no forge CLI is authenticated');
    expect(output()).toMatch(/blocked/);
    // No completion was journaled for the group (the engine records a blocker on
    // failure), so a subsequent apply RE-SURFACES the same first boundary.
    expect(getParkedStep(fixture.root, 'b', 'pr:b:c2')).toBeUndefined();
  });

  it('leaves off/unset behavior unchanged on a completed multi-phase batch', async () => {
    await completedTwoPhaseBatch({ prGrouping: 'off' });

    await batchApplyCommand('b', {}, { branches: fakeBranches, groupBranch: fakeGroupBranch });

    expect(output()).toContain('Nothing to do — all changes are done.');
    expect(runPrStepMock).not.toHaveBeenCalled();
  });
});
