import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, appendFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { appendJournal } from 'ratchet-ai';
import { readJournalTolerant } from '../../src/core/batch/engine/run-state.js';
import {
  acquireBatchLock,
  BatchLockedError,
} from '../../src/core/batch/engine/lock.js';

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-runstate-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'batches', 'b', 'run'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

describe('readJournalTolerant', () => {
  it('reconstructs complete entries and ignores a partial trailing entry', () => {
    appendJournal(projectRoot, 'b', { change: 'c', kind: 'progress', message: 'one' });
    appendJournal(projectRoot, 'b', { change: 'c', kind: 'completion', message: 'two', transition: 'apply' });

    // Simulate a crash mid-write: append a partial (unterminated) JSON line.
    const journalFile = path.join(projectRoot, '.ratchet', 'batches', 'b', 'run', 'journal.jsonl');
    appendFileSync(journalFile, '{"at":"2026-01-01","change":"c","kind":"prog');

    const entries = readJournalTolerant(projectRoot, 'b');
    expect(entries).toHaveLength(2);
    expect(entries[1].message).toBe('two');
  });

  it('returns empty for a missing journal', () => {
    expect(readJournalTolerant(projectRoot, 'nope')).toEqual([]);
  });
});

describe('per-batch single-flight lock', () => {
  it('refuses a second concurrent step for the same batch', () => {
    const lock = acquireBatchLock(projectRoot, 'b');
    try {
      expect(() => acquireBatchLock(projectRoot, 'b')).toThrow(BatchLockedError);
    } finally {
      lock.release();
    }
  });

  it('allows acquiring again after release', () => {
    const lock = acquireBatchLock(projectRoot, 'b');
    lock.release();
    const lock2 = acquireBatchLock(projectRoot, 'b');
    lock2.release();
    expect(true).toBe(true);
  });

  it('allows concurrent steps on different batches', async () => {
    await fs.mkdir(path.join(projectRoot, '.ratchet', 'batches', 'b2', 'run'), { recursive: true });
    const l1 = acquireBatchLock(projectRoot, 'b');
    const l2 = acquireBatchLock(projectRoot, 'b2');
    l1.release();
    l2.release();
    expect(true).toBe(true);
  });
});
