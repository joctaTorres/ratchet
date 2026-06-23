import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  computeNextTransition,
  readChangeDiskState,
} from '../../src/core/batch/engine/transition.js';
import type { JournalEntry } from 'ratchet-ai';

let projectRoot: string;
let changesDir: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-transition-'));
  changesDir = path.join(projectRoot, '.ratchet', 'changes');
  await fs.mkdir(changesDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

async function makeChange(name: string, plan?: string): Promise<void> {
  const dir = path.join(changesDir, name);
  await fs.mkdir(dir, { recursive: true });
  if (plan !== undefined) {
    await fs.writeFile(path.join(dir, 'plan.md'), plan, 'utf-8');
  }
}

describe('computeNextTransition', () => {
  it('returns propose when the change has no directory yet', () => {
    expect(computeNextTransition(projectRoot, 'add-login-api')).toBe('propose');
  });

  it('returns propose when the directory exists but has no plan', async () => {
    await makeChange('c');
    expect(computeNextTransition(projectRoot, 'c')).toBe('propose');
  });

  it('returns apply when a plan exists with unfinished tasks', async () => {
    await makeChange('c', '## Tasks\n- [ ] 1.1 do it\n- [ ] 1.2 more\n');
    expect(computeNextTransition(projectRoot, 'c')).toBe('apply');
  });

  it('returns verify when all plan tasks are checked and verify not yet completed', async () => {
    await makeChange('c', '## Tasks\n- [x] 1.1 done\n- [x] 1.2 done\n');
    expect(computeNextTransition(projectRoot, 'c')).toBe('verify');
  });

  it('returns undefined when verify has already completed', async () => {
    await makeChange('c', '## Tasks\n- [x] 1.1 done\n');
    const journal: JournalEntry[] = [
      { at: '2026-01-01T00:00:00Z', change: 'c', kind: 'completion', message: 'verified', transition: 'verify' },
    ];
    expect(computeNextTransition(projectRoot, 'c', journal)).toBeUndefined();
  });

  it('drives the canonical order propose -> apply -> verify across steps', async () => {
    // step 1: nothing on disk -> propose
    expect(computeNextTransition(projectRoot, 'c')).toBe('propose');
    // step 2: plan exists, tasks open -> apply
    await makeChange('c', '## Tasks\n- [ ] 1.1\n');
    expect(computeNextTransition(projectRoot, 'c')).toBe('apply');
    // step 3: tasks all done -> verify
    await fs.writeFile(path.join(changesDir, 'c', 'plan.md'), '## Tasks\n- [x] 1.1\n', 'utf-8');
    expect(computeNextTransition(projectRoot, 'c')).toBe('verify');
  });

  it('treats an archived change as nothing-to-do', async () => {
    await fs.mkdir(path.join(changesDir, 'archive', 'c'), { recursive: true });
    expect(computeNextTransition(projectRoot, 'c')).toBeUndefined();
    expect(readChangeDiskState(projectRoot, 'c').archived).toBe(true);
  });
});
