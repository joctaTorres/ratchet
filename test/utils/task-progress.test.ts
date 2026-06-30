/**
 * Tests for src/utils/task-progress.ts.
 *
 * Implements features/utils-helper-tests/task-progress.feature. The pure
 * helpers `countTasksFromContent` and `formatTaskStatus` get unit tests over
 * in-memory inputs (no filesystem, no spawn). The one filesystem-reading
 * helper, `getTaskProgressForChange`, is exercised over an isolated
 * fs.mkdtemp(os.tmpdir()) change dir built per scenario and removed in
 * afterEach, so the real readFile/count logic runs unmocked against the
 * fixture.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  countTasksFromContent,
  getTaskProgressForChange,
  formatTaskStatus,
} from '../../src/utils/task-progress.js';

describe('countTasksFromContent', () => {
  it('tallies total and completed checklist items', () => {
    const content = ['- [x] 1.1 done', '- [ ] 1.2 todo', '- [ ] 1.3 todo'].join('\n');
    expect(countTasksFromContent(content)).toEqual({ total: 3, completed: 1 });
  });

  it('recognizes both bullet styles and case-insensitive completion marks', () => {
    const content = ['- [x] dash lower', '* [X] star upper', '- [ ] dash open', '* [ ] star open'].join('\n');
    expect(countTasksFromContent(content)).toEqual({ total: 4, completed: 2 });
  });

  it('ignores non-task lines', () => {
    const content = ['# Heading', 'Some prose describing the change.', '', '- a plain bullet', '1. numbered item'].join('\n');
    expect(countTasksFromContent(content)).toEqual({ total: 0, completed: 0 });
  });
});

describe('getTaskProgressForChange', () => {
  let changesDir: string;

  beforeEach(() => {
    changesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-task-progress-'));
  });

  afterEach(() => {
    fs.rmSync(changesDir, { recursive: true, force: true });
  });

  it("counts tasks from a change's plan.md", async () => {
    const changeDir = path.join(changesDir, 'my-change');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, 'plan.md'), ['- [x] 1.1 done', '- [ ] 1.2 todo'].join('\n'), 'utf-8');

    expect(await getTaskProgressForChange(changesDir, 'my-change')).toEqual({ total: 2, completed: 1 });
  });

  it('returns zero progress when plan.md is missing', async () => {
    fs.mkdirSync(path.join(changesDir, 'no-plan'), { recursive: true });
    expect(await getTaskProgressForChange(changesDir, 'no-plan')).toEqual({ total: 0, completed: 0 });
  });
});

describe('formatTaskStatus', () => {
  it('reports "No tasks" when the total is zero', () => {
    expect(formatTaskStatus({ total: 0, completed: 0 })).toBe('No tasks');
  });

  it('reports completion when all tasks are done', () => {
    expect(formatTaskStatus({ total: 3, completed: 3 })).toBe('✓ Complete');
  });

  it('reports the remaining tally otherwise', () => {
    expect(formatTaskStatus({ total: 3, completed: 1 })).toBe('1/3 tasks');
  });
});
