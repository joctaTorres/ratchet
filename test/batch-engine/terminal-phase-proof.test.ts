/**
 * The TERMINAL phase's proof-of-work runs before a batch reports `done` (C2).
 *
 * Every phase's boundary proof runs when ENTERING the next phase, but the LAST
 * phase has no successor, so its proof would never run — and the batch used to
 * report `done` without it. This pins the fix:
 *
 *  - once every change is done, the terminal phase's unrun proof is surfaced as
 *    `next.proof` and SELECTED by `pickNextStep`; the batch is NOT `done`;
 *  - a SINGLE-phase batch gates on its one phase's proof the same way;
 *  - running `batch apply` executes + records the terminal proof, after which a
 *    passing verdict flips the batch to `done`;
 *  - a failing terminal `hard-gate` proof keeps the batch out of `done` and the
 *    next apply's no-step output CITES that failing proof;
 *  - a `warn` policy records `gatePassed: true`, so a failing terminal proof
 *    under `warn` still reaches `done`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { appendJournal, readLatestProofOfWork } from '../../src/core/batch/journal.js';
import {
  getBatchManifestPath,
  loadBatchManifest,
} from '../../src/core/batch/manifest.js';
import { computeBatchStatus } from '../../src/core/batch/status.js';
import { pickNextStep, batchApplyCommand } from '../../src/commands/batch/apply.js';

let projectRoot: string;
const BATCH = 'tpp';

/** A single-phase batch whose proof-of-work command/pass/policy is supplied. */
function singlePhase(run: string, pass: string, policy?: 'hard-gate' | 'warn'): string {
  return `
name: ${BATCH}
settings:
  agent: no-such-agent${policy ? `\n  proofOfWork: ${policy}` : ''}
phases:
  - name: only
    goal: ship the only slice
    success: the only slice works
    proofOfWork: { kind: integration, run: "${run}", pass: "${pass}" }
    changes:
      - name: solo
        done: solo is done
`;
}

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

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tpp-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'batches', BATCH), { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

async function writeManifest(content: string): Promise<void> {
  await fs.writeFile(getBatchManifestPath(projectRoot, BATCH), content, 'utf-8');
}

function captureLog(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => {
    lines.push(args.join(' '));
  });
  return lines;
}

describe('terminal-phase proof-of-work gates `done` (C2)', () => {
  it('surfaces and selects the terminal proof when the last phase is done+unrecorded', async () => {
    await writeManifest(singlePhase('exit 0', 'exit 0'));
    await markDone('solo');

    const manifest = loadBatchManifest(projectRoot, BATCH);
    const status = await computeBatchStatus(projectRoot, manifest);

    // The only change is done, but the terminal proof has not run: NOT done.
    expect(status.doneCount).toBe(1);
    expect(status.changeCount).toBe(1);
    expect(status.status).toBe('in-progress');
    expect(status.next).toEqual({ phase: 'only', proof: true });

    // Selection picks the terminal phase's boundary proof (single-phase gating).
    const target = pickNextStep(status, manifest.phases);
    expect(target).toMatchObject({ kind: 'proof-of-work' });
    expect(target!.phase.name).toBe('only');
  });

  it('runs+records the terminal proof, then a passing verdict reaches `done`', async () => {
    await writeManifest(singlePhase('exit 0', 'exit 0'));
    await markDone('solo');

    captureLog();
    await batchApplyCommand(BATCH, { json: true }, { projectRoot });

    const rec = readLatestProofOfWork(projectRoot, BATCH, 'only');
    expect(rec).toBeDefined();
    expect(rec!.passed).toBe(true);
    expect(rec!.gatePassed).toBe(true);

    const status = await computeBatchStatus(projectRoot, loadBatchManifest(projectRoot, BATCH));
    expect(status.status).toBe('done');
    expect(status.next).toBeUndefined();
  });

  it('keeps the batch out of `done` on a failing hard-gate terminal proof and cites it', async () => {
    await writeManifest(singlePhase('exit 7', 'exit 0')); // hard-gate default
    await markDone('solo');

    // First apply runs the terminal proof and records a failing verdict.
    captureLog();
    await batchApplyCommand(BATCH, { json: true }, { projectRoot });
    const rec = readLatestProofOfWork(projectRoot, BATCH, 'only');
    expect(rec!.passed).toBe(false);
    expect(rec!.gatePassed).toBe(false);

    // The batch is NOT done; nothing is auto-runnable (operator must rerun-proof).
    const status = await computeBatchStatus(projectRoot, loadBatchManifest(projectRoot, BATCH));
    expect(status.status).toBe('in-progress');
    expect(status.next).toBeUndefined();

    // The next apply's no-step output cites the failing TERMINAL proof, not the
    // generic "everything is blocked" message.
    const lines = captureLog();
    await batchApplyCommand(BATCH, { json: true }, { projectRoot });
    const out = lines.join('\n');
    expect(out).toContain('only');
    expect(out.toLowerCase()).toMatch(/proof-of-work failed|blocked by only/);
  });

  it('reaches `done` under `warn` even when the terminal proof fails', async () => {
    await writeManifest(singlePhase('exit 7', 'exit 0', 'warn'));
    await markDone('solo');

    captureLog();
    await batchApplyCommand(BATCH, { json: true }, { projectRoot });

    const rec = readLatestProofOfWork(projectRoot, BATCH, 'only');
    expect(rec!.passed).toBe(false);
    expect(rec!.gatePassed).toBe(true); // warn folds the failure into gatePassed

    const status = await computeBatchStatus(projectRoot, loadBatchManifest(projectRoot, BATCH));
    expect(status.status).toBe('done');
    expect(status.next).toBeUndefined();
  });
});
