/**
 * A reachable phase with an empty `changes` list is an outstanding decomposition
 * step, not "done" (#30).
 *
 * The engine's done arithmetic used to count only DECLARED change intents:
 * `computeBatchStatus` reported `done` when `doneCount === changeCount` (both
 * derived from `phase.changes`), and `selectRunnableStep` computed
 * `allDone = phases.every((p) => p.changes.every((c) => c.done))` — which an
 * empty phase satisfies VACUOUSLY. So the moment the first phase's declared
 * changes were done, both consumers wrongly agreed the batch was finished even
 * though a later phase had no concrete intents yet.
 *
 * This recognition slice makes both seams key off the same two facts — "phase
 * decomposed?" (`changes.length > 0`) and "phase reachable?" (ungated) — so a
 * ready, ungated empty phase keeps the batch out of `done` and is surfaced as the
 * outstanding decomposition step. It asserts:
 *
 *  (a) status does NOT report `done` and surfaces the empty phase as outstanding;
 *  (b) selection does NOT return `all-done` and surfaces the empty phase as the
 *      decomposition step;
 *  (c) a gated empty phase is not selected while the prior phase has work;
 *  (d) a fully-decomposed, all-done batch still reports `done` and `all-done`;
 *  (e) no regression of the ready/blocked/in-progress/awaiting-verify states.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { appendJournal, recordProofOfWork } from '../../src/core/batch/journal.js';
import {
  isChangeDone,
  readChangeDiskState,
  selectRunnableStep,
  type SelectablePhase,
} from '../../src/core/batch/engine/index.js';
import { readChangeJournalTolerant } from '../../src/core/batch/engine/run-state.js';
import { computeBatchStatus } from '../../src/core/batch/status.js';
import { parseBatchManifest } from '../../src/core/batch/manifest.js';

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'epind-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

const BATCH = 'epind';

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

/**
 * Record a passing boundary proof for a phase. The TERMINAL phase's proof never
 * runs at a successor boundary (there is none), so a fully-done batch is only
 * `done` once its last phase's proof is recorded as satisfied (C2).
 */
function recordPassingProof(phase: string): void {
  recordProofOfWork(projectRoot, BATCH, phase, {
    phase,
    passed: true,
    gatePassed: true,
    policy: 'hard-gate',
    reason: 'pass-condition-met',
    detail: 'Proof-of-work passed (0).',
  });
}

/** Leave a change with an open task: in-progress, not done. */
async function markInProgress(change: string): Promise<void> {
  const dir = path.join(projectRoot, '.ratchet', 'changes', change);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'plan.md'), '## Tasks\n- [ ] 1.1 todo\n', 'utf-8');
}

/** Build the selection view from a status snapshot, mirroring the real seam. */
function selectableFor(status: Awaited<ReturnType<typeof computeBatchStatus>>): SelectablePhase[] {
  return status.phases.map((phase) => ({
    name: phase.name,
    gated: phase.gated,
    // `decomposed` is derived from `changes.length > 0` (left to the default), so
    // an empty phase reports undecomposed without the caller spelling it out.
    changes: phase.changes.map((c) => {
      const disk = readChangeDiskState(projectRoot, c.name);
      const journal = readChangeJournalTolerant(projectRoot, BATCH, c.name);
      return { name: c.name, after: c.after, done: isChangeDone(disk, journal), parked: false };
    }),
  }));
}

const POW = `proofOfWork: { kind: integration, run: x, pass: '0' }`;

describe('a reachable empty phase keeps the batch not-done', () => {
  it('(a) first phase done but a later ungated empty phase is NOT done', async () => {
    const manifest = `
name: ${BATCH}
phases:
  - name: p1
    goal: ship the first slice
    success: s
    ${POW}
    changes:
      - name: first
        done: first is done
  - name: p2
    goal: decompose me later
    success: s
    ${POW}
    changes: []
`;
    await markDone('first');
    const status = await computeBatchStatus(projectRoot, parseBatchManifest(manifest));

    // The declared change is done, but the batch is NOT done — p2 is undecomposed.
    expect(status.doneCount).toBe(1);
    expect(status.changeCount).toBe(1);
    expect(status.status).not.toBe('done');
    expect(status.status).toBe('in-progress');

    // p1 is done at the phase level; p2 is reachable (ungated) but not done.
    const p1 = status.phases.find((p) => p.name === 'p1')!;
    const p2 = status.phases.find((p) => p.name === 'p2')!;
    expect(p1.status).toBe('done');
    expect(p2.gated).toBe(false);
    expect(p2.status).not.toBe('done');

    // The empty phase is surfaced as the outstanding decomposition step.
    expect(status.next).toEqual({ phase: 'p2', decompose: true });
  });

  it('(b) selection surfaces the empty phase as the decomposition step, not all-done', async () => {
    const manifest = `
name: ${BATCH}
phases:
  - name: p1
    goal: ship the first slice
    success: s
    ${POW}
    changes:
      - name: first
        done: first is done
  - name: p2
    goal: decompose me later
    success: s
    ${POW}
    changes: []
`;
    await markDone('first');
    const status = await computeBatchStatus(projectRoot, parseBatchManifest(manifest));
    const result = selectRunnableStep(selectableFor(status));

    expect(result.reason).not.toBe('all-done');
    expect(result.step).toEqual({ phase: 'p2', decompose: true });

    // Status and selection agree: both have an outstanding step, neither is done.
    expect(status.status).not.toBe('done');
  });

  it('(c) a gated empty phase is not selected while the prior phase has work', async () => {
    const manifest = `
name: ${BATCH}
phases:
  - name: p1
    goal: still working
    success: s
    ${POW}
    changes:
      - name: first
        done: first is done
  - name: p2
    goal: decompose me later
    success: s
    ${POW}
    changes: []
`;
    await markInProgress('first');
    const status = await computeBatchStatus(projectRoot, parseBatchManifest(manifest));

    // p1 has an unfinished change, so p2 is gated and not yet outstanding.
    const p2 = status.phases.find((p) => p.name === 'p2')!;
    expect(p2.gated).toBe(true);
    expect(status.status).not.toBe('done');
    // The next step is the unfinished prior-phase change, NOT the empty phase.
    expect(status.next).toEqual({ phase: 'p1', change: 'first' });

    const result = selectRunnableStep(selectableFor(status));
    expect(result.step).toEqual({ phase: 'p1', change: 'first' });
    expect(result.step?.decompose).toBeUndefined();
  });

  it('(d) a fully-decomposed, all-done batch still reports done and all-done', async () => {
    const manifest = `
name: ${BATCH}
phases:
  - name: p1
    goal: ship the first slice
    success: s
    ${POW}
    changes:
      - name: first
        done: first is done
  - name: p2
    goal: ship the second slice
    success: s
    ${POW}
    changes:
      - name: second
        done: second is done
`;
    await markDone('first');
    await markDone('second');
    // The terminal phase (p2) has no successor boundary, so its proof must be
    // recorded for the batch to be `done` (C2).
    recordPassingProof('p2');
    const status = await computeBatchStatus(projectRoot, parseBatchManifest(manifest));

    expect(status.doneCount).toBe(2);
    expect(status.changeCount).toBe(2);
    expect(status.status).toBe('done');
    expect(status.next).toBeUndefined();

    const result = selectRunnableStep(selectableFor(status));
    expect(result.reason).toBe('all-done');
    expect(result.step).toBeUndefined();
  });
});

describe('empty-phase recognition: regression guards', () => {
  it('(e) ready / blocked / in-progress within a phase are unchanged', async () => {
    const manifest = `
name: ${BATCH}
phases:
  - name: p1
    goal: g
    success: s
    ${POW}
    changes:
      - name: first
        done: first is done
      - name: second
        after: [first]
        done: second is done
`;
    await markInProgress('first');
    const status = await computeBatchStatus(projectRoot, parseBatchManifest(manifest));
    const first = status.phases[0].changes.find((c) => c.name === 'first')!;
    const second = status.phases[0].changes.find((c) => c.name === 'second')!;

    expect(first.status).toBe('in-progress');
    expect(second.status).toBe('blocked');
    expect(status.status).toBe('in-progress');
    // The only ungated work is `first`; selection picks it.
    expect(selectRunnableStep(selectableFor(status)).step).toEqual({
      phase: 'p1',
      change: 'first',
    });
  });

  it('(e) a single fully-decomposed phase with all changes done still reports done', async () => {
    const manifest = `
name: ${BATCH}
phases:
  - name: p1
    goal: g
    success: s
    ${POW}
    changes:
      - name: only
        done: only is done
`;
    await markDone('only');
    // Single-phase batch: this only phase is the terminal phase, so its proof
    // must be recorded for the batch to be `done` (C2).
    recordPassingProof('p1');
    const status = await computeBatchStatus(projectRoot, parseBatchManifest(manifest));
    expect(status.status).toBe('done');
    expect(selectRunnableStep(selectableFor(status)).reason).toBe('all-done');
  });
});
