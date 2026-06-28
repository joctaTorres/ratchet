/**
 * `batch apply` executes and records the prior phase's proof-of-work at the
 * boundary (integration: real bash, real fixture batch).
 *
 * With phase 1 done and phase 2 holding an outstanding change, one `batch apply`
 * runs phase 1's CONFIGURED proof-of-work command in the project root via the
 * real bash runner and journals a `ProofOfWorkResult` (phase, passed, gatePassed,
 * policy, reason, detail). A passing command records `passed: true`; a failing
 * command records `passed: false` with a clear detail. A second apply does NOT
 * re-run the proof — it advances to phase 2's change instead.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  appendJournal,
  readLatestProofOfWork,
} from '../../src/core/batch/journal.js';
import { getBatchManifestPath } from '../../src/core/batch/manifest.js';
import { batchApplyCommand } from '../../src/commands/batch/apply.js';

let projectRoot: string;
const BATCH = 'powa';

/** Two-phase batch; phase 1's proof-of-work command is supplied per-test. */
function manifest(p1Run: string, p1Pass: string): string {
  return `
name: ${BATCH}
settings:
  agent: no-such-agent
phases:
  - name: p1
    goal: ship the first slice
    success: phase one succeeds
    proofOfWork: { kind: integration, run: "${p1Run}", pass: "${p1Pass}" }
    changes:
      - name: first
        done: first is done
  - name: p2
    goal: ship the second slice
    success: phase two succeeds
    proofOfWork: { kind: integration, run: x, pass: '0' }
    changes:
      - name: second
        done: second is done
`;
}

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

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'powa-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'changes'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'batches', BATCH), { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

async function writeManifest(content: string): Promise<void> {
  await fs.writeFile(getBatchManifestPath(projectRoot, BATCH), content, 'utf-8');
}

/**
 * Phase 1's change is marked done so phase 1 is `done` and phase 2 (which holds
 * an outstanding change) is ungated: the boundary into phase 2 triggers p1's
 * proof-of-work.
 */
async function apply(): Promise<void> {
  await batchApplyCommand(BATCH, { json: true }, { projectRoot });
}

describe('batch apply runs and records the boundary proof-of-work (real bash)', () => {
  it('runs a passing proof-of-work and journals passed true', async () => {
    await writeManifest(manifest('exit 0', 'exit 0'));
    await markDone('first');

    await apply();

    const rec = readLatestProofOfWork(projectRoot, BATCH, 'p1');
    expect(rec).toBeDefined();
    expect(rec!.phase).toBe('p1');
    expect(rec!.passed).toBe(true);
    expect(rec!.policy).toBe('hard-gate');
  });

  it('runs a failing proof-of-work and journals passed false with a clear detail', async () => {
    await writeManifest(manifest('exit 7', 'exit 0'));
    await markDone('first');

    await apply();

    const rec = readLatestProofOfWork(projectRoot, BATCH, 'p1');
    expect(rec).toBeDefined();
    expect(rec!.passed).toBe(false);
    expect(rec!.detail.length).toBeGreaterThan(0);
    expect(rec!.detail.toLowerCase()).toContain('fail');
  });

  it('does not re-run the proof on a second apply; it advances past the boundary', async () => {
    // A marker file the proof command would touch — proves it ran exactly once.
    const marker = path.join(projectRoot, 'ran.count');
    await writeManifest(manifest(`printf x >> '${marker}'`, 'exit 0'));
    await markDone('first');

    await apply();
    const afterFirst = await fs.readFile(marker, 'utf-8');
    expect(afterFirst).toBe('x'); // ran once

    // Second apply: proof already recorded for p1, so it must not run again.
    await apply();
    const afterSecond = await fs.readFile(marker, 'utf-8');
    expect(afterSecond).toBe('x'); // still ran exactly once

    // And the verdict survives across the two stateless invocations.
    expect(readLatestProofOfWork(projectRoot, BATCH, 'p1')!.passed).toBe(true);
  });
});
