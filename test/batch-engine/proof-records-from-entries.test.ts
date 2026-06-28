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
});
