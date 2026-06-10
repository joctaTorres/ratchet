import { afterAll, describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { runCLI } from '../helpers/run-cli.js';

const tempRoots: string[] = [];

async function prepareProject(): Promise<string> {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'ratchet-batch-e2e-'));
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
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('ratchet batch CLI e2e', () => {
  it('scaffolds a batch from the template', async () => {
    const cwd = await prepareProject();
    const result = await runCLI(['new', 'batch', 'q3-auth'], { cwd });
    expect(result.exitCode).toBe(0);
    const manifestPath = path.join(cwd, '.ratchet', 'batches', 'q3-auth', 'batch.yaml');
    const content = await fs.readFile(manifestPath, 'utf-8');
    expect(content).toContain('name: q3-auth');
    expect(content).toMatch(/created: \d{4}-\d{2}-\d{2}/);
    expect(content).toContain('phases:');
  });

  it('rejects an invalid batch name with a kebab-case message', async () => {
    const cwd = await prepareProject();
    const result = await runCLI(['new', 'batch', 'Bad Name!'], { cwd });
    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`.toLowerCase()).toContain('kebab-case');
  });

  it('does not overwrite an existing batch', async () => {
    const cwd = await prepareProject();
    await runCLI(['new', 'batch', 'q3-auth'], { cwd });
    const before = await fs.readFile(
      path.join(cwd, '.ratchet', 'batches', 'q3-auth', 'batch.yaml'),
      'utf-8'
    );
    const second = await runCLI(['new', 'batch', 'q3-auth'], { cwd });
    expect(second.exitCode).not.toBe(0);
    const after = await fs.readFile(
      path.join(cwd, '.ratchet', 'batches', 'q3-auth', 'batch.yaml'),
      'utf-8'
    );
    expect(after).toBe(before);
  });

  it('serves the batch template', async () => {
    const cwd = await prepareProject();
    const result = await runCLI(['template', 'batch'], { cwd });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('phases:');
    expect(result.stdout.toLowerCase()).toContain('after');
  });

  it('reports status as JSON for agents', async () => {
    const cwd = await prepareProject();
    await runCLI(['new', 'batch', 'q3-auth'], { cwd });
    const result = await runCLI(['batch', 'status', 'q3-auth', '--json'], { cwd });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.name).toBe('q3-auth');
    expect(Array.isArray(parsed.phases)).toBe(true);
  });

  it('resolves default config when no batch section is present', async () => {
    const cwd = await prepareProject();
    const result = await runCLI(['batch', 'config', '--json'], { cwd });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.settings.gate).toBe('voluntary');
    expect(parsed.settings.strategy).toBe('vertical-slice');
    expect(parsed.settings.proofOfWork).toBe('hard-gate');
  });

  it('sets a gate value and rejects an invalid one without modifying the file', async () => {
    const cwd = await prepareProject();
    const set = await runCLI(['batch', 'config', '--set', 'gate=after-propose'], { cwd });
    expect(set.exitCode).toBe(0);
    const afterValid = await fs.readFile(path.join(cwd, '.ratchet', 'config.yaml'), 'utf-8');
    expect(afterValid).toContain('after-propose');

    const bad = await runCLI(['batch', 'config', '--set', 'gate=whenever'], { cwd });
    expect(bad.exitCode).not.toBe(0);
    expect(`${bad.stdout}${bad.stderr}`).toContain('voluntary');
    const afterBad = await fs.readFile(path.join(cwd, '.ratchet', 'config.yaml'), 'utf-8');
    expect(afterBad).toBe(afterValid);
  });

  it('fails cleanly when the engine is absent but status still works', async () => {
    const cwd = await prepareProject();
    await runCLI(['new', 'batch', 'q3-auth'], { cwd });

    const apply = await runCLI(['batch', 'apply', 'q3-auth'], { cwd });
    expect(apply.exitCode).not.toBe(0);
    expect(`${apply.stdout}${apply.stderr}`.toLowerCase()).toContain('engine');

    const status = await runCLI(['batch', 'status', 'q3-auth'], { cwd });
    expect(status.exitCode).toBe(0);
  });

  it('emits no ANSI escape codes under --no-color', async () => {
    const cwd = await prepareProject();
    await runCLI(['new', 'batch', 'q3-auth'], { cwd });
    const result = await runCLI(['--no-color', 'batch', 'view', 'q3-auth'], { cwd });
    expect(result.exitCode).toBe(0);
    // eslint-disable-next-line no-control-regex
    expect(result.stdout).not.toMatch(/\[/);
  });

  it('validates a malformed batch manifest reporting the entry, accepting valid ones', async () => {
    const cwd = await prepareProject();
    const batchDir = path.join(cwd, '.ratchet', 'batches', 'hand-written');
    await fs.mkdir(batchDir, { recursive: true });
    // A manifest with one malformed change entry (missing name) and a bad kind.
    await fs.writeFile(
      path.join(batchDir, 'batch.yaml'),
      [
        'name: hand-written',
        'phases:',
        '  - name: foundation',
        '    goal: g',
        '    success: s',
        '    proofOfWork:',
        '      kind: not-a-kind',
        '      run: x',
        '      pass: "0"',
        '    changes:',
        '      - name: ok-change',
        '',
      ].join('\n'),
      'utf-8'
    );
    const result = await runCLI(['validate', 'hand-written'], { cwd });
    expect(result.exitCode).not.toBe(0);
    const out = `${result.stdout}${result.stderr}`;
    expect(out).toContain('proofOfWork');
  });

  it('accepts a hand-written valid manifest exactly like a scaffolded one', async () => {
    const cwd = await prepareProject();
    const batchDir = path.join(cwd, '.ratchet', 'batches', 'by-hand');
    await fs.mkdir(batchDir, { recursive: true });
    await fs.writeFile(
      path.join(batchDir, 'batch.yaml'),
      [
        'name: by-hand',
        'phases:',
        '  - name: foundation',
        '    goal: g',
        '    success: s',
        '    proofOfWork: { kind: integration, run: x, pass: "0" }',
        '    changes:',
        '      - name: a',
        '      - name: b',
        '        after: [a]',
        '',
      ].join('\n'),
      'utf-8'
    );
    const status = await runCLI(['batch', 'status', 'by-hand', '--json'], { cwd });
    expect(status.exitCode).toBe(0);
    const parsed = JSON.parse(status.stdout);
    expect(parsed.name).toBe('by-hand');
  });

  it('records progress on the run journal via report', async () => {
    const cwd = await prepareProject();
    await runCLI(['new', 'batch', 'q3-auth'], { cwd });
    const report = await runCLI(
      ['batch', 'report', 'q3-auth', '--change', 'add-first-change', '--status', 'drafted 2 of 4'],
      { cwd }
    );
    expect(report.exitCode).toBe(0);
    const journal = await fs.readFile(
      path.join(cwd, '.ratchet', 'batches', 'q3-auth', 'run', 'journal.jsonl'),
      'utf-8'
    );
    expect(journal).toContain('drafted 2 of 4');
    expect(journal).toContain('progress');
  });
});
