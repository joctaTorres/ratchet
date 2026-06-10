import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import path from 'path';
import os from 'os';
import { newChangeCommand } from '../../src/commands/workflow/new-change.js';
import { statusCommand } from '../../src/commands/workflow/status.js';
import { RATCHET_DIR_NAME } from '../../src/core/config.js';

async function captureLog(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return lines.join('\n');
}

async function captureJson(fn: () => Promise<void>): Promise<any> {
  const out = await captureLog(fn);
  const start = out.indexOf('{');
  expect(start).toBeGreaterThanOrEqual(0);
  return JSON.parse(out.slice(start));
}

/** Scaffold a `.ratchet` home with config at `<root>/<rel>`. */
async function makeHome(root: string, rel: string, configBody: string): Promise<void> {
  const home = rel.length > 0 ? path.join(root, rel) : root;
  await fs.mkdir(path.join(home, RATCHET_DIR_NAME, 'changes'), { recursive: true });
  await fs.writeFile(path.join(home, RATCHET_DIR_NAME, 'config.yaml'), configBody, 'utf-8');
}

describe('--module addressing from the root', () => {
  let root: string;
  let cwd: string;

  beforeEach(async () => {
    const made = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-module-addr-'));
    root = fsSync.realpathSync.native(made);
    await makeHome(root, '', 'schema: ratchet\n');
    await makeHome(root, 'packages/api', 'schema: ratchet\nname: api\n');
    cwd = process.cwd();
    process.chdir(root);
  });

  afterEach(async () => {
    process.chdir(cwd);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('creates a change inside a module from the root', async () => {
    await captureLog(() => newChangeCommand('add-auth', { json: true, module: 'api' }));
    const changeDir = path.join(root, 'packages', 'api', RATCHET_DIR_NAME, 'changes', 'add-auth');
    await expect(fs.access(path.join(changeDir, '.ratchet.yaml'))).resolves.toBeUndefined();
  });

  it('reports status of a module change with the module planning home', async () => {
    await captureLog(() => newChangeCommand('add-auth', { json: true, module: 'api' }));
    const status = await captureJson(() =>
      statusCommand({ change: 'add-auth', json: true, module: 'api' })
    );
    expect(status.planningHome.root).toBe(path.join(root, 'packages', 'api'));
    expect(status.changeRoot).toBe(
      path.join(root, 'packages', 'api', RATCHET_DIR_NAME, 'changes', 'add-auth')
    );
  });

  it('fails for an unknown module, listing the discovered names', async () => {
    await expect(
      statusCommand({ change: 'add-auth', json: true, module: 'billing' })
    ).rejects.toThrow(/Unknown module 'billing'.*api/s);
  });

  it('omitting --module keeps nearest-wins behavior at the root', async () => {
    await captureLog(() => newChangeCommand('root-change', { json: true }));
    const status = await captureJson(() => statusCommand({ change: 'root-change', json: true }));
    expect(status.planningHome.root).toBe(root);
  });
});
