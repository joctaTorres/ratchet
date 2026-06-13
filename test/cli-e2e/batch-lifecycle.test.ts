/**
 * Batch CLI lifecycle e2e — happy and sad paths the core `batch.test.ts` suite
 * does not already cover.
 *
 * Happy: a full single-flow lifecycle (new -> status/--json -> view/list ->
 * config --set + read-back -> report status/blocker reflected in status/view ->
 * report --answer parked -> apply running the bundled engine).
 *
 * Sad: cyclic / unknown `after` edges rejected naming the offending entries;
 * invalid config enum + unknown key rejected listing allowed values with the
 * file unchanged; missing / ambiguous / nonexistent batch names; apply running
 * the bundled engine while the open commands keep working.
 *
 * These drive the real `bin/ratchet.js` over throwaway projects via runCLI; the
 * engine is bundled into the CLI, so apply runs it in-process with no install.
 */

import { afterAll, describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { runCLI } from '../helpers/run-cli.js';

const tempRoots: string[] = [];

async function prepareProject(): Promise<string> {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'ratchet-batch-lifecycle-'));
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

/** Write a hand-authored batch manifest under .ratchet/batches/<name>. */
async function writeManifest(cwd: string, name: string, lines: string[]): Promise<void> {
  const dir = path.join(cwd, '.ratchet', 'batches', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'batch.yaml'), lines.join('\n') + '\n', 'utf-8');
}

afterAll(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('batch CLI full lifecycle (happy path)', () => {
  it('runs new -> status -> view/list -> config -> report -> apply in one flow', async () => {
    const cwd = await prepareProject();

    // 1. Scaffold.
    const created = await runCLI(['new', 'batch', 'q3-auth'], { cwd });
    expect(created.exitCode).toBe(0);

    // 2. status --json reports the scaffolded change as the next runnable step.
    const status1 = await runCLI(['batch', 'status', 'q3-auth', '--json'], { cwd });
    expect(status1.exitCode).toBe(0);
    const parsed1 = JSON.parse(status1.stdout);
    expect(parsed1.name).toBe('q3-auth');
    expect(parsed1.next).not.toBeNull();
    expect(parsed1.next.change).toBe('add-first-change');

    // 3. view renders the dashboard; list shows the batch with its change count.
    const view1 = await runCLI(['--no-color', 'batch', 'view', 'q3-auth'], { cwd });
    expect(view1.exitCode).toBe(0);
    expect(view1.stdout).toContain('q3-auth');
    expect(view1.stdout).toContain('add-first-change');

    const list1 = await runCLI(['batch', 'list', '--json'], { cwd });
    expect(list1.exitCode).toBe(0);
    const listParsed = JSON.parse(list1.stdout);
    expect(listParsed.batches.map((b: { name: string }) => b.name)).toContain('q3-auth');

    // 4. config --set then read it back: the change is persisted and surfaced.
    const set = await runCLI(['batch', 'config', '--set', 'gate=after-propose'], { cwd });
    expect(set.exitCode).toBe(0);
    const config = await runCLI(['batch', 'config', '--json'], { cwd });
    expect(config.exitCode).toBe(0);
    const configParsed = JSON.parse(config.stdout);
    expect(configParsed.settings.gate).toBe('after-propose');
    expect(configParsed.sources.gate).toBe('project');

    // 5. report progress, then raise a blocker — both reflected in status/view.
    const progress = await runCLI(
      ['batch', 'report', 'q3-auth', '--change', 'add-first-change', '--status', 'scaffolded'],
      { cwd }
    );
    expect(progress.exitCode).toBe(0);

    const blocker = 'which session store?';
    const raised = await runCLI(
      ['batch', 'report', 'q3-auth', '--change', 'add-first-change', '--blocker', blocker],
      { cwd }
    );
    expect(raised.exitCode).toBe(0);

    const status2 = await runCLI(['batch', 'status', 'q3-auth', '--json'], { cwd });
    const parsed2 = JSON.parse(status2.stdout);
    const change2 = parsed2.phases
      .flatMap((p: { changes: unknown[] }) => p.changes)
      .find((c: { name: string }) => c.name === 'add-first-change');
    expect(change2.status).toBe('blocked');
    expect(change2.parked.reason).toBe(blocker);
    expect(parsed2.next).toBeNull(); // the only change is parked

    const view2 = await runCLI(['--no-color', 'batch', 'view', 'q3-auth'], { cwd });
    expect(view2.stdout).toContain('blocked:');
    expect(view2.stdout).toContain(blocker);

    // 6. record an answer: the park gains the answer and view notes it resumes.
    const answer = await runCLI(
      ['batch', 'report', 'q3-auth', '--change', 'add-first-change', '--answer', 'redis'],
      { cwd }
    );
    expect(answer.exitCode).toBe(0);
    const status3 = await runCLI(['batch', 'status', 'q3-auth', '--json'], { cwd });
    const change3 = JSON.parse(status3.stdout)
      .phases.flatMap((p: { changes: unknown[] }) => p.changes)
      .find((c: { name: string }) => c.name === 'add-first-change');
    expect(change3.parked.answer).toBe('redis');

    // 7. apply runs the bundled engine in-process: it picks up the answered
    //    change and drives it to adapter resolution, with no install gate. Pin an
    //    absent agent so the engine parks instead of spawning a real coding agent.
    await runCLI(['batch', 'config', '--set', 'agent=no-such-agent'], { cwd });
    const apply = await runCLI(['batch', 'apply', 'q3-auth'], { cwd });
    const applyOut = `${apply.stdout}${apply.stderr}`;
    expect(applyOut).not.toContain('not installed');
    expect(applyOut.toLowerCase()).not.toContain('license');
    expect(applyOut).toContain('add-first-change');
    expect(applyOut).toContain("Unknown agent adapter 'no-such-agent'");
  });
});

describe('batch manifest DAG validation (sad paths)', () => {
  it('rejects a cyclic after edge naming the offending entries', async () => {
    const cwd = await prepareProject();
    await writeManifest(cwd, 'cyclic', [
      'name: cyclic',
      'phases:',
      '  - name: foundation',
      '    goal: g',
      '    success: s',
      '    proofOfWork: { kind: integration, run: x, pass: "exit 0" }',
      '    changes:',
      '      - name: a',
      '        after: [b]',
      '      - name: b',
      '        after: [a]',
    ]);
    const result = await runCLI(['validate', 'cyclic'], { cwd });
    expect(result.exitCode).not.toBe(0);
    const out = `${result.stdout}${result.stderr}`;
    expect(out.toLowerCase()).toContain('cycle');
    // Both members of the cycle are named.
    expect(out).toContain('a');
    expect(out).toContain('b');
  });

  it('rejects an unknown after reference naming the offending change and target', async () => {
    const cwd = await prepareProject();
    await writeManifest(cwd, 'dangling', [
      'name: dangling',
      'phases:',
      '  - name: foundation',
      '    goal: g',
      '    success: s',
      '    proofOfWork: { kind: integration, run: x, pass: "exit 0" }',
      '    changes:',
      '      - name: real-change',
      '        after: [ghost-change]',
    ]);
    const result = await runCLI(['validate', 'dangling'], { cwd });
    expect(result.exitCode).not.toBe(0);
    const out = `${result.stdout}${result.stderr}`;
    expect(out).toContain('real-change');
    expect(out).toContain('ghost-change');
    expect(out.toLowerCase()).toContain('unknown reference');
  });

  it('accepts a valid DAG with after edges (no false positive)', async () => {
    const cwd = await prepareProject();
    await writeManifest(cwd, 'acyclic', [
      'name: acyclic',
      'phases:',
      '  - name: foundation',
      '    goal: g',
      '    success: s',
      '    proofOfWork: { kind: integration, run: x, pass: "exit 0" }',
      '    changes:',
      '      - name: a',
      '      - name: b',
      '        after: [a]',
      '      - name: c',
      '        after: [a, b]',
    ]);
    const result = await runCLI(['validate', 'acyclic'], { cwd });
    expect(result.exitCode).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('valid');
  });
});

describe('batch config --set validation (sad paths)', () => {
  it('rejects an invalid strategy enum, listing allowed values, file unchanged', async () => {
    const cwd = await prepareProject();
    const before = await fs.readFile(path.join(cwd, '.ratchet', 'config.yaml'), 'utf-8');

    const bad = await runCLI(['batch', 'config', '--set', 'strategy=sideways'], { cwd });
    expect(bad.exitCode).not.toBe(0);
    const out = `${bad.stdout}${bad.stderr}`;
    expect(out).toContain('vertical-slice');
    expect(out).toContain('feature');

    const after = await fs.readFile(path.join(cwd, '.ratchet', 'config.yaml'), 'utf-8');
    expect(after).toBe(before); // no-op on invalid input
  });

  it('rejects an unknown setting key, listing allowed keys, file unchanged', async () => {
    const cwd = await prepareProject();
    const before = await fs.readFile(path.join(cwd, '.ratchet', 'config.yaml'), 'utf-8');

    const bad = await runCLI(['batch', 'config', '--set', 'frequency=daily'], { cwd });
    expect(bad.exitCode).not.toBe(0);
    const out = `${bad.stdout}${bad.stderr}`;
    expect(out.toLowerCase()).toContain('unknown');
    expect(out).toContain('gate');

    const after = await fs.readFile(path.join(cwd, '.ratchet', 'config.yaml'), 'utf-8');
    expect(after).toBe(before);
  });
});

describe('batch name resolution (sad paths)', () => {
  it('errors cleanly with non-zero exit when no batches exist', async () => {
    const cwd = await prepareProject();
    const result = await runCLI(['batch', 'status'], { cwd });
    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`.toLowerCase()).toContain('no batches');
  });

  it('errors cleanly when a named batch does not exist', async () => {
    const cwd = await prepareProject();
    const result = await runCLI(['batch', 'status', 'does-not-exist'], { cwd });
    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('does-not-exist');
    expect(`${result.stdout}${result.stderr}`.toLowerCase()).toContain('not found');
  });

  it('refuses an ambiguous bare name when multiple batches exist, listing them', async () => {
    const cwd = await prepareProject();
    await runCLI(['new', 'batch', 'alpha'], { cwd });
    await runCLI(['new', 'batch', 'beta'], { cwd });
    const result = await runCLI(['batch', 'status'], { cwd });
    expect(result.exitCode).not.toBe(0);
    const out = `${result.stdout}${result.stderr}`;
    expect(out.toLowerCase()).toContain('multiple');
    expect(out).toContain('alpha');
    expect(out).toContain('beta');
  });

  it('auto-selects the single batch when no name is given', async () => {
    const cwd = await prepareProject();
    await runCLI(['new', 'batch', 'only-one'], { cwd });
    const result = await runCLI(['batch', 'status', '--json'], { cwd });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).name).toBe('only-one');
  });
});

describe('bundled-engine apply does not break the open commands', () => {
  it('apply runs the bundled engine, while status/view/list/config still work', async () => {
    const cwd = await prepareProject();
    await runCLI(['new', 'batch', 'q3-auth'], { cwd });
    // Pin an absent agent so apply parks at adapter resolution deterministically.
    await runCLI(['batch', 'config', '--set', 'agent=no-such-agent'], { cwd });

    const apply = await runCLI(['batch', 'apply', 'q3-auth'], { cwd });
    const out = `${apply.stdout}${apply.stderr}`;
    expect(out).not.toContain('not installed');
    expect(out.toLowerCase()).not.toContain('license');

    // The open commands keep working alongside the bundled engine.
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
  });
});
