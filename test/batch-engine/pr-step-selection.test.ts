/**
 * `pickNextStep` surfaces the completion PR step ONLY at genuine batch completion.
 *
 * The `pr` target is reached only after every existing branch (change → decompose
 * → boundary proof → terminal proof) has declined, i.e. when `status.status` is
 * `done`. This pins the pure selector's new tail branch over its gating inputs:
 *  - done + { grouping: 'whole-batch', alreadyOpened: false } -> a `pr` target for
 *    the terminal phase;
 *  - grouping 'off', unset (no prContext), and alreadyOpened: true each -> no `pr`
 *    target (undefined), so `off`/unset is byte-identical to today;
 *  - a not-yet-`done` status -> never a `pr` target;
 *  - an outstanding change -> that change target, never the `pr` target.
 *
 * The selector reads neither config nor the journal: the gating inputs arrive as
 * data (`instruction-fed-config`), so these cases exercise it with no filesystem
 * config/journal read.
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
import { pickNextStep } from '../../src/commands/batch/apply.js';

let projectRoot: string;
const BATCH = 'prsel';

/** A single-phase batch: the terminal phase IS the only phase. */
const MANIFEST = `
name: ${BATCH}
phases:
  - name: only
    goal: ship the only slice
    success: the only slice works
    proofOfWork: { kind: integration, run: x, pass: '0' }
    changes:
      - name: solo
        done: solo is done
`;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prsel-'));
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

/** Record a passing terminal boundary proof so the batch reaches `done`. */
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

/** Build the `done` status: the only change done+verified and the terminal proof recorded. */
async function doneStatus() {
  await markDone('solo');
  passProof('only');
  const manifest = loadBatchManifest(projectRoot, BATCH);
  const status = await computeBatchStatus(projectRoot, manifest);
  expect(status.status).toBe('done');
  return { status, manifest };
}

describe('pickNextStep: completion PR step', () => {
  it('returns a `pr` target for the terminal phase on a done whole-batch batch not yet opened', async () => {
    const { status, manifest } = await doneStatus();

    const target = pickNextStep(status, manifest.phases, new Set(), {
      grouping: 'whole-batch',
      alreadyOpened: false,
    });

    expect(target).toBeDefined();
    expect(target!.kind).toBe('pr');
    expect((target as { phase: { name: string } }).phase.name).toBe('only');
  });

  it('returns no `pr` target when grouping is `off`', async () => {
    const { status, manifest } = await doneStatus();

    const target = pickNextStep(status, manifest.phases, new Set(), {
      grouping: 'off',
      alreadyOpened: false,
    });

    expect(target).toBeUndefined();
  });

  it('returns no `pr` target when grouping is unset (no prContext)', async () => {
    const { status, manifest } = await doneStatus();

    // Unset behaves exactly as `off`: the existing terminal "nothing to do" path.
    expect(pickNextStep(status, manifest.phases, new Set())).toBeUndefined();
  });

  it('returns no `pr` target once the PR is already opened (idempotent resume)', async () => {
    const { status, manifest } = await doneStatus();

    const target = pickNextStep(status, manifest.phases, new Set(), {
      grouping: 'whole-batch',
      alreadyOpened: true,
    });

    expect(target).toBeUndefined();
  });

  it('never surfaces a `pr` target while the batch is not yet done', async () => {
    // The change is done but the terminal proof has NOT run: NOT done — the
    // terminal proof is what is runnable, never the PR step.
    await markDone('solo');
    const manifest = loadBatchManifest(projectRoot, BATCH);
    const status = await computeBatchStatus(projectRoot, manifest);
    expect(status.status).not.toBe('done');

    const target = pickNextStep(status, manifest.phases, new Set(), {
      grouping: 'whole-batch',
      alreadyOpened: false,
    });

    expect(target).toBeDefined();
    expect(target!.kind).not.toBe('pr');
  });

  it('returns the outstanding change target, never the `pr` target, when work remains', async () => {
    // Nothing done: `solo` is the outstanding change, so it — not the PR step — is
    // selected even under `whole-batch`.
    const manifest = loadBatchManifest(projectRoot, BATCH);
    const status = await computeBatchStatus(projectRoot, manifest);

    const target = pickNextStep(status, manifest.phases, new Set(), {
      grouping: 'whole-batch',
      alreadyOpened: false,
    });

    expect(target).toMatchObject({ kind: 'change', change: 'solo' });
  });
});
