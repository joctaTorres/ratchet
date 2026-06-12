import { describe, it, expect } from 'vitest';
import {
  selectRunnableStep,
  type SelectablePhase,
} from '../../src/core/batch/engine/selection.js';

function change(name: string, opts: Partial<{ after: string[]; done: boolean; parked: boolean }> = {}) {
  return { name, after: opts.after ?? [], done: opts.done ?? false, parked: opts.parked ?? false };
}

describe('selectRunnableStep', () => {
  it('picks the next ready change permitted by phase and DAG edges', () => {
    const phases: SelectablePhase[] = [
      {
        name: 'p1',
        gated: false,
        changes: [
          change('a', { done: true }),
          change('b', { after: ['a'] }),
          change('c', { after: ['b'] }),
        ],
      },
    ];
    const result = selectRunnableStep(phases);
    expect(result.step).toEqual({ phase: 'p1', change: 'b' });
  });

  it('does not select a blocked change whose deps are unmet', () => {
    const phases: SelectablePhase[] = [
      {
        name: 'p1',
        gated: false,
        changes: [change('a'), change('b', { after: ['a'] })],
      },
    ];
    // a is ready, b is blocked by a -> a is selected, never b.
    expect(selectRunnableStep(phases).step).toEqual({ phase: 'p1', change: 'a' });
  });

  it('does not select a parked change', () => {
    const phases: SelectablePhase[] = [
      {
        name: 'p1',
        gated: false,
        changes: [change('a', { parked: true }), change('b')],
      },
    ];
    expect(selectRunnableStep(phases).step).toEqual({ phase: 'p1', change: 'b' });
  });

  it('skips gated phases entirely', () => {
    const phases: SelectablePhase[] = [
      { name: 'p1', gated: false, changes: [change('a', { done: true })] },
      { name: 'p2', gated: true, changes: [change('b')] },
    ];
    const result = selectRunnableStep(phases);
    // p1 is all done, p2 is gated -> nothing runnable, reported with a reason.
    expect(result.step).toBeUndefined();
    expect(result.reason).toBe('all-gated');
  });

  it('reports nothing runnable (not an error) when all changes are done', () => {
    const phases: SelectablePhase[] = [
      { name: 'p1', gated: false, changes: [change('a', { done: true })] },
    ];
    const result = selectRunnableStep(phases);
    expect(result.step).toBeUndefined();
    expect(result.reason).toBe('all-done');
  });

  it('reports a reason when everything is blocked or parked', () => {
    const phases: SelectablePhase[] = [
      {
        name: 'p1',
        gated: false,
        changes: [change('a', { parked: true }), change('b', { after: ['a'] })],
      },
    ];
    const result = selectRunnableStep(phases);
    expect(result.step).toBeUndefined();
    expect(result.reason).toBe('all-blocked-or-parked');
  });
});
