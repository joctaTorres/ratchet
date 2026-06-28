/**
 * Behavioral tests for `ratchet batch rerun-proof [name] --phase <phase>`.
 *
 * The verb is the supported replacement for hand-editing the append-only run
 * journal: it appends a superseding `proof-of-work-invalidated` marker for a
 * phase so the next `batch apply` re-runs that phase's configured boundary
 * proof-of-work. These tests run against a real tmp project so the journal
 * append/no-op and the manifest-validated phase check are exercised end to end.
 *
 * Covers features/rerun-recorded-proof/cli-surface.feature.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  recordProofOfWork,
  readJournal,
  readProofOfWorkByPhase,
  type ProofOfWorkRecord,
} from '../../../src/core/batch/journal.js';
import { getBatchManifestPath } from '../../../src/core/batch/manifest.js';
import { batchRerunProofCommand } from '../../../src/commands/batch/rerun-proof.js';

let projectRoot: string;
const BATCH = 'demo';

const MANIFEST = `
name: ${BATCH}
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

function record(over: Partial<ProofOfWorkRecord> = {}): ProofOfWorkRecord {
  return {
    phase: 'p1',
    passed: false,
    gatePassed: false,
    policy: 'hard-gate',
    reason: 'nonzero-exit',
    detail: 'command exited 7',
    ...over,
  };
}

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rerun-proof-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'batches', BATCH, 'run'), {
    recursive: true,
  });
  await fs.writeFile(getBatchManifestPath(projectRoot, BATCH), MANIFEST, 'utf-8');
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function captureLog(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => {
    lines.push(args.join(' '));
  });
  return lines;
}

describe('batchRerunProofCommand', () => {
  it('invalidates a recorded failing proof by appending a marker and reports success', async () => {
    recordProofOfWork(projectRoot, BATCH, 'p1', record());
    const before = readJournal(projectRoot, BATCH);

    const lines = captureLog();
    await batchRerunProofCommand(BATCH, { phase: 'p1' }, { projectRoot });

    const after = readJournal(projectRoot, BATCH);
    // Append-only: a new invalidation entry was added; the original proof entry
    // is left untouched.
    expect(after.length).toBe(before.length + 1);
    expect(after[after.length - 1].kind).toBe('proof-of-work-invalidated');
    expect(after.some((e) => e.kind === 'proof-of-work')).toBe(true);
    // The phase drops out of the folded record map -> the boundary will re-run.
    expect(readProofOfWorkByPhase(projectRoot, BATCH).has('p1')).toBe(false);
    expect(lines.join('\n')).toMatch(/p1/);
    expect(lines.join('\n')).toMatch(/invalidat/i);
  });

  it('invalidates a recorded passing proof too (force a fresh run)', async () => {
    recordProofOfWork(projectRoot, BATCH, 'p1', record({ passed: true, gatePassed: true }));
    captureLog();
    await batchRerunProofCommand(BATCH, { phase: 'p1' }, { projectRoot });
    expect(readProofOfWorkByPhase(projectRoot, BATCH).has('p1')).toBe(false);
  });

  it('errors on a missing --phase flag and appends nothing', async () => {
    recordProofOfWork(projectRoot, BATCH, 'p1', record());
    const before = readJournal(projectRoot, BATCH);
    await expect(
      batchRerunProofCommand(BATCH, {}, { projectRoot })
    ).rejects.toThrow(/--phase/);
    expect(readJournal(projectRoot, BATCH).length).toBe(before.length);
  });

  it('errors on an unknown phase and appends nothing', async () => {
    recordProofOfWork(projectRoot, BATCH, 'p1', record());
    const before = readJournal(projectRoot, BATCH);
    await expect(
      batchRerunProofCommand(BATCH, { phase: 'ghost' }, { projectRoot })
    ).rejects.toThrow(/ghost/);
    expect(readJournal(projectRoot, BATCH).length).toBe(before.length);
  });

  it('is a no-op that says so when no proof is recorded for the phase', async () => {
    const before = readJournal(projectRoot, BATCH);
    const lines = captureLog();
    await batchRerunProofCommand(BATCH, { phase: 'p1' }, { projectRoot });
    // Journal unchanged.
    expect(readJournal(projectRoot, BATCH).length).toBe(before.length);
    expect(lines.join('\n')).toMatch(/no recorded proof/i);
  });

  it('resolves the batch name when omitted (sole batch)', async () => {
    recordProofOfWork(projectRoot, BATCH, 'p1', record());
    captureLog();
    await batchRerunProofCommand(undefined, { phase: 'p1' }, { projectRoot });
    expect(readProofOfWorkByPhase(projectRoot, BATCH).has('p1')).toBe(false);
  });

  it('emits a JSON object naming the batch, phase, and whether a proof was invalidated', async () => {
    recordProofOfWork(projectRoot, BATCH, 'p1', record());
    const lines = captureLog();
    await batchRerunProofCommand(BATCH, { phase: 'p1', json: true }, { projectRoot });
    const parsed = JSON.parse(lines.join('\n')) as {
      batch: string;
      phase: string;
      invalidated: boolean;
    };
    expect(parsed).toMatchObject({ batch: 'demo', phase: 'p1', invalidated: true });
  });

  it('JSON output reports invalidated:false on a no-op', async () => {
    const lines = captureLog();
    await batchRerunProofCommand(BATCH, { phase: 'p1', json: true }, { projectRoot });
    const parsed = JSON.parse(lines.join('\n')) as { invalidated: boolean };
    expect(parsed.invalidated).toBe(false);
  });
});
