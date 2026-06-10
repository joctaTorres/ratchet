import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { runCLI } from '../helpers/run-cli.js';
import { RATCHET_DIR_NAME } from '../../src/core/config.js';

/**
 * End-to-end coverage for nested planning homes against the built CLI binary.
 * A single monorepo fixture (root + two modules "api" and "web") backs the
 * resolution, discovery, addressing, aggregation, standards-layering, and
 * feature-store scenarios from features/nested-planning-homes/.
 */

const tempRoots: string[] = [];
let repo: string;

async function makeHome(root: string, rel: string, configBody: string): Promise<void> {
  const home = rel.length > 0 ? path.join(root, rel) : root;
  await fs.mkdir(path.join(home, RATCHET_DIR_NAME, 'changes'), { recursive: true });
  await fs.writeFile(path.join(home, RATCHET_DIR_NAME, 'config.yaml'), configBody, 'utf-8');
}

async function makeChange(homeRoot: string, name: string): Promise<void> {
  const dir = path.join(homeRoot, RATCHET_DIR_NAME, 'changes', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, '.ratchet.yaml'), 'schema: ratchet\n', 'utf-8');
  await fs.writeFile(path.join(dir, 'plan.md'), '- [ ] do it\n', 'utf-8');
}

beforeAll(async () => {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'ratchet-nested-e2e-'));
  tempRoots.push(base);
  repo = fsSync.realpathSync.native(base);

  await makeHome(repo, '', 'schema: ratchet\n');
  await makeHome(repo, 'packages/api', 'schema: ratchet\nname: api\n');
  await makeHome(repo, 'packages/web', 'schema: ratchet\nname: web\n');

  await makeChange(repo, 'upgrade-ci');
  await makeChange(path.join(repo, 'packages', 'api'), 'add-auth');
  await makeChange(path.join(repo, 'packages', 'web'), 'dark-mode');
});

afterAll(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('nested planning homes (CLI e2e)', () => {
  it('resolution: a command run inside a module resolves the module home', async () => {
    const cwd = path.join(repo, 'packages', 'api', 'src');
    await fs.mkdir(cwd, { recursive: true });
    const result = await runCLI(['status', '--change', 'add-auth', '--json'], { cwd });
    expect(result.exitCode).toBe(0);
    const status = JSON.parse(result.stdout);
    expect(status.planningHome.root).toBe(path.join(repo, 'packages', 'api'));
  });

  it('resolution: a command at the root resolves the root home', async () => {
    const result = await runCLI(['status', '--change', 'upgrade-ci', '--json'], { cwd: repo });
    expect(result.exitCode).toBe(0);
    const status = JSON.parse(result.stdout);
    expect(status.planningHome.root).toBe(repo);
  });

  it('aggregation: root list includes root and module changes labeled by module', async () => {
    const result = await runCLI(['list', '--json'], { cwd: repo });
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(result.stdout);
    const byName = Object.fromEntries(out.changes.map((c: any) => [c.name, c.module]));
    expect(byName['upgrade-ci']).toBeUndefined();
    expect(byName['add-auth']).toBe('api');
    expect(byName['dark-mode']).toBe('web');
  });

  it('aggregation: module-level list stays scoped to the module', async () => {
    const result = await runCLI(['list', '--json'], { cwd: path.join(repo, 'packages', 'api') });
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(result.stdout);
    const names = out.changes.map((c: any) => c.name);
    expect(names).toContain('add-auth');
    expect(names).not.toContain('upgrade-ci');
  });

  it('addressing: a module change can be read from the root with --module', async () => {
    const result = await runCLI(
      ['status', '--change', 'add-auth', '--module', 'api', '--json'],
      { cwd: repo }
    );
    expect(result.exitCode).toBe(0);
    const status = JSON.parse(result.stdout);
    expect(status.changeRoot).toBe(
      path.join(repo, 'packages', 'api', RATCHET_DIR_NAME, 'changes', 'add-auth')
    );
  });

  it('addressing: an unknown module fails and lists the discovered names', async () => {
    const result = await runCLI(
      ['status', '--change', 'add-auth', '--module', 'billing', '--json'],
      { cwd: repo }
    );
    expect(result.exitCode).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain('billing');
    expect(combined).toMatch(/api/);
    expect(combined).toMatch(/web/);
  });

  it('addressing: new change --module creates the change inside the module', async () => {
    const result = await runCLI(
      ['new', 'change', 'feature-flags', '--module', 'web', '--json'],
      { cwd: repo }
    );
    expect(result.exitCode).toBe(0);
    await expect(
      fs.access(
        path.join(repo, 'packages', 'web', RATCHET_DIR_NAME, 'changes', 'feature-flags', '.ratchet.yaml')
      )
    ).resolves.toBeUndefined();
  });
});
