/**
 * Engine-PRESENT e2e: drives the licensed engine through the CLI bootstrap.
 *
 * The bulk of the batch e2e suite exercises the engine-ABSENT path (the open
 * commands working without the licensed package). This test closes the opposite
 * gap: it makes `@ratchet/batch-engine` resolvable to the CLI — WITHOUT making it
 * a declared dependency of the open CLI — and proves the whole seam works end to
 * end: dynamic import -> self-registration -> `loadBatchEngine()` -> `runStep`.
 *
 * The engine is present but UNLICENSED here, so `runStep` refuses at the license
 * check before spawning any coding-agent subprocess. That license-absent refusal
 * is the safe stopping point that proves bootstrap + registration + the engine's
 * `runStep` entry all fire, with no real agent ever spawned.
 */

import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { createEngineInstall, type EngineInstall } from '../helpers/engine-install.js';

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function run(cliEntry: string, args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      cwd,
      env: { ...process.env, OPEN_SPEC_INTERACTIVE: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) => resolve({ exitCode: code, stdout, stderr }));
  });
}

const tempRoots: string[] = [];
let install: EngineInstall;

async function prepareProject(): Promise<string> {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'ratchet-engine-present-'));
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

beforeAll(async () => {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'ratchet-engine-install-'));
  tempRoots.push(base);
  install = await createEngineInstall(base);
}, 60000);

afterAll(async () => {
  if (install) await install.cleanup();
  await Promise.all(
    tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe('ratchet batch apply with the engine present', () => {
  it('reaches the engine and stops at the license check (present but unlicensed)', async () => {
    const cwd = await prepareProject();

    // Scaffold a batch with a foundation phase + a ready change intent.
    const scaffold = await run(install.cliEntry, ['new', 'batch', 'q3-auth'], cwd);
    expect(scaffold.exitCode).toBe(0);

    // Drive the engine-present path. The engine self-registers on import; runStep
    // runs and refuses at the license gate BEFORE spawning any agent.
    const apply = await run(
      install.cliEntry,
      ['batch', 'apply', 'q3-auth'],
      cwd
    );
    const out = `${apply.stdout}${apply.stderr}`;

    // It must NOT report the engine as absent — bootstrap + registration worked.
    expect(out).not.toContain('engine is not installed');
    expect(out).not.toContain('npm install -g @ratchet/batch-engine');

    // It must stop at the license check: engine present, but unlicensed.
    expect(out.toLowerCase()).toContain('license');
    expect(out).toContain('A valid license is required to run the batch engine');
    // The licensed transition reached runStep for the ready change.
    expect(out).toContain('add-first-change');
  }, 30000);

  it('still reports the engine ABSENT when it is not linked (default holds)', async () => {
    // Run the SAME built CLI from the repo checkout (no engine in scope). This is
    // the resolvable-engine install's negative control: the open CLI's dynamic
    // import finds nothing, so engine-absent stays first-class.
    const cwd = await prepareProject();
    const { cliProjectRoot } = await import('../helpers/run-cli.js');
    const realRepoCli = path.join(cliProjectRoot, 'bin', 'ratchet.js');

    const scaffold = await run(realRepoCli, ['new', 'batch', 'q3-auth'], cwd);
    expect(scaffold.exitCode).toBe(0);

    const apply = await run(realRepoCli, ['batch', 'apply', 'q3-auth'], cwd);
    const out = `${apply.stdout}${apply.stderr}`;
    expect(out.toLowerCase()).toContain('engine');
    expect(out).toContain('not installed');
  }, 30000);

  it('self-registers on import: loadBatchEngine() is absent before and ok after', async () => {
    // Run in a CLEAN child process so module-level registry state is pristine.
    // This proves the engine genuinely self-registers via the built artifact, and
    // that engine-absent is the honest default before any import (no anomaly).
    const { cliProjectRoot } = await import('../helpers/run-cli.js');
    const cliDist = path
      .join(cliProjectRoot, 'dist', 'index.js')
      .replace(/\\/g, '/');
    const engineDist = path
      .join(cliProjectRoot, 'packages', 'batch-engine', 'dist', 'index.js')
      .replace(/\\/g, '/');

    const script = [
      `const { loadBatchEngine } = await import(${JSON.stringify(`file://${cliDist}`)});`,
      `process.stdout.write('before=' + loadBatchEngine().status + '\\n');`,
      `await import(${JSON.stringify(`file://${engineDist}`)});`,
      `process.stdout.write('after=' + loadBatchEngine().status + '\\n');`,
    ].join('\n');

    const result = await new Promise<{ stdout: string; code: number | null }>(
      (resolve, reject) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
          cwd: cliProjectRoot,
          stdio: ['ignore', 'pipe', 'inherit'],
        });
        let stdout = '';
        child.stdout.setEncoding('utf-8');
        child.stdout.on('data', (c) => (stdout += c));
        child.on('error', reject);
        child.on('close', (code) => resolve({ stdout, code }));
      }
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('before=absent');
    expect(result.stdout).toContain('after=ok');
  }, 30000);
});
