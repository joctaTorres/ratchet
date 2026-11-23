/**
 * E2E: `ratchet instructions brainstorm --json` resolves the project's
 * `brainstorm.spikes` config into a `spikes.enabled` payload.
 *
 * Implements features/brainstorm/instructions-payload.feature.
 *
 * Drives the BUILT CLI over three fixtures — a project whose config sets
 * `brainstorm.spikes: true`, one that sets it to `false`, and a directory with
 * no ratchet planning root — asserting exit code 0 and the parsed
 * `spikes.enabled` value on stdout. The command requires no `--change` and no
 * ratchet root, and exits zero always.
 */

import { afterAll, describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { runCLI } from '../helpers/run-cli.js';

const tempRoots: string[] = [];

async function prepareProject(configBody: string | null): Promise<string> {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'ratchet-brainstorm-e2e-'));
  tempRoots.push(base);
  const projectDir = path.join(base, 'project');
  await fs.mkdir(projectDir, { recursive: true });
  if (configBody !== null) {
    await fs.mkdir(path.join(projectDir, '.ratchet'), { recursive: true });
    await fs.writeFile(path.join(projectDir, '.ratchet', 'config.yaml'), configBody, 'utf-8');
  }
  return projectDir;
}

afterAll(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('ratchet instructions brainstorm e2e', () => {
  it('reports spikes.enabled true when the project config sets brainstorm.spikes: true', async () => {
    const projectDir = await prepareProject('schema: ratchet\nbrainstorm:\n  spikes: true\n');

    const result = await runCLI(['instructions', 'brainstorm', '--json'], { cwd: projectDir });

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.spikes.enabled).toBe(true);
  });

  it('reports spikes.enabled false when the project config sets brainstorm.spikes: false', async () => {
    const projectDir = await prepareProject('schema: ratchet\nbrainstorm:\n  spikes: false\n');

    const result = await runCLI(['instructions', 'brainstorm', '--json'], { cwd: projectDir });

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.spikes.enabled).toBe(false);
  });

  it('reports spikes.enabled false with exit code 0 from a directory with no ratchet root', async () => {
    const projectDir = await prepareProject(null);

    const result = await runCLI(['instructions', 'brainstorm', '--json'], { cwd: projectDir });

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.spikes.enabled).toBe(false);
  });
});
