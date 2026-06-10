import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { runCLI } from '../helpers/run-cli.js';
import { RATCHET_DIR_NAME } from '../../src/core/config.js';

/**
 * Backward-compatibility guard: a repository with a single root `.ratchet`
 * must behave exactly as before — no module concept, no module-labeled output,
 * and no module-related warnings. These assertions pin the byte-level absence
 * of any nesting artifacts and the stable JSON shape for single-home repos.
 */

const tempRoots: string[] = [];
let repo: string;
let subDir: string;

beforeAll(async () => {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'ratchet-single-home-'));
  tempRoots.push(base);
  repo = fsSync.realpathSync.native(base);

  await fs.mkdir(path.join(repo, RATCHET_DIR_NAME, 'changes'), { recursive: true });
  await fs.writeFile(path.join(repo, RATCHET_DIR_NAME, 'config.yaml'), 'schema: ratchet\n', 'utf-8');

  const changeDir = path.join(repo, RATCHET_DIR_NAME, 'changes', 'only-change');
  await fs.mkdir(changeDir, { recursive: true });
  await fs.writeFile(path.join(changeDir, '.ratchet.yaml'), 'schema: ratchet\n', 'utf-8');
  await fs.writeFile(path.join(changeDir, 'plan.md'), '- [x] one\n- [ ] two\n', 'utf-8');

  subDir = path.join(repo, 'src', 'deep');
  await fs.mkdir(subDir, { recursive: true });
});

afterAll(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('single-home repo backward compatibility (CLI e2e)', () => {
  it('list --json carries no module field and a stable shape', async () => {
    const result = await runCLI(['list', '--json'], { cwd: repo });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');

    const out = JSON.parse(result.stdout);
    expect(out.changes).toHaveLength(1);
    const change = out.changes[0];
    expect(change).toEqual({
      name: 'only-change',
      completedTasks: 1,
      totalTasks: 2,
      lastModified: change.lastModified, // timestamp varies; shape is what matters
      status: 'in-progress',
    });
    // No module key whatsoever.
    expect('module' in change).toBe(false);
    expect(result.stdout).not.toContain('module');
  });

  it('list (human) shows no module labels or warnings', async () => {
    const result = await runCLI(['list'], { cwd: repo });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('only-change');
    // No bracketed module label and no warning text.
    expect(result.stdout).not.toMatch(/\[[^\]]+\]/);
    expect(result.stdout.toLowerCase()).not.toContain('module');
    expect(result.stdout.toLowerCase()).not.toContain('warning');
  });

  it('list run from a subdirectory resolves the root home with no warnings', async () => {
    const fromRoot = await runCLI(['list', '--json'], { cwd: repo });
    const fromSub = await runCLI(['list', '--json'], { cwd: subDir });
    expect(fromSub.exitCode).toBe(0);
    expect(fromSub.stderr).toBe('');
    // Byte-identical change listing regardless of where it is invoked.
    const norm = (s: string) =>
      JSON.stringify(JSON.parse(s).changes.map((c: any) => ({ ...c, lastModified: '<ts>' })));
    expect(norm(fromSub.stdout)).toBe(norm(fromRoot.stdout));
  });

  it('status --json reports a repo planning home with no module fields', async () => {
    const result = await runCLI(['status', '--change', 'only-change', '--json'], { cwd: repo });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const status = JSON.parse(result.stdout);
    expect(status.planningHome.kind).toBe('repo');
    expect(status.planningHome.root).toBe(repo);
    expect('moduleName' in status.planningHome).toBe(false);
    expect('module' in status.planningHome).toBe(false);
    expect('parent' in status.planningHome).toBe(false);
    expect(result.stdout.toLowerCase()).not.toContain('module');
  });
});
