/**
 * `pickNextStep` — the single selection engine — pure unit tests over in-memory
 * `BatchStatusInfo`-shaped input (no filesystem).
 *
 * Implements `features/selection-engine/single-owner.feature`. These port the six
 * invariants the deleted pure selector's unit tests encoded — DAG-ordered
 * pick, unmet-dep hold, parked hold, gated-phase skip, all-done yields no step,
 * all-blocked-or-parked yields no step — onto the surviving selector's real
 * input shape, mapping the dead shape's facts onto derived statuses (`after`
 * unmet → `blocked`, parked → `blocked`, done → `done`) and asserting
 * `pickNextStep` returns the expected `ApplyTarget` or `undefined`.
 */

import { describe, it, expect } from 'vitest';
import { pickNextStep, type ApplyTarget } from '../../src/core/batch/engine/index.js';
import type {
  BatchStatusInfo,
  ChangeStatus,
  ChangeStatusInfo,
  PhaseStatusInfo,
} from '../../src/core/batch/status.js';
import type { Phase } from '../../src/core/batch/manifest.js';

/** A minimal change status for the selection unit tests. */
function change(
  name: string,
  opts: Partial<{ status: ChangeStatus; after: string[]; done: string }> = {}
): ChangeStatusInfo {
  return {
    name,
    status: opts.status ?? 'ready',
    exists: true,
    archived: false,
    progress: { total: 0, completed: 0 },
    after: opts.after ?? [],
    done: opts.done ?? `${name} is done`,
    blockedBy: [],
  };
}

/** A minimal phase status, ungated by default. */
function phase(
  name: string,
  changes: ChangeStatusInfo[],
  opts: Partial<{ gated: boolean; status: PhaseStatusInfo['status'] }> = {}
): PhaseStatusInfo {
  return {
    name,
    goal: 'g',
    success: 's',
    changes,
    gated: opts.gated ?? false,
    status: opts.status ?? 'pending',
  };
}

/** A minimal manifest phase, cast to satisfy `Phase` without schema parsing. */
function manifestPhase(name: string, changeNames: string[]): Phase {
  return {
    name,
    goal: 'g',
    success: 's',
    proofOfWork: { kind: 'integration', run: 'echo ok', pass: 'exit 0' },
    changes: changeNames.map((c) => ({ name: c, after: [], done: `${c} is done` })),
  } as unknown as Phase;
}

/** Build a `BatchStatusInfo` from phase statuses; `next` left unset for selection. */
function batchStatus(phases: PhaseStatusInfo[]): BatchStatusInfo {
  const changeCount = phases.reduce((n, p) => n + p.changes.length, 0);
  return {
    name: 'unit',
    phases,
    progress: { total: 0, completed: 0 },
    changeCount,
    doneCount: 0,
    status: 'in-progress',
  };
}

describe('pickNextStep (single selection engine)', () => {
  it('picks the next runnable change in DAG order within an ungated phase', () => {
    // a done, b ready (deps met), c blocked (b not done) -> b is selected.
    const status = batchStatus([
      phase('p1', [
        change('a', { status: 'done' }),
        change('b', { status: 'ready', after: ['a'] }),
        change('c', { status: 'blocked', after: ['b'] }),
      ]),
    ]);
    const phases = [manifestPhase('p1', ['a', 'b', 'c'])];

    const target = pickNextStep(status, phases);
    expect(target).toEqual({
      kind: 'change',
      phase: phases[0],
      change: 'b',
      changeDone: 'b is done',
    });
  });

  it('does not select a blocked change whose deps are unmet', () => {
    // a ready, b blocked (a not done) -> a is selected, never b.
    const status = batchStatus([
      phase('p1', [
        change('a', { status: 'ready' }),
        change('b', { status: 'blocked', after: ['a'] }),
      ]),
    ]);
    const phases = [manifestPhase('p1', ['a', 'b'])];

    expect(pickNextStep(status, phases)).toMatchObject({ kind: 'change', change: 'a' });
  });

  it('does not select a parked change', () => {
    // a parked (blocked status), b ready -> b is selected.
    const status = batchStatus([
      phase('p1', [
        change('a', { status: 'blocked' }),
        change('b', { status: 'ready' }),
      ]),
    ]);
    const phases = [manifestPhase('p1', ['a', 'b'])];

    expect(pickNextStep(status, phases)).toMatchObject({ kind: 'change', change: 'b' });
  });

  it('skips gated phases entirely (all-gated yields no step)', () => {
    // p1 all done, p2 gated with work -> nothing runnable.
    const status = batchStatus([
      phase('p1', [change('a', { status: 'done' })], { status: 'done' }),
      phase('p2', [change('b', { status: 'ready' })], { gated: true, status: 'blocked' }),
    ]);
    const phases = [manifestPhase('p1', ['a']), manifestPhase('p2', ['b'])];

    expect(pickNextStep(status, phases)).toBeUndefined();
  });

  it('reports no step (not an error) when all changes are done', () => {
    const status = batchStatus([
      phase('p1', [change('a', { status: 'done' })], { status: 'done' }),
    ]);
    const phases = [manifestPhase('p1', ['a'])];

    expect(pickNextStep(status, phases)).toBeUndefined();
  });

  it('reports no step when everything is blocked or parked', () => {
    // a parked (blocked), b blocked (a not done) -> nothing runnable.
    const status = batchStatus([
      phase('p1', [
        change('a', { status: 'blocked' }),
        change('b', { status: 'blocked', after: ['a'] }),
      ]),
    ]);
    const phases = [manifestPhase('p1', ['a', 'b'])];

    expect(pickNextStep(status, phases)).toBeUndefined();
  });
});
