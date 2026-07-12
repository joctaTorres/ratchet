/**
 * `pickNextStep` surfaces one stacked PR target per unopened group boundary.
 *
 * Extends the whole-batch PR-step selection coverage (pr-step-selection.test.ts)
 * with the stacked tail: at genuine batch completion under `per-phase`/`per-change`
 * the selector derives the ordered group boundaries from the manifest
 * (`detectPrGroupBoundaries` stays the single home of "where the groups are") and
 * returns a `pr` target — carrying the fired `boundary` — for the FIRST boundary
 * whose per-group PR key (`prJournalKey(batch, boundary)`) is not in
 * `openedGroupKeys`; recording a group's key advances selection to the next
 * boundary, and a fully-recorded batch returns `undefined` (the unchanged
 * "nothing to do" terminal). `off`/unset, `whole-batch` (still boundary-less), a
 * not-yet-`done` status, and an outstanding change behave exactly as before.
 *
 * The selector reads neither config nor the journal: the gating inputs
 * (`grouping`, `openedGroupKeys`) arrive as data (`instruction-fed-config`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { appendJournal, recordProofOfWork } from '../../src/core/batch/journal.js';
import { computeBatchStatus } from '../../src/core/batch/status.js';
import {
  loadBatchManifest,
  getBatchManifestPath,
} from '../../src/core/batch/manifest.js';
import { pickNextStep, type ApplyTarget } from '../../src/core/batch/engine/index.js';

let projectRoot: string;
const BATCH = 'stacksel';

/** Two phases, each with changes: two `phase` groups, three `change` groups. */
const MANIFEST = `
name: ${BATCH}
phases:
  - name: ph-one
    goal: ship the first slice
    success: the first slice works
    proofOfWork: { kind: integration, run: x, pass: '0' }
    changes:
      - name: c1
        done: c1 is done
      - name: c2
        after: [c1]
        done: c2 is done
  - name: ph-two
    goal: ship the second slice
    success: the second slice works
    proofOfWork: { kind: integration, run: x, pass: '0' }
    changes:
      - name: c3
        done: c3 is done
`;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksel-'));
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

/** Record a passing boundary proof for a phase. */
function passProof(phase: string): void {
  recordProofOfWork(projectRoot, BATCH, phase, {
    phase,
    passed: true,
    gatePassed: true,
    policy: 'hard-gate',
    reason: 'pass-condition-met',
    detail: 'Proof-of-work passed (exit 0).',
  });
}

/** Build the `done` status: every change done+verified, both boundary proofs recorded. */
async function doneStatus() {
  await markDone('c1');
  await markDone('c2');
  await markDone('c3');
  passProof('ph-one');
  passProof('ph-two');
  const manifest = loadBatchManifest(projectRoot, BATCH);
  const status = await computeBatchStatus(projectRoot, manifest);
  expect(status.status).toBe('done');
  return { status, manifest };
}

/** The `pr`-narrowed target, asserted present. */
function asPr(target: ApplyTarget | undefined): Extract<ApplyTarget, { kind: 'pr' }> {
  expect(target).toBeDefined();
  expect(target!.kind).toBe('pr');
  return target as Extract<ApplyTarget, { kind: 'pr' }>;
}

describe('pickNextStep: stacked per-phase PR selection', () => {
  it('returns the FIRST phase boundary on a done batch with no group recorded', async () => {
    const { status, manifest } = await doneStatus();

    const target = asPr(
      pickNextStep(status, manifest.phases, new Set(), {
        grouping: 'per-phase',
        alreadyOpened: false,
        openedGroupKeys: new Set(),
      })
    );

    expect(target.boundary).toMatchObject({
      index: 0,
      kind: 'phase',
      groupId: 'ph-one',
      triggerChange: 'c2',
    });
    expect(target.phase.name).toBe('ph-one');
  });

  it('advances to the SECOND boundary once the first group key is recorded', async () => {
    const { status, manifest } = await doneStatus();

    const target = asPr(
      pickNextStep(status, manifest.phases, new Set(), {
        grouping: 'per-phase',
        alreadyOpened: false,
        openedGroupKeys: new Set([`pr:${BATCH}:ph-one`]),
      })
    );

    expect(target.boundary).toMatchObject({ index: 1, kind: 'phase', groupId: 'ph-two' });
    expect(target.phase.name).toBe('ph-two');
  });

  it('returns undefined once every group key is recorded', async () => {
    const { status, manifest } = await doneStatus();

    const target = pickNextStep(status, manifest.phases, new Set(), {
      grouping: 'per-phase',
      alreadyOpened: false,
      openedGroupKeys: new Set([`pr:${BATCH}:ph-one`, `pr:${BATCH}:ph-two`]),
    });

    expect(target).toBeUndefined();
  });
});

describe('pickNextStep: stacked per-change PR selection', () => {
  it('yields one target per change, in order, as each group key is recorded', async () => {
    const { status, manifest } = await doneStatus();
    const opened = new Set<string>();

    for (const [index, change] of ['c1', 'c2', 'c3'].entries()) {
      const target = asPr(
        pickNextStep(status, manifest.phases, new Set(), {
          grouping: 'per-change',
          alreadyOpened: false,
          openedGroupKeys: opened,
        })
      );
      expect(target.boundary).toMatchObject({ index, kind: 'change', groupId: change });
      opened.add(`pr:${BATCH}:${change}`);
    }

    expect(
      pickNextStep(status, manifest.phases, new Set(), {
        grouping: 'per-change',
        alreadyOpened: false,
        openedGroupKeys: opened,
      })
    ).toBeUndefined();
  });

  it('frames each change group with the phase that change belongs to', async () => {
    const { status, manifest } = await doneStatus();

    const target = asPr(
      pickNextStep(status, manifest.phases, new Set(), {
        grouping: 'per-change',
        alreadyOpened: false,
        openedGroupKeys: new Set([`pr:${BATCH}:c1`, `pr:${BATCH}:c2`]),
      })
    );

    expect(target.boundary?.groupId).toBe('c3');
    expect(target.phase.name).toBe('ph-two');
  });
});

describe('pickNextStep: stacked tail leaves existing behavior unchanged', () => {
  it('returns no target under `off`', async () => {
    const { status, manifest } = await doneStatus();

    expect(
      pickNextStep(status, manifest.phases, new Set(), {
        grouping: 'off',
        alreadyOpened: false,
        openedGroupKeys: new Set(),
      })
    ).toBeUndefined();
  });

  it('returns no target when grouping is unset (no prContext)', async () => {
    const { status, manifest } = await doneStatus();

    expect(pickNextStep(status, manifest.phases, new Set())).toBeUndefined();
  });

  it('keeps the whole-batch tail boundary-less', async () => {
    const { status, manifest } = await doneStatus();

    const target = asPr(
      pickNextStep(status, manifest.phases, new Set(), {
        grouping: 'whole-batch',
        alreadyOpened: false,
        openedGroupKeys: new Set(),
      })
    );

    expect(target.boundary).toBeUndefined();
    expect(target.phase.name).toBe('ph-two');
  });

  it('never surfaces a stacked `pr` target while the batch is not yet done', async () => {
    // Every change done but the terminal proof unrecorded: NOT done — the
    // terminal proof is what is runnable, never a stacked PR step.
    await markDone('c1');
    await markDone('c2');
    await markDone('c3');
    passProof('ph-one');
    const manifest = loadBatchManifest(projectRoot, BATCH);
    const status = await computeBatchStatus(projectRoot, manifest);
    expect(status.status).not.toBe('done');

    const target = pickNextStep(status, manifest.phases, new Set(['ph-one']), {
      grouping: 'per-phase',
      alreadyOpened: false,
      openedGroupKeys: new Set(),
    });

    expect(target).toBeDefined();
    expect(target!.kind).not.toBe('pr');
  });

  it('returns the outstanding change target, never a `pr` target, when work remains', async () => {
    const manifest = loadBatchManifest(projectRoot, BATCH);
    const status = await computeBatchStatus(projectRoot, manifest);

    const target = pickNextStep(status, manifest.phases, new Set(), {
      grouping: 'per-phase',
      alreadyOpened: false,
      openedGroupKeys: new Set(),
    });

    expect(target).toMatchObject({ kind: 'change', change: 'c1' });
  });
});
