import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import path from 'path';
import os from 'os';
import { ListCommand } from '../../src/core/list.js';
import { RATCHET_DIR_NAME } from '../../src/core/config.js';

let logOutput: string[];
let warnOutput: string[];
let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

async function makeHome(root: string, rel: string, configBody: string): Promise<void> {
  const home = rel.length > 0 ? path.join(root, rel) : root;
  await fs.mkdir(path.join(home, RATCHET_DIR_NAME, 'changes'), { recursive: true });
  await fs.writeFile(path.join(home, RATCHET_DIR_NAME, 'config.yaml'), configBody, 'utf-8');
}

async function makeChange(root: string, rel: string, name: string): Promise<void> {
  const home = rel.length > 0 ? path.join(root, rel) : root;
  const changeDir = path.join(home, RATCHET_DIR_NAME, 'changes', name);
  await fs.mkdir(changeDir, { recursive: true });
  await fs.writeFile(path.join(changeDir, 'plan.md'), '- [ ] do it\n', 'utf-8');
}

describe('root-level list aggregation', () => {
  let root: string;

  beforeEach(async () => {
    const made = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-list-agg-'));
    root = fsSync.realpathSync.native(made);
    logOutput = [];
    warnOutput = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => logOutput.push(a.join(' ')));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => warnOutput.push(a.join(' ')));
  });

  afterEach(async () => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('shows root and module changes labeled by module', async () => {
    await makeHome(root, '', 'schema: ratchet\n');
    await makeHome(root, 'packages/api', 'schema: ratchet\nname: api\n');
    await makeHome(root, 'packages/web', 'schema: ratchet\nname: web\n');
    await makeChange(root, '', 'upgrade-ci');
    await makeChange(root, 'packages/api', 'add-auth');
    await makeChange(root, 'packages/web', 'dark-mode');

    await new ListCommand().execute(root, 'changes', { json: true });
    const out = JSON.parse(logOutput.join('\n'));
    const byName = Object.fromEntries(out.changes.map((c: any) => [c.name, c.module]));

    expect(byName['upgrade-ci']).toBeUndefined(); // root: no module label
    expect(byName['add-auth']).toBe('api');
    expect(byName['dark-mode']).toBe('web');
  });

  it('keeps module-level list scoped to the module', async () => {
    await makeHome(root, '', 'schema: ratchet\n');
    await makeHome(root, 'packages/api', 'schema: ratchet\nname: api\n');
    await makeChange(root, '', 'upgrade-ci');
    await makeChange(root, 'packages/api', 'add-auth');

    await new ListCommand().execute(path.join(root, 'packages', 'api', 'src'), 'changes', { json: true });
    const out = JSON.parse(logOutput.join('\n'));
    const names = out.changes.map((c: any) => c.name);

    expect(names).toContain('add-auth');
    expect(names).not.toContain('upgrade-ci');
  });

  it('degrades a broken module config to a warning, not a failure', async () => {
    await makeHome(root, '', 'schema: ratchet\n');
    await makeHome(root, 'packages/api', 'schema: ratchet\nname: api\n');
    await makeHome(root, 'packages/web', 'schema: ratchet\nname: web\n');
    await makeChange(root, 'packages/web', 'dark-mode');
    // Corrupt api's config with unparseable YAML.
    await fs.writeFile(
      path.join(root, 'packages', 'api', RATCHET_DIR_NAME, 'config.yaml'),
      ': : : not valid yaml : :\n',
      'utf-8'
    );

    await expect(
      new ListCommand().execute(root, 'changes', { json: true })
    ).resolves.toBeUndefined();
    const out = JSON.parse(logOutput.join('\n'));
    const names = out.changes.map((c: any) => c.name);
    // The healthy module still shows up...
    expect(names).toContain('dark-mode');
    // ...and the broken module is surfaced as a warning.
    expect(warnOutput.some((w) => w.includes('packages/api') && w.includes('could not be loaded'))).toBe(true);
  });
});
