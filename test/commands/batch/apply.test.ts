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

const { runStepMock, computeNextTransitionMock, resolvePlanningHomeMock } = vi.hoisted(() => ({
  runStepMock: vi.fn(),
  computeNextTransitionMock: vi.fn(),
  resolvePlanningHomeMock: vi.fn(),
}));

// The engine is bundled into this package; mock it so `runStep` is a controllable
// fake and the no-advance scenarios can prove it is never reached.
vi.mock('../../../src/core/batch/engine/index.js', () => ({
  RatchetBatchEngine: class {
    runStep = runStepMock;
  },
  computeNextTransition: computeNextTransitionMock,
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
});
