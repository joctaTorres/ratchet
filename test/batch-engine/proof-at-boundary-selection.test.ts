/**
 * `pickNextStep` surfaces the prior phase's proof-of-work at the boundary.
 *
 * When phase 1 is done and phase 2 (ungated, so phase 1 IS done) still has an
 * outstanding change, the host loop must run phase 1's proof-of-work BEFORE it
 * enters phase 2 — and only once. This test pins the selection seam:
 *  - p1 done + p2 has work + no recorded proof  -> a `proof-of-work` target for p1;
 *  - the same once p1 is in the recorded-proof set -> p2's outstanding change;
 *  - the first phase (no predecessor) -> its own change, never a proof step.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { appendJournal } from '../../src/core/batch/journal.js';
import { computeBatchStatus } from '../../src/core/batch/status.js';
import {
  loadBatchManifest,
  getBatchManifestPath,
} from '../../src/core/batch/manifest.js';
import { pickNextStep } from '../../src/commands/batch/apply.js';

let projectRoot: string;
const BATCH = 'powb';
const POW = `proofOfWork: { kind: integration, run: x, pass: '0' }`;

const MANIFEST = `
name: ${BATCH}
phases:
  - name: p1
    goal: ship the first slice
    success: phase one succeeds
    ${POW}
    changes:
      - name: first
        done: first is done
  - name: p2
    goal: ship the second slice
    success: phase two succeeds
    ${POW}
    changes:
      - name: second
        done: second is done
`;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'powb-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'batches', BATCH), { recursive: true });
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

describe('pickNextStep: proof-of-work at the phase boundary', () => {
  it('returns a proof-of-work target for the prior phase when entering a phase with work', async () => {
    await markDone('first');
    const manifest = loadBatchManifest(projectRoot, BATCH);
    const status = await computeBatchStatus(projectRoot, manifest);

    const target = pickNextStep(status, manifest.phases, new Set());
    expect(target).toBeDefined();
    expect(target!.kind).toBe('proof-of-work');
    expect((target as { phase: { name: string } }).phase.name).toBe('p1');
  });

  it('selects the next phase change once the prior phase proof is recorded', async () => {
    await markDone('first');
    const manifest = loadBatchManifest(projectRoot, BATCH);
    const status = await computeBatchStatus(projectRoot, manifest);

    const target = pickNextStep(status, manifest.phases, new Set(['p1']));
    expect(target).toMatchObject({ kind: 'change', change: 'second' });
  });

  it('runs no proof for the first phase: its own change is selected directly', async () => {
    // Nothing done yet: p1 itself has the outstanding change; it has no predecessor.
    const manifest = loadBatchManifest(projectRoot, BATCH);
    const status = await computeBatchStatus(projectRoot, manifest);

    const target = pickNextStep(status, manifest.phases, new Set());
    expect(target).toMatchObject({ kind: 'change', change: 'first' });
  });
});
