/**
 * Bundled-engine e2e: the execution engine ships INSIDE the CLI, so `batch apply`
 * runs it in-process with no separate install and no activation.
 *
 * The test scaffolds a batch with a ready change and runs `batch apply` against
 * the plain repo CLI (no install root, no linked engine package). To keep the
 * proof deterministic without depending on a real coding-agent binary, the batch
 * is configured to use an agent the engine does not recognize: the engine runs
 * in-process, reaches the ready change, computes its transition, and parks it as
 * blocked at adapter resolution (naming the available adapters) — never spawning
 * anything. That blocked outcome is proof the engine executed, with none of the
 * removed "engine is not installed / activate / license" gates in front of it.
 */

import { afterAll, describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { runCLI } from '../helpers/run-cli.js';

const tempRoots: string[] = [];

async function prepareProject(): Promise<string> {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'ratchet-bundled-engine-'));
  tempRoots.push(base);
  const projectDir = path.join(base, 'project');
  await fs.mkdir(path.join(projectDir, '.ratchet', 'changes'), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, '.ratchet', 'config.yaml'),
    'schema: ratchet\n',
    'utf-8'
  );
  return projectDir;
}

afterAll(async () => {
  await Promise.all(
    tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe('ratchet batch apply runs the bundled engine', () => {
  it('executes the engine in-process with no separate install or activation', async () => {
    const cwd = await prepareProject();

    const scaffold = await runCLI(['new', 'batch', 'q3-auth'], { cwd });
    expect(scaffold.exitCode).toBe(0);

    // Pin a recognizably-absent agent so the engine parks at adapter resolution
    // instead of spawning a real coding agent (deterministic in CI and locally).
    const cfg = await runCLI(
      ['batch', 'config', '--set', 'agent=no-such-agent'],
      { cwd }
    );
    expect(cfg.exitCode).toBe(0);

    const apply = await runCLI(['batch', 'apply', 'q3-auth'], { cwd });
    const out = `${apply.stdout}${apply.stderr}`;

    // The engine ran in-process: none of the removed install/activate/license
    // plumbing exists, so none of it can appear in the output.
    expect(out).not.toContain('engine is not installed');
    expect(out).not.toContain('not installed');
    expect(out).not.toContain('npm install -g @ratchet/batch-engine');
    expect(out).not.toContain('activate');
    expect(out.toLowerCase()).not.toContain('license');

    // The engine reached the ready change, computed its transition, and parked
    // it at adapter resolution — proof it executed in-process.
    expect(out).toContain('add-first-change');
    expect(out).toContain('propose');
    expect(out).toContain("Unknown agent adapter 'no-such-agent'");
  }, 30000);

  it('leaves status/view/list/config working alongside apply', async () => {
    const cwd = await prepareProject();
    await runCLI(['new', 'batch', 'q3-auth'], { cwd });

    for (const argv of [
      ['batch', 'status', 'q3-auth', '--json'],
      ['batch', 'view', 'q3-auth', '--json'],
      ['batch', 'list', '--json'],
      ['batch', 'config', '--json'],
    ]) {
      const r = await runCLI(argv, { cwd });
      expect(r.exitCode).toBe(0);
      expect(() => JSON.parse(r.stdout)).not.toThrow();
    }
  }, 30000);
});
