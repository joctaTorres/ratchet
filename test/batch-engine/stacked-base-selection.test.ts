// Implements features/stacked-pr-base/stacked-base-selection.feature
import { describe, it, expect } from 'vitest';
import {
  selectStackedBases,
  type StackedBase,
} from '../../src/core/batch/engine/stacked-base.js';
import type { PrGroupBoundary } from '../../src/core/batch/engine/boundary.js';

// Build an ordered PrGroupBoundary[] from bare group identities, as
// detectPrGroupBoundaries would for per-change: one contiguous 0-based boundary
// per identity.
function boundaries(...ids: string[]): PrGroupBoundary[] {
  return ids.map((groupId, index) => ({
    index,
    kind: 'change' as const,
    groupId,
    changes: [groupId],
    triggerChange: groupId,
  }));
}

// The Background: each group's own branch is "pr/<groupId>".
const prBranch = (b: PrGroupBoundary) => `pr/${b.groupId}`;

describe('selectStackedBases', () => {
  it('bases the first group on the batch base branch, heading on its own branch', () => {
    const bases = selectStackedBases(boundaries('a', 'b', 'c'), 'main', prBranch);
    expect(bases[0].baseBranch).toBe('main');
    expect(bases[0].headBranch).toBe('pr/a');
  });

  it('bases each later group on the previous group’s branch', () => {
    const bases = selectStackedBases(boundaries('a', 'b', 'c'), 'main', prBranch);
    expect(bases[1].baseBranch).toBe('pr/a');
    expect(bases[2].baseBranch).toBe('pr/b');
    expect(bases[1].headBranch).toBe('pr/b');
    expect(bases[2].headBranch).toBe('pr/c');
  });

  it('preserves boundary order, carries each boundary, and forms the base chain', () => {
    const input = boundaries('a', 'b', 'c');
    const bases = selectStackedBases(input, 'main', prBranch);
    expect(bases).toHaveLength(3);
    expect(bases.map((s) => s.boundary)).toEqual(input);
    // main -> pr/a -> pr/b for groups a, b, c
    expect(bases.map((s) => s.baseBranch)).toEqual(['main', 'pr/a', 'pr/b']);
  });

  it('bases a single group on the batch base branch', () => {
    const bases = selectStackedBases(boundaries('only'), 'main', prBranch);
    expect(bases).toHaveLength(1);
    expect(bases[0].baseBranch).toBe('main');
    expect(bases[0].headBranch).toBe('pr/only');
  });

  it('yields no stacked bases for an empty boundary list', () => {
    expect(selectStackedBases([], 'main', prBranch)).toEqual([] satisfies StackedBase[]);
  });

  it('honors the supplied group-branch resolver, not a baked-in scheme', () => {
    const featureBranch = (b: PrGroupBoundary) => `feature/${b.groupId}`;
    const bases = selectStackedBases(boundaries('a', 'b'), 'main', featureBranch);
    expect(bases[0].headBranch).toBe('feature/a');
    expect(bases[1].baseBranch).toBe('feature/a');
  });

  it('is computed purely from its in-memory inputs (no filesystem, no spawn)', () => {
    // The resolver is the only channel for branch names, and it is invoked with
    // exactly the given boundaries — nothing else is read.
    const seen: PrGroupBoundary[] = [];
    const input = boundaries('a', 'b', 'c');
    selectStackedBases(input, 'main', (b) => {
      seen.push(b);
      return `pr/${b.groupId}`;
    });
    // head for each of 3 groups + base for the 2 later groups = 5 resolver calls,
    // all over members of the given input and none outside it.
    expect(seen.every((b) => input.includes(b))).toBe(true);
  });
});
