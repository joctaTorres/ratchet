/**
 * `computeBatchStatus` derives the prior-phase gate from the RECORDED proof.
 *
 * The phase gate no longer keys off "prior phase all changes done" alone: once a
 * phase's boundary proof-of-work is recorded, the next phase opens or closes on
 * that verdict's `gatePassed`. With phase `p1` done and `p2` outstanding:
 *   - no recorded proof yet            -> `p2` is NOT proof-blocked (the boundary
 *                                          proof can still run);
 *   - recorded gatePassed:false        -> `p2` is `blocked`, `gatedBy` cites p1's
 *                                          failing proof;
 *   - recorded gatePassed:true         -> `p2` is not blocked;
 *   - a later passing record overrides an earlier failing one;
 *   - under `warn` (passed:false / gatePassed:true) -> `p2` is not blocked.
 *
 * `warn` needs no manifest policy here: the recorder folds the policy into
 * `gatePassed`, so the gate consults a single boolean either way.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { computeBatchStatus } from '../../../src/core/batch/status.js';
import { parseBatchManifest } from '../../../src/core/batch/manifest.js';
import {
  appendJournal,
  recordProofOfWork,
  recordProofOfWorkInvalidation,
  type ProofOfWorkRecord,
} from '../../../src/core/batch/journal.js';

let projectRoot: string;
let changesDir: string;
const BATCH = 'gate';

const MANIFEST = `
name: ${BATCH}
phases:
  - name: p1
    goal: g
    success: s
    proofOfWork: { kind: integration, run: x, pass: '0' }
    changes:
      - name: c1
        done: c1 is implemented and verifies
  - name: p2
    goal: g2
    success: s2
    proofOfWork: { kind: integration, run: y, pass: '0' }
    changes:
      - name: c2
        done: c2 is implemented and verifies
`;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gate-status-'));
  changesDir = path.join(projectRoot, '.ratchet', 'changes');
  await fs.mkdir(changesDir, { recursive: true });
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'batches', BATCH, 'run'), {
    recursive: true,
  });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

/** Make c1 (and therefore phase p1) done: tasks checked + verify journaled. */
async function markP1Done(): Promise<void> {
  const dir = path.join(changesDir, 'c1');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'plan.md'), '## Tasks\n- [x] one\n', 'utf-8');
  appendJournal(projectRoot, BATCH, {
    change: 'c1',
    kind: 'completion',
    message: 'verified',
    transition: 'verify',
  });
}

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

function phase(status: Awaited<ReturnType<typeof computeBatchStatus>>, name: string) {
  return status.phases.find((p) => p.name === name)!;
}

describe('computeBatchStatus proof-aware phase gate (hard-gate)', () => {
  it('leaves the gate open when the prior phase is done but no proof is recorded', async () => {
    await markP1Done();
    const status = await computeBatchStatus(projectRoot, parseBatchManifest(MANIFEST));
    const p2 = phase(status, 'p2');
    expect(p2.gated).toBe(false);
    expect(p2.status).not.toBe('blocked');
  });

  it('blocks the next phase when the recorded proof failed, citing the proof', async () => {
    await markP1Done();
    recordProofOfWork(
      projectRoot,
      BATCH,
      'p1',
      record({ passed: false, gatePassed: false, reason: 'nonzero-exit', detail: 'command exited 7' })
    );
    const status = await computeBatchStatus(projectRoot, parseBatchManifest(MANIFEST));
    const p2 = phase(status, 'p2');
    expect(p2.gated).toBe(true);
    expect(p2.status).toBe('blocked');
    expect(p2.gatedBy).toContain('p1');
    expect(p2.gatedBy).toMatch(/proof-of-work/i);
    expect(p2.gatedBy).toContain('command exited 7');
  });

  it('opens the gate when the recorded proof passed', async () => {
    await markP1Done();
    recordProofOfWork(projectRoot, BATCH, 'p1', record({ passed: true, gatePassed: true }));
    const status = await computeBatchStatus(projectRoot, parseBatchManifest(MANIFEST));
    const p2 = phase(status, 'p2');
    expect(p2.gated).toBe(false);
    expect(p2.status).not.toBe('blocked');
  });

  it('lets a later passing proof reopen a gate an earlier failing proof closed (after invalidation)', async () => {
    await markP1Done();
    recordProofOfWork(
      projectRoot,
      BATCH,
      'p1',
      record({ passed: false, gatePassed: false, reason: 'nonzero-exit', detail: 'failed' })
    );
    // The recorder is idempotent per boundary (W2): a fresh passing record is
    // only accepted after the failing one is explicitly invalidated (the
    // `batch rerun-proof` path). Without the invalidation the re-record is a
    // no-op and the gate would stay closed.
    recordProofOfWorkInvalidation(projectRoot, BATCH, 'p1');
    recordProofOfWork(projectRoot, BATCH, 'p1', record({ passed: true, gatePassed: true }));
    const status = await computeBatchStatus(projectRoot, parseBatchManifest(MANIFEST));
    expect(phase(status, 'p2').gated).toBe(false);
  });

  it('under warn, a passed:false / gatePassed:true record leaves the next phase open', async () => {
    await markP1Done();
    recordProofOfWork(
      projectRoot,
      BATCH,
      'p1',
      record({ passed: false, gatePassed: true, policy: 'warn', reason: 'nonzero-exit', detail: 'failed (warn)' })
    );
    const status = await computeBatchStatus(projectRoot, parseBatchManifest(MANIFEST));
    const p2 = phase(status, 'p2');
    expect(p2.gated).toBe(false);
    expect(p2.status).not.toBe('blocked');
  });

  it('still gates the next phase the old way when the prior phase is not done', async () => {
    // p1's change is NOT done: the gate stays closed on "prior phase not done"
    // and `gatedBy` is the bare phase name (unchanged behavior, no proof yet).
    const status = await computeBatchStatus(projectRoot, parseBatchManifest(MANIFEST));
    const p2 = phase(status, 'p2');
    expect(p2.gated).toBe(true);
    expect(p2.gatedBy).toBe('p1');
  });
});
