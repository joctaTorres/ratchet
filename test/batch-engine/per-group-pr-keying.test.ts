/**
 * Per-group PR run-state keying — the pure helpers behind stacked grouping.
 *
 * Implements (unit slice):
 *   features/stacked-pr-spawn/boundary-spawn.feature
 *   features/stacked-pr-spawn/per-group-idempotency.feature
 *
 * Unit-level proof (no filesystem, no spawn) that:
 *   - `prJournalKey(batch, boundary?)` returns `pr:<batch>` for a whole-batch step
 *     (absent boundary or `kind: 'batch'`) and `pr:<batch>:<groupId>` for a
 *     per-phase / per-change group, so each stacked group carries its own key;
 *   - `hasJournaledPrForGroup(journal, key)` matches ONLY a `completion` `pr` entry
 *     whose `change` equals the group's key, ignoring other groups, non-`pr`
 *     transitions, blockers, and an empty journal.
 * Boundaries are composed from the real `detectPrGroupBoundaries` policy so the
 * keys are derived exactly as the engine derives them.
 */

import { describe, it, expect } from 'vitest';
import { prJournalKey } from '../../src/core/batch/engine/instructions.js';
import { hasJournaledPrForGroup } from '../../src/core/batch/engine/transition.js';
import {
  detectPrGroupBoundaries,
  type BoundaryBatchState,
} from '../../src/core/batch/engine/boundary.js';
import type { JournalEntry } from '../../src/core/batch/journal.js';

const BATCH = 'b';

// Two phases: phase-1 has two changes, phase-2 has one — three changes overall.
const PLAN: BoundaryBatchState = {
  name: BATCH,
  phases: [
    { name: 'phase-1', changes: ['c1', 'c2'] },
    { name: 'phase-2', changes: ['c3'] },
  ],
};

describe('prJournalKey — whole-batch vs stacked group keys', () => {
  it('returns the batch-level key when no boundary is given (whole-batch, unchanged)', () => {
    expect(prJournalKey(BATCH)).toBe('pr:b');
  });

  it('returns the batch-level key for a whole-batch (kind: batch) boundary', () => {
    const [batchBoundary] = detectPrGroupBoundaries(PLAN, 'whole-batch');
    expect(batchBoundary.kind).toBe('batch');
    expect(prJournalKey(BATCH, batchBoundary)).toBe('pr:b');
  });

  it('keys each per-phase group by its phase name', () => {
    const boundaries = detectPrGroupBoundaries(PLAN, 'per-phase');
    expect(boundaries.map((b) => prJournalKey(BATCH, b))).toEqual([
      'pr:b:phase-1',
      'pr:b:phase-2',
    ]);
  });

  it('keys each per-change group by its change name', () => {
    const boundaries = detectPrGroupBoundaries(PLAN, 'per-change');
    expect(boundaries.map((b) => prJournalKey(BATCH, b))).toEqual([
      'pr:b:c1',
      'pr:b:c2',
      'pr:b:c3',
    ]);
  });
});

describe('hasJournaledPrForGroup — group-scoped done rule', () => {
  const at = '2026-01-01T00:00:00Z';
  const entry = (over: Partial<JournalEntry>): JournalEntry => ({
    at,
    change: 'pr:b:c1',
    kind: 'completion',
    message: 'opened',
    transition: 'pr',
    ...over,
  });

  it('is true for a pr completion whose change equals the group key', () => {
    expect(hasJournaledPrForGroup([entry({})], 'pr:b:c1')).toBe(true);
  });

  it('ignores a pr completion recorded for a DIFFERENT group', () => {
    expect(hasJournaledPrForGroup([entry({ change: 'pr:b:c2' })], 'pr:b:c1')).toBe(false);
  });

  it('ignores a pr BLOCKER for the same group (a failed open stays retryable)', () => {
    expect(hasJournaledPrForGroup([entry({ kind: 'blocker' })], 'pr:b:c1')).toBe(false);
  });

  it('ignores a non-pr completion keyed to the group', () => {
    expect(
      hasJournaledPrForGroup([entry({ transition: 'verify' })], 'pr:b:c1')
    ).toBe(false);
  });

  it('distinguishes the whole-batch key from a stacked group key', () => {
    const journal = [entry({ change: 'pr:b' })];
    expect(hasJournaledPrForGroup(journal, 'pr:b')).toBe(true);
    expect(hasJournaledPrForGroup(journal, 'pr:b:c1')).toBe(false);
  });

  it('defaults to false for an empty journal', () => {
    expect(hasJournaledPrForGroup([], 'pr:b:c1')).toBe(false);
    expect(hasJournaledPrForGroup(undefined, 'pr:b:c1')).toBe(false);
  });
});
