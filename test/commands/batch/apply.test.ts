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
  runProofOfWorkMock,
  computeNextTransitionMock,
  resolvePlanningHomeMock,
} = vi.hoisted(() => ({
  runStepMock: vi.fn(),
  runDecompositionStepMock: vi.fn(),
  runProofOfWorkMock: vi.fn(),
  computeNextTransitionMock: vi.fn(),
  resolvePlanningHomeMock: vi.fn(),
}));

// The engine is bundled into this package; mock it so `runStep` /
// `runDecompositionStep` are controllable fakes (no real agent is spawned) and
// the no-advance scenarios can prove the engine is never reached. The
// decomposition-key and boundary proof-of-work seams `batch apply` imports from
// the same module are mocked here too so the decompose and proof paths can be
// exercised without shelling out.
vi.mock('../../../src/core/batch/engine/index.js', () => ({
  RatchetBatchEngine: class {
    runStep = runStepMock;
    runDecompositionStep = runDecompositionStepMock;
  },
  computeNextTransition: computeNextTransitionMock,
  decompositionJournalKey: (phase: string) => phase,
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
});
