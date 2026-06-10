import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  appendJournal,
  readJournalForChange,
  parkStep,
  getParkedStep,
  recordAnswer,
  recordReject,
  recordApproval,
} from '../../../src/core/batch/journal.js';

let projectRoot: string;
const BATCH = 'q3-auth';

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-journal-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet', 'batches', BATCH), { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

describe('run journal', () => {
  it('appends progress entries scoped to a change', () => {
    appendJournal(projectRoot, BATCH, { change: 'c1', kind: 'progress', message: 'drafted 2/4' });
    appendJournal(projectRoot, BATCH, { change: 'c2', kind: 'progress', message: 'other' });
    const entries = readJournalForChange(projectRoot, BATCH, 'c1');
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('drafted 2/4');
  });

  it('parks a step as blocked and resumes with a recorded answer', () => {
    parkStep(projectRoot, BATCH, { change: 'c1', kind: 'blocked', reason: 'cookie or header?' });
    let parked = getParkedStep(projectRoot, BATCH, 'c1');
    expect(parked?.kind).toBe('blocked');
    expect(parked?.answer).toBeUndefined();

    recordAnswer(projectRoot, BATCH, 'c1', 'use header sessions');
    parked = getParkedStep(projectRoot, BATCH, 'c1');
    expect(parked?.answer).toBe('use header sessions');
  });

  it('records reject-with-feedback on an awaiting-approval step', () => {
    parkStep(projectRoot, BATCH, { change: 'c1', kind: 'awaiting-approval', reason: 'draft ready' });
    recordReject(projectRoot, BATCH, 'c1', 'tighten the API surface');
    const parked = getParkedStep(projectRoot, BATCH, 'c1');
    expect(parked?.feedback).toBe('tighten the API surface');
    expect(parked?.approved).toBe(false);
  });

  it('clears a parked step on approval', () => {
    parkStep(projectRoot, BATCH, { change: 'c1', kind: 'awaiting-approval', reason: 'draft ready' });
    recordApproval(projectRoot, BATCH, 'c1');
    expect(getParkedStep(projectRoot, BATCH, 'c1')).toBeUndefined();
  });
});
