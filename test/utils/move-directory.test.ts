// Implements: .ratchet/changes/core-remainder-tests/features/core-remainder-tests/move-directory.feature
//
// Unit tests for src/utils/move-directory.ts: the rename fast-path plus the
// copy-then-remove fallback (EPERM / EXDEV) and the recursive directory copy.
// Filesystem tests are isolated under fs.mkdtemp(os.tmpdir()) and cleaned up in
// afterEach so no artifacts remain. The failing-rename seam is injected with
// vi.spyOn over the fs promises module and restored in afterEach.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  moveDirectory,
  copyDirRecursive,
} from '../../src/utils/move-directory.js';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-move-dir-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

/** Build a nested source tree and return its root path. */
async function buildNestedTree(root: string): Promise<void> {
  await fs.mkdir(path.join(root, 'sub', 'deep'), { recursive: true });
  await fs.writeFile(path.join(root, 'top.txt'), 'top');
  await fs.writeFile(path.join(root, 'sub', 'mid.txt'), 'mid');
  await fs.writeFile(path.join(root, 'sub', 'deep', 'leaf.txt'), 'leaf');
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

describe('moveDirectory', () => {
  it('uses the rename fast-path when rename succeeds', async () => {
    const src = path.join(tmpRoot, 'src');
    const dest = path.join(tmpRoot, 'dest');
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(path.join(src, 'a.txt'), 'hello');

    await moveDirectory(src, dest);

    expect(await fs.readFile(path.join(dest, 'a.txt'), 'utf8')).toBe('hello');
    expect(await exists(src)).toBe(false);
  });

  it('falls back to copy-then-remove on EPERM over a nested tree', async () => {
    const src = path.join(tmpRoot, 'src');
    const dest = path.join(tmpRoot, 'dest');
    await buildNestedTree(src);

    const renameSpy = vi
      .spyOn(fs, 'rename')
      .mockRejectedValueOnce(
        Object.assign(new Error('eperm'), { code: 'EPERM' })
      );

    await moveDirectory(src, dest);

    expect(renameSpy).toHaveBeenCalledTimes(1);
    // Destination is populated by the recursive copy.
    expect(await fs.readFile(path.join(dest, 'top.txt'), 'utf8')).toBe('top');
    expect(await fs.readFile(path.join(dest, 'sub', 'mid.txt'), 'utf8')).toBe(
      'mid'
    );
    expect(
      await fs.readFile(path.join(dest, 'sub', 'deep', 'leaf.txt'), 'utf8')
    ).toBe('leaf');
    // Source directory is removed afterwards.
    expect(await exists(src)).toBe(false);
  });

  it('falls back to copy-then-remove on EXDEV', async () => {
    const src = path.join(tmpRoot, 'src');
    const dest = path.join(tmpRoot, 'dest');
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(path.join(src, 'file.txt'), 'data');

    vi.spyOn(fs, 'rename').mockRejectedValueOnce(
      Object.assign(new Error('exdev'), { code: 'EXDEV' })
    );

    await moveDirectory(src, dest);

    expect(await fs.readFile(path.join(dest, 'file.txt'), 'utf8')).toBe('data');
    expect(await exists(src)).toBe(false);
  });

  it('rethrows any other rename error code', async () => {
    const src = path.join(tmpRoot, 'src');
    const dest = path.join(tmpRoot, 'dest');
    await fs.mkdir(src, { recursive: true });

    vi.spyOn(fs, 'rename').mockRejectedValueOnce(
      Object.assign(new Error('nope'), { code: 'ENOENT' })
    );

    await expect(moveDirectory(src, dest)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    // No fallback occurred: dest was never created.
    expect(await exists(dest)).toBe(false);
  });
});

describe('copyDirRecursive', () => {
  it('reproduces nested files and subdirectories under the destination', async () => {
    const src = path.join(tmpRoot, 'src');
    const dest = path.join(tmpRoot, 'dest');
    await buildNestedTree(src);

    await copyDirRecursive(src, dest);

    expect(await fs.readFile(path.join(dest, 'top.txt'), 'utf8')).toBe('top');
    expect(await fs.readFile(path.join(dest, 'sub', 'mid.txt'), 'utf8')).toBe(
      'mid'
    );
    expect(
      await fs.readFile(path.join(dest, 'sub', 'deep', 'leaf.txt'), 'utf8')
    ).toBe('leaf');
    // The directory structure itself is reproduced.
    expect((await fs.stat(path.join(dest, 'sub', 'deep'))).isDirectory()).toBe(
      true
    );
    // Source is left untouched (copy, not move).
    expect(await exists(src)).toBe(true);
  });
});
