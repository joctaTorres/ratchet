import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FixtureManager } from '../../../src/core/eval/fixture.js';
import type { BashRunner } from '../../../src/core/batch/engine/index.js';

const roots: string[] = [];

function makeProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'eval-fix-'));
  roots.push(root);
  return root;
}

function writeFixture(root: string, name: string, files: Record<string, string>): void {
  const dir = path.join(root, '.ratchet', 'evals', 'fixtures', name);
  mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf-8');
  }
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe('FixtureManager', () => {
  it('materializes a fixture into an isolated working copy, not the source', () => {
    const root = makeProject();
    writeFixture(root, 'fx', { 'a.txt': 'hello' });
    const mgr = new FixtureManager(root);
    return mgr.materialize('fx').then((res) => {
      expect(res.fromCache).toBe(false);
      expect(readFileSync(path.join(res.cwd, 'a.txt'), 'utf-8')).toBe('hello');
      // Mutating the copy must not touch the checked-in fixture.
      writeFileSync(path.join(res.cwd, 'a.txt'), 'changed', 'utf-8');
      const src = path.join(root, '.ratchet', 'evals', 'fixtures', 'fx', 'a.txt');
      expect(readFileSync(src, 'utf-8')).toBe('hello');
    });
  });

  it('runs setup once and reuses the cached copy across cases', async () => {
    const root = makeProject();
    writeFixture(root, 'fx', { 'pkg.txt': '1' });
    const calls: string[] = [];
    const bash: BashRunner = async (command, cwd) => {
      calls.push(command);
      writeFileSync(path.join(cwd, 'installed.txt'), 'yes', 'utf-8');
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const mgr = new FixtureManager(root, { bash });

    const a = await mgr.materialize('fx', 'install');
    const b = await mgr.materialize('fx', 'install');

    // Setup ran exactly once even though two cases used the fixture.
    expect(calls).toEqual(['install']);
    expect(mgr.setupRunCount()).toBe(1);
    // Both copies carry the bootstrapped artifact and are distinct dirs.
    expect(existsSync(path.join(a.cwd, 'installed.txt'))).toBe(true);
    expect(existsSync(path.join(b.cwd, 'installed.txt'))).toBe(true);
    expect(a.cwd).not.toBe(b.cwd);
    expect(a.fromCache).toBe(true);
  });

  it('throws when setup fails', async () => {
    const root = makeProject();
    writeFixture(root, 'fx', { 'x.txt': '1' });
    const bash: BashRunner = async () => ({ exitCode: 1, stdout: '', stderr: 'boom' });
    const mgr = new FixtureManager(root, { bash });
    await expect(mgr.materialize('fx', 'install')).rejects.toThrow(/setup failed/i);
  });

  it('throws when the fixture is missing', async () => {
    const root = makeProject();
    const mgr = new FixtureManager(root);
    await expect(mgr.materialize('nope')).rejects.toThrow(/not found/i);
  });
});
