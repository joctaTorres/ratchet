import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { discoverModules } from '../../src/core/module-discovery.js';
import { resolveCurrentPlanningHomeSync } from '../../src/core/planning-home.js';
import { RATCHET_DIR_NAME } from '../../src/core/config.js';

const tempDirs: string[] = [];

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-discover-'));
  tempDirs.push(dir);
  return fs.realpathSync.native(dir);
}

function mkRatchet(root: string, rel: string, configBody?: string): void {
  const moduleRoot = rel.length > 0 ? path.join(root, rel) : root;
  fs.mkdirSync(path.join(moduleRoot, RATCHET_DIR_NAME, 'changes'), { recursive: true });
  if (configBody !== undefined) {
    fs.writeFileSync(path.join(moduleRoot, RATCHET_DIR_NAME, 'config.yaml'), configBody, 'utf-8');
  }
}

function rootHomeOf(root: string) {
  return resolveCurrentPlanningHomeSync({ startPath: root, allowImplicitRepoRoot: false });
}

describe('discoverModules', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('discovers nested .ratchet directories by filesystem scan', async () => {
    const root = makeRepo();
    mkRatchet(root, '');
    mkRatchet(root, 'packages/api');
    mkRatchet(root, 'packages/web');

    const modules = await discoverModules(rootHomeOf(root));

    expect(modules.map((m) => m.moduleName)).toEqual(['packages/api', 'packages/web']);
    expect(modules[0].home.root).toBe(path.join(root, 'packages', 'api'));
  });

  it('defaults the module name to the path relative to the root', async () => {
    const root = makeRepo();
    mkRatchet(root, '');
    mkRatchet(root, 'packages/api');

    const [mod] = await discoverModules(rootHomeOf(root));
    expect(mod.moduleName).toBe('packages/api');
    expect(mod.relativePath).toBe('packages/api');
  });

  it('honors a module name override from its config', async () => {
    const root = makeRepo();
    mkRatchet(root, '');
    mkRatchet(root, 'packages/api', 'schema: ratchet\nname: api\n');

    const [mod] = await discoverModules(rootHomeOf(root));
    expect(mod.moduleName).toBe('api');
    expect(mod.relativePath).toBe('packages/api');
  });

  it('does not descend past a found module or into ignored directories', async () => {
    const root = makeRepo();
    mkRatchet(root, '');
    mkRatchet(root, 'packages/api');
    // Nested home below a found module — must not be reported separately.
    mkRatchet(root, 'packages/api/sub');
    // Stray .ratchet inside node_modules — must be ignored.
    mkRatchet(root, 'node_modules/dep');

    const modules = await discoverModules(rootHomeOf(root));
    const names = modules.map((m) => m.moduleName);

    expect(names).toContain('packages/api');
    expect(names).not.toContain('packages/api/sub');
    expect(names.some((n) => n.includes('node_modules'))).toBe(false);
  });

  it('skips gitignored directories', async () => {
    const root = makeRepo();
    mkRatchet(root, '');
    mkRatchet(root, 'packages/api');
    mkRatchet(root, 'build/generated');
    fs.writeFileSync(path.join(root, '.gitignore'), 'build/\n', 'utf-8');

    const names = (await discoverModules(rootHomeOf(root))).map((m) => m.moduleName);
    expect(names).toEqual(['packages/api']);
  });

  it('errors on duplicate module names', async () => {
    const root = makeRepo();
    mkRatchet(root, '');
    mkRatchet(root, 'packages/api', 'schema: ratchet\nname: shared\n');
    mkRatchet(root, 'packages/web', 'schema: ratchet\nname: shared\n');

    await expect(discoverModules(rootHomeOf(root))).rejects.toThrow(/Duplicate module name 'shared'/);
  });

  it('returns no modules for a single-home repo', async () => {
    const root = makeRepo();
    mkRatchet(root, '');

    const modules = await discoverModules(rootHomeOf(root));
    expect(modules).toEqual([]);
  });
});
