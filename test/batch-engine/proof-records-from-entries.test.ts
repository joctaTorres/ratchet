/**
 * `proofRecordsFromEntries` — the pure latest-per-phase proof reader.
 *
 * `computeBatchStatus` already receives the run journal it derives status from;
 * the phase gate must derive the recorded proof outcome from THOSE SAME entries,
 * not a second disk read. This pins the pure reader: it folds a `JournalEntry[]`
 * to the latest `ProofOfWorkRecord` per phase (latest append wins), ignores
 * non-proof entries, and omits a phase with no recorded proof.
 */

import { describe, it, expect } from 'vitest';
import {
  proofRecordsFromEntries,
  proofOfWorkJournalKey,
  type JournalEntry,
  type ProofOfWorkRecord,
} from '../../src/core/batch/journal.js';

function record(over: Partial<ProofOfWorkRecord> = {}): ProofOfWorkRecord {
  return {
    phase: 'p1',
    passed: true,
    gatePassed: true,
    policy: 'hard-gate',
    reason: 'pass-condition-met',
    detail: 'Proof-of-work passed (exit 0).',
    ...over,
  };
}

function proofEntry(over: Partial<ProofOfWorkRecord> = {}): JournalEntry {
  const proof = record(over);
  return {
    at: '2026-06-28T00:00:00.000Z',
    change: proofOfWorkJournalKey(proof.phase),
    kind: 'proof-of-work',
    message: proof.detail,
    proof,
  };
}

function otherEntry(change: string): JournalEntry {
  return {
    at: '2026-06-28T00:00:00.000Z',
    change,
    kind: 'completion',
    message: 'verified',
    transition: 'verify',
  };
}

function invalidationEntry(phase: string): JournalEntry {
  return {
    at: '2026-06-28T00:00:00.000Z',
    change: proofOfWorkJournalKey(phase),
    kind: 'proof-of-work-invalidated',
    message: `Invalidated recorded proof-of-work for phase '${phase}'.`,
  };
}

describe('proofRecordsFromEntries', () => {
  it('returns the latest recorded proof per phase from a journal', () => {
    const byPhase = proofRecordsFromEntries([
      proofEntry({ phase: 'p1', passed: true, gatePassed: true }),
      proofEntry({ phase: 'p2', passed: false, gatePassed: false }),
    ]);
    expect(byPhase.get('p1')!.passed).toBe(true);
    expect(byPhase.get('p2')!.gatePassed).toBe(false);
  });

  it('lets a later recording win for the same phase (latest append wins)', () => {
    const byPhase = proofRecordsFromEntries([
      proofEntry({ phase: 'p1', passed: false, gatePassed: false, reason: 'nonzero-exit' }),
      proofEntry({ phase: 'p1', passed: true, gatePassed: true }),
    ]);
    expect(byPhase.get('p1')!.passed).toBe(true);
    expect(byPhase.get('p1')!.gatePassed).toBe(true);
  });

  it('ignores non-proof entries', () => {
    const byPhase = proofRecordsFromEntries([
      otherEntry('some-change'),
      proofEntry({ phase: 'p1' }),
      otherEntry('another-change'),
    ]);
    expect(byPhase.size).toBe(1);
    expect(byPhase.has('p1')).toBe(true);
  });

  it('omits a phase that has no recorded proof', () => {
    const byPhase = proofRecordsFromEntries([proofEntry({ phase: 'p1' })]);
    expect(byPhase.has('p2')).toBe(false);
  });

  it('deletes a phase from the map when an invalidation marker follows its record', () => {
    const byPhase = proofRecordsFromEntries([
      proofEntry({ phase: 'p1', passed: false, gatePassed: false }),
      invalidationEntry('p1'),
    ]);
    expect(byPhase.has('p1')).toBe(false);
  });

  it('re-adds a phase when a newer real verdict follows its invalidation marker', () => {
    const byPhase = proofRecordsFromEntries([
      proofEntry({ phase: 'p1', passed: false, gatePassed: false, reason: 'nonzero-exit' }),
      invalidationEntry('p1'),
      proofEntry({ phase: 'p1', passed: true, gatePassed: true }),
    ]);
    expect(byPhase.get('p1')!.passed).toBe(true);
    expect(byPhase.get('p1')!.gatePassed).toBe(true);
  });

  it('scopes invalidation to its own phase (a sibling record is untouched)', () => {
    const byPhase = proofRecordsFromEntries([
      proofEntry({ phase: 'p1', passed: true, gatePassed: true }),
      proofEntry({ phase: 'p2', passed: false, gatePassed: false }),
      invalidationEntry('p1'),
    ]);
    expect(byPhase.has('p1')).toBe(false);
    expect(byPhase.get('p2')!.gatePassed).toBe(false);
  });
});
