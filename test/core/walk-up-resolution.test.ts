import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import path from 'path';
import os from 'os';
import { ListCommand } from '../../src/core/list.js';
import { ViewCommand } from '../../src/core/view.js';
import { ArchiveCommand } from '../../src/core/archive.js';
import { RATCHET_DIR_NAME } from '../../src/core/config.js';

/**
 * Regression tests for task 1.1: list, view, and archive must resolve their
 * `.ratchet` by walking up from where they are invoked (nearest-wins), not by
 * joining `.ratchet` onto the current working directory. Running them from a
 * subdirectory must still operate on the repo-root planning home.
 */
describe('list/view/archive obey walk-up resolution', () => {
  let root: string;
  let subDir: string;
  let logOutput: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const made = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-walkup-'));
    // Resolve symlinks (macOS /var -> /private/var) so path assertions match.
    root = fsSync.realpathSync.native(made);
    subDir = path.join(root, 'packages', 'api', 'src');
    await fs.mkdir(subDir, { recursive: true });

    const changesDir = path.join(root, RATCHET_DIR_NAME, 'changes');
    await fs.mkdir(path.join(changesDir, 'root-change'), { recursive: true });
    await fs.writeFile(
      path.join(changesDir, 'root-change', 'plan.md'),
      '- [x] Task 1\n- [ ] Task 2\n',
      'utf-8'
    );

    logOutput = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logOutput.push(args.join(' '));
    });
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('list resolves the repo-root .ratchet from a subdirectory', async () => {
    await new ListCommand().execute(subDir, 'changes');
    expect(logOutput.some((line) => line.includes('root-change'))).toBe(true);
  });

  it('list does not read a non-existent .ratchet relative to the subdirectory', async () => {
    // There is no .ratchet under subDir; walk-up must find the root one and
    // succeed rather than throwing "No Ratchet changes directory found".
    await expect(new ListCommand().execute(subDir, 'changes')).resolves.toBeUndefined();
  });

  it('view resolves the repo-root .ratchet from a subdirectory', async () => {
    await new ViewCommand().execute(subDir);
    const output = logOutput.join('\n');
    expect(output).toContain('root-change');
  });

  it('archive resolves the repo-root .ratchet from a subdirectory', async () => {
    await new ArchiveCommand().execute('root-change', { yes: true, skipFeatures: true, cwd: subDir });
    const archiveDir = path.join(root, RATCHET_DIR_NAME, 'changes', 'archive');
    const archived = await fs.readdir(archiveDir);
    expect(archived.some((name) => name.endsWith('root-change'))).toBe(true);
    // Original change directory was moved out.
    await expect(
      fs.access(path.join(root, RATCHET_DIR_NAME, 'changes', 'root-change'))
    ).rejects.toThrow();
  });
});
