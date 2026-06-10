import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import path from 'path';
import os from 'os';
import { ArchiveCommand } from '../../src/core/archive.js';
import { RATCHET_DIR_NAME } from '../../src/core/config.js';

const FEATURE = `Feature: Login
  Scenario: ok
    Given a user
    When they log in
    Then they are in
`;

async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf-8');
}

async function makeHome(root: string, rel: string, configBody: string): Promise<void> {
  const home = rel.length > 0 ? path.join(root, rel) : root;
  await fs.mkdir(path.join(home, RATCHET_DIR_NAME, 'changes'), { recursive: true });
  await fs.writeFile(path.join(home, RATCHET_DIR_NAME, 'config.yaml'), configBody, 'utf-8');
}

async function scaffoldChange(homeRoot: string, name: string, rel: string): Promise<void> {
  const changeDir = path.join(homeRoot, RATCHET_DIR_NAME, 'changes', name);
  await writeFile(path.join(changeDir, '.ratchet.yaml'), 'schema: ratchet\n');
  await writeFile(path.join(changeDir, 'features', rel), FEATURE);
  await writeFile(path.join(changeDir, 'plan.md'), '- [x] done\n');
}

describe('module-local feature stores on archive', () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const made = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-mod-store-'));
    root = fsSync.realpathSync.native(made);
    await makeHome(root, '', 'schema: ratchet\n');
    await makeHome(root, 'packages/api', 'schema: ratchet\nname: api\n');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('archives a module change into the module store, leaving the root store untouched', async () => {
    const moduleRoot = path.join(root, 'packages', 'api');
    await scaffoldChange(moduleRoot, 'add-auth', 'auth/login.feature');

    await new ArchiveCommand().execute('add-auth', { yes: true, module: 'api', cwd: root });

    // Feature materialized into the module store.
    await expect(
      fs.access(path.join(moduleRoot, RATCHET_DIR_NAME, 'features', 'auth', 'login.feature'))
    ).resolves.toBeUndefined();

    // Root store does not contain it.
    await expect(
      fs.access(path.join(root, RATCHET_DIR_NAME, 'features', 'auth', 'login.feature'))
    ).rejects.toThrow();

    // Change moved to the module's archive dir.
    const archiveDir = path.join(moduleRoot, RATCHET_DIR_NAME, 'changes', 'archive');
    const archived = await fs.readdir(archiveDir);
    expect(archived.some((n) => n.endsWith('add-auth'))).toBe(true);
  });

  it('archives a root change into the root store, leaving module stores untouched', async () => {
    await scaffoldChange(root, 'upgrade-ci', 'ci/pipeline.feature');

    await new ArchiveCommand().execute('upgrade-ci', { yes: true, cwd: root });

    await expect(
      fs.access(path.join(root, RATCHET_DIR_NAME, 'features', 'ci', 'pipeline.feature'))
    ).resolves.toBeUndefined();

    // No module feature store was created.
    await expect(
      fs.access(path.join(root, 'packages', 'api', RATCHET_DIR_NAME, 'features'))
    ).rejects.toThrow();
  });
});
