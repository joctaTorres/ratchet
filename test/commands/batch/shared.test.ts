import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { listBatchNames, resolveBatchName } from '../../../src/commands/batch/shared.js';

let projectRoot: string;
let batchesDir: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-shared-'));
  batchesDir = path.join(projectRoot, '.ratchet', 'batches');
  await fs.mkdir(batchesDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

/** Create an active batch with a manifest. */
async function makeBatch(name: string): Promise<void> {
  const dir = path.join(batchesDir, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'batch.yaml'), `name: ${name}\nphases: []\n`, 'utf-8');
}

/** Create an archived batch under batches/archive/<date>-<name>/. */
async function makeArchived(name: string): Promise<void> {
  const dir = path.join(batchesDir, 'archive', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'batch.yaml'), `name: ${name}\nphases: []\n`, 'utf-8');
}

describe('batch shared helpers exclude the archive directory', () => {
  it('listBatchNames omits the archive directory and its contents', async () => {
    await makeBatch('rex-agent-runtime');
    await makeArchived('2026-06-17-old-batch');

    const names = listBatchNames(projectRoot);
    expect(names).toContain('rex-agent-runtime');
    expect(names).not.toContain('old-batch');
    expect(names).not.toContain('2026-06-17-old-batch');
    expect(names).not.toContain('archive');
  });

  it('resolveBatchName never resolves to the archive directory', async () => {
    await makeBatch('rex-agent-runtime');
    await makeArchived('2026-06-17-old-batch');

    // With a single active batch and no name, it resolves to that batch — never
    // treating `archive` as the sole batch.
    expect(resolveBatchName(projectRoot, undefined)).toBe('rex-agent-runtime');
    // Asking for `archive` by name fails: it is not an active batch.
    expect(() => resolveBatchName(projectRoot, 'archive')).toThrow(/not found/i);
  });
});
