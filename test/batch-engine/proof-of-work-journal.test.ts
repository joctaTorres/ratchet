/**
 * Durable proof-of-work record in the batch run journal.
 *
 * The boundary host loop executes a phase's proof-of-work once and must persist
 * the verdict so it survives across the stateless single-step `batch apply`
 * invocations. This test pins the journal writer/readers: a `ProofOfWorkRecord`
 * (phase, passed, gatePassed, policy, reason, detail) round-trips, the latest
 * recording wins per phase, and an unrecorded phase reads back as undefined.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  recordProofOfWork,
  readLatestProofOfWork,
  readProofOfWorkByPhase,
  proofOfWorkJournalKey,
  type ProofOfWorkRecord,
} from '../../src/core/batch/journal.js';
import { decompositionJournalKey } from '../../src/core/batch/engine/instructions.js';

let projectRoot: string;
const BATCH = 'powj';

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'powj-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'batches', BATCH, 'run'), {
    recursive: true,
  });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

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

describe('proof-of-work journal record', () => {
  it('round-trips a ProofOfWorkRecord via the reader', () => {
    recordProofOfWork(projectRoot, BATCH, 'p1', record());
    const got = readLatestProofOfWork(projectRoot, BATCH, 'p1');
    expect(got).toBeDefined();
    expect(got).toMatchObject({
      phase: 'p1',
      passed: true,
      gatePassed: true,
      policy: 'hard-gate',
      reason: 'pass-condition-met',
      detail: 'Proof-of-work passed (exit 0).',
    });
  });

  it('is idempotent per boundary: a back-to-back re-record is a no-op (first record wins)', () => {
    // The recorder is idempotent (W2): once a phase has a current, un-invalidated
    // record, a second back-to-back call is dropped — a single current record
    // survives, so a concurrent double-apply cannot append two verdicts.
    const first = recordProofOfWork(
      projectRoot,
      BATCH,
      'p1',
      record({ passed: false, gatePassed: false, reason: 'nonzero-exit', detail: 'failed' })
    );
    expect(first).toBeDefined();
    const second = recordProofOfWork(projectRoot, BATCH, 'p1', record({ passed: true }));
    expect(second).toBeUndefined(); // no-op: a current record already exists
    // The first (failing) record is still the current verdict — not overwritten.
    expect(readLatestProofOfWork(projectRoot, BATCH, 'p1')!.passed).toBe(false);
  });

  it('accepts a fresh record after an invalidation marker', async () => {
    const { recordProofOfWorkInvalidation } = await import('../../src/core/batch/journal.js');
    recordProofOfWork(
      projectRoot,
      BATCH,
      'p1',
      record({ passed: false, gatePassed: false, reason: 'nonzero-exit', detail: 'failed' })
    );
    // An explicit invalidation drops the phase from the fold, so the next record
    // is accepted (this is the `batch rerun-proof` path).
    recordProofOfWorkInvalidation(projectRoot, BATCH, 'p1');
    const fresh = recordProofOfWork(projectRoot, BATCH, 'p1', record({ passed: true }));
    expect(fresh).toBeDefined();
    expect(readLatestProofOfWork(projectRoot, BATCH, 'p1')!.passed).toBe(true);
  });

  it('returns undefined for an unrecorded phase', () => {
    recordProofOfWork(projectRoot, BATCH, 'p1', record());
    expect(readLatestProofOfWork(projectRoot, BATCH, 'p2')).toBeUndefined();
  });

  it('reads the latest outcome per phase as a map', () => {
    recordProofOfWork(projectRoot, BATCH, 'p1', record({ phase: 'p1' }));
    recordProofOfWork(
      projectRoot,
      BATCH,
      'p2',
      record({ phase: 'p2', passed: false, gatePassed: false })
    );
    const byPhase = readProofOfWorkByPhase(projectRoot, BATCH);
    expect(byPhase.get('p1')!.passed).toBe(true);
    expect(byPhase.get('p2')!.passed).toBe(false);
    expect(byPhase.has('p3')).toBe(false);
  });

  it('keys the proof entry distinctly from a decomposition entry for the same phase', () => {
    // Both are phase-scoped journal entries; their keys must not collide so the
    // proof reader never picks up a decomposition completion (or vice versa).
    expect(proofOfWorkJournalKey('p1')).not.toBe(decompositionJournalKey('p1'));
  });
});
