// Implements features/pr-group-boundaries/boundary-detection.feature
import { describe, it, expect } from 'vitest';
import {
  detectPrGroupBoundaries,
  type BoundaryBatchState,
  type PrGroupBoundary,
} from '../../src/core/batch/engine/boundary.js';

function phase(name: string, changes: string[] = []) {
  return { name, changes };
}

function batch(name: string, phases: { name: string; changes: string[] }[]): BoundaryBatchState {
  return { name, phases };
}

// p1:[a, b] and p2:[c] — the canonical two-phase batch from the feature.
const demo = batch('demo', [phase('p1', ['a', 'b']), phase('p2', ['c'])]);

describe('detectPrGroupBoundaries', () => {
  describe('off', () => {
    it('yields no boundaries', () => {
      expect(detectPrGroupBoundaries(demo, 'off')).toEqual([]);
    });
  });

  describe('whole-batch', () => {
    it('yields a single boundary spanning every change in order', () => {
      expect(detectPrGroupBoundaries(demo, 'whole-batch')).toEqual([
        {
          index: 0,
          kind: 'batch',
          groupId: 'demo',
          changes: ['a', 'b', 'c'],
          triggerChange: 'c',
        },
      ] satisfies PrGroupBoundary[]);
    });
  });

  describe('per-phase', () => {
    it('yields one boundary per phase, each named by its phase', () => {
      expect(detectPrGroupBoundaries(demo, 'per-phase')).toEqual([
        { index: 0, kind: 'phase', groupId: 'p1', changes: ['a', 'b'], triggerChange: 'b' },
        { index: 1, kind: 'phase', groupId: 'p2', changes: ['c'], triggerChange: 'c' },
      ] satisfies PrGroupBoundary[]);
    });

    it('skips a phase that has no changes, keeping indices contiguous', () => {
      const sparse = batch('sparse', [
        phase('p1', ['a']),
        phase('p2', []),
        phase('p3', ['c']),
      ]);
      expect(detectPrGroupBoundaries(sparse, 'per-phase')).toEqual([
        { index: 0, kind: 'phase', groupId: 'p1', changes: ['a'], triggerChange: 'a' },
        { index: 1, kind: 'phase', groupId: 'p3', changes: ['c'], triggerChange: 'c' },
      ] satisfies PrGroupBoundary[]);
    });
  });

  describe('per-change', () => {
    it('yields one boundary per change, each named by its change', () => {
      expect(detectPrGroupBoundaries(demo, 'per-change')).toEqual([
        { index: 0, kind: 'change', groupId: 'a', changes: ['a'], triggerChange: 'a' },
        { index: 1, kind: 'change', groupId: 'b', changes: ['b'], triggerChange: 'b' },
        { index: 2, kind: 'change', groupId: 'c', changes: ['c'], triggerChange: 'c' },
      ] satisfies PrGroupBoundary[]);
    });

    it('produces contiguous 0-based indices and unique identities', () => {
      const boundaries = detectPrGroupBoundaries(demo, 'per-change');
      expect(boundaries.map((b) => b.index)).toEqual([0, 1, 2]);
      const ids = boundaries.map((b) => b.groupId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('empty batch', () => {
    const empty = batch('empty', [phase('p1', []), phase('p2', [])]);

    it.each(['off', 'whole-batch', 'per-phase', 'per-change'] as const)(
      'produces no boundaries under %s',
      (mode) => {
        expect(detectPrGroupBoundaries(empty, mode)).toEqual([]);
      }
    );
  });
});
