/**
 * Status and selection agree on the proof-derived phase gate, and `batch apply`
 * cites the blocking proof.
 *
 * The gate is computed once in `computeBatchStatus`; the single selection engine
 * (`pickNextStep`) reads its result via the shared eligibility walk
 * (`firstRunnableChange`, which skips gated phases). With phase `p1` done and
 * `p2` outstanding under `hard-gate`:
 *   - a recorded FAILING proof for `p1` makes `pickNextStep` return no `p2` change
 *     — status (which derives the gate) and selection share one walk, so they
 *     cannot disagree;
 *   - a recorded PASSING proof returns `p2`'s outstanding change;
 *   - `batch apply`'s no-step output cites `p1`'s failing proof rather than the
 *     generic "everything is blocked, gated, or parked" message, and advances no
 *     `p2` change (the block persists across stateless invocations).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  appendJournal,
  recordProofOfWork,
  recordProofOfWorkInvalidation,
  readLatestProofOfWork,
  readProofOfWorkByPhase,
  type ProofOfWorkRecord,
} from '../../src/core/batch/journal.js';
import { computeBatchStatus } from '../../src/core/batch/status.js';
import { loadBatchManifest, getBatchManifestPath } from '../../src/core/batch/manifest.js';
import { batchApplyCommand } from '../../src/commands/batch/apply.js';
import { pickNextStep } from '../../src/core/batch/engine/index.js';

let projectRoot: string;
const BATCH = 'powg';

const MANIFEST = `
name: ${BATCH}
settings:
  agent: no-such-agent
phases:
  - name: p1
    goal: ship the first slice
    success: phase one succeeds
    proofOfWork: { kind: integration, run: x, pass: '0' }
    changes:
      - name: first
        done: first is done
  - name: p2
    goal: ship the second slice
    success: phase two succeeds
    proofOfWork: { kind: integration, run: y, pass: '0' }
    changes:
      - name: second
        done: second is done
`;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'powg-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'batches', BATCH, 'run'), {
    recursive: true,
  });
  await fs.writeFile(getBatchManifestPath(projectRoot, BATCH), MANIFEST, 'utf-8');
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

/** Mark a change done under the journal-aware rule: tasks checked + verify journaled. */
async function markDone(change: string): Promise<void> {
  const dir = path.join(projectRoot, '.ratchet', 'changes', change);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'plan.md'), '## Tasks\n- [x] 1.1 done\n', 'utf-8');
  appendJournal(projectRoot, BATCH, {
    change,
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

describe('proof-derived gate: status and selection agree', () => {
  it('a failing recorded proof makes pickNextStep refuse p2', async () => {
    await markDone('first');
    recordProofOfWork(
      projectRoot,
      BATCH,
      'p1',
      record({ passed: false, gatePassed: false, reason: 'nonzero-exit', detail: 'command exited 7' })
    );
    const manifest = loadBatchManifest(projectRoot, BATCH);
    const status = await computeBatchStatus(projectRoot, manifest);

    // pickNextStep: p1's change is done, p2 is proof-blocked -> no runnable step.
    const target = pickNextStep(status, manifest.phases, new Set(['p1']));
    expect(target).toBeUndefined();

    // The shared eligibility walk skips gated phases: p2 is gated, p1's change is
    // done, so `firstRunnableChange` finds nothing — status and selection agree by
    // construction (one walk, not two).
    expect(status.next).toBeUndefined();
  });

  it('a passing recorded proof makes pickNextStep yield p2 outstanding change', async () => {
    await markDone('first');
    recordProofOfWork(projectRoot, BATCH, 'p1', record({ passed: true, gatePassed: true }));
    const manifest = loadBatchManifest(projectRoot, BATCH);
    const status = await computeBatchStatus(projectRoot, manifest);

    const target = pickNextStep(status, manifest.phases, new Set(['p1']));
    expect(target).toMatchObject({ kind: 'change', change: 'second' });
    // The shared walk derived the same next from the same gate.
    expect(status.next).toEqual({ phase: 'p2', change: 'second' });
  });
});

describe('invalidation re-opens the gate and re-offers the boundary step', () => {
  it('after an invalidation marker, p2 is no longer proof-gated and pickNextStep re-offers p1 boundary proof', async () => {
    await markDone('first');
    recordProofOfWork(
      projectRoot,
      BATCH,
      'p1',
      record({ passed: false, gatePassed: false, reason: 'nonzero-exit', detail: 'command exited 7' })
    );
    const manifest = loadBatchManifest(projectRoot, BATCH);

    // Precondition: the recorded failing proof gates p2 shut and strands p2.
    let status = await computeBatchStatus(projectRoot, manifest);
    const p2Before = status.phases.find((p) => p.name === 'p2')!;
    expect(p2Before.gated).toBe(true);
    let recordedPhases = new Set(readProofOfWorkByPhase(projectRoot, BATCH).keys());
    expect(pickNextStep(status, manifest.phases, recordedPhases)).toBeUndefined();

    // Invalidate p1's recorded proof (append-only supersession marker).
    recordProofOfWorkInvalidation(projectRoot, BATCH, 'p1');

    // The gate re-opens by construction (both consumers read the same fold):
    status = await computeBatchStatus(projectRoot, manifest);
    const p2After = status.phases.find((p) => p.name === 'p2')!;
    expect(p2After.gated).toBe(false);

    // p1 is no longer in the recorded-proof set, so selection re-offers p1's
    // boundary proof-of-work step before any p2 change.
    recordedPhases = new Set(readProofOfWorkByPhase(projectRoot, BATCH).keys());
    expect(recordedPhases.has('p1')).toBe(false);
    const target = pickNextStep(status, manifest.phases, recordedPhases);
    expect(target).toMatchObject({ kind: 'proof-of-work' });
    expect((target as { phase: { name: string } }).phase.name).toBe('p1');
  });
});

describe('batch apply cites the blocking proof and advances nothing', () => {
  it('reports p1 failing proof rather than the generic gated message', async () => {
    await markDone('first');
    recordProofOfWork(
      projectRoot,
      BATCH,
      'p1',
      record({ passed: false, gatePassed: false, reason: 'nonzero-exit', detail: 'command exited 7' })
    );

    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.join(' '));
    });
    try {
      await batchApplyCommand(BATCH, { json: true }, { projectRoot });
    } finally {
      spy.mockRestore();
    }

    const out = lines.join('\n');
    const parsed = JSON.parse(out) as { state: string; message: string };
    expect(parsed.state).toBe('nothing-ready');
    // Cites the blocking proof: the predecessor phase and a proof-of-work reason,
    // not the generic "everything is blocked, gated, or parked" text.
    expect(parsed.message).toMatch(/proof-of-work/i);
    expect(parsed.message).toContain('p1');
    expect(parsed.message).toContain('command exited 7');
    expect(parsed.message).not.toMatch(/everything is blocked, gated, or parked/i);

    // No p2 change was advanced: there is still no recorded outcome for p2 and
    // 'second' never ran (its change dir was never created by an apply step).
    expect(readLatestProofOfWork(projectRoot, BATCH, 'p2')).toBeUndefined();
  });
});
