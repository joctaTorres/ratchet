/**
 * Status and selection agree on the proof-derived phase gate, and `batch apply`
 * cites the blocking proof.
 *
 * The gate is computed once in `computeBatchStatus`; both selection seams read
 * its result. With phase `p1` done and `p2` outstanding under `hard-gate`:
 *   - a recorded FAILING proof for `p1` makes `pickNextStep` return no `p2` change
 *     AND `selectRunnableStep` (fed `gated` straight from the same status) agree
 *     there is no runnable `p2` work — status and selection cannot disagree;
 *   - a recorded PASSING proof returns `p2`'s outstanding change from both seams;
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
  readLatestProofOfWork,
  type ProofOfWorkRecord,
} from '../../src/core/batch/journal.js';
import { computeBatchStatus, type BatchStatusInfo } from '../../src/core/batch/status.js';
import { loadBatchManifest, getBatchManifestPath } from '../../src/core/batch/manifest.js';
import { pickNextStep, batchApplyCommand } from '../../src/commands/batch/apply.js';
import {
  selectRunnableStep,
  type SelectablePhase,
} from '../../src/core/batch/engine/selection.js';

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

/** Feed `gated` straight from the derived status into the pure selection seam. */
function selectableFromStatus(status: BatchStatusInfo): SelectablePhase[] {
  return status.phases.map((p) => ({
    name: p.name,
    gated: p.gated,
    changes: p.changes.map((c) => ({
      name: c.name,
      after: c.after,
      done: c.status === 'done',
      parked: c.status === 'blocked' || c.status === 'awaiting-approval',
    })),
  }));
}

describe('proof-derived gate: status and selection agree', () => {
  it('a failing recorded proof makes pickNextStep AND selectRunnableStep refuse p2', async () => {
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

    // selectRunnableStep over the same derived `gated` agrees: no p2 step.
    const result = selectRunnableStep(selectableFromStatus(status));
    expect(result.step).toBeUndefined();
    expect(result.reason).toBe('all-gated');
  });

  it('a passing recorded proof makes both seams yield p2 outstanding change', async () => {
    await markDone('first');
    recordProofOfWork(projectRoot, BATCH, 'p1', record({ passed: true, gatePassed: true }));
    const manifest = loadBatchManifest(projectRoot, BATCH);
    const status = await computeBatchStatus(projectRoot, manifest);

    const target = pickNextStep(status, manifest.phases, new Set(['p1']));
    expect(target).toMatchObject({ kind: 'change', change: 'second' });

    const result = selectRunnableStep(selectableFromStatus(status));
    expect(result.step).toEqual({ phase: 'p2', change: 'second' });
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
