// Mirrors features/batch-archive/guard-halt.feature: `ratchet batch archive`
// halts the cascade at the first member whose scenario guard trips (naming the
// member and its lost scenarios, batch directory left in place), and a re-run
// after the offending member is resolved individually completes and moves the
// batch directory.
import { afterAll, describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { runCLI } from '../helpers/run-cli.js';

const tempRoots: string[] = [];

async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf-8');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

const BATCH_NAME = 'guard-halt-batch';

const STORE_FEATURE = `Feature: Login
  Scenario: Locked account
    Given a locked account
    When they submit valid credentials
    Then they are told the account is locked
`;

// Valid feature that drops "Locked account".
const DROPPING_FEATURE = `Feature: Login
  Scenario: Password reset
    Given a registered user
    When they request a password reset
    Then a reset email is sent
`;

const VALID_PLAN = `# drop-locked

## Why
The locked-account flow moved to its own capability so login stays minimal.

## What Changes
Drop the locked-account scenario from the login feature.

## Design
Whole-file replacement of the store's login feature.

## Tasks
- [x] 1.1 Edit the login feature
`;

const MANIFEST = `name: ${BATCH_NAME}
phases:
  - name: foundation
    goal: g
    success: s
    proofOfWork:
      kind: integration
      run: x
      pass: '0'
    changes:
      - name: kept-change
        done: kept change archived
  - name: runtime
    goal: g
    success: s
    proofOfWork:
      kind: integration
      run: x
      pass: '0'
    changes:
      - name: drop-locked
        done: drop locked archived
`;

/**
 * Minimal project: a store file holding "Locked account" and a two-member
 * batch — `kept-change` (first, archives cleanly) and `drop-locked` (second,
 * whose version of the store file drops the scenario).
 */
async function prepareProject(): Promise<string> {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'ratchet-batch-guard-halt-'));
  tempRoots.push(base);
  const projectDir = path.join(base, 'project');

  await writeFile(
    path.join(projectDir, '.ratchet', 'config.yaml'),
    'schema: ratchet\n'
  );
  await writeFile(
    path.join(projectDir, '.ratchet', 'features', 'user-auth', 'login.feature'),
    STORE_FEATURE
  );
  await writeFile(
    path.join(projectDir, '.ratchet', 'batches', BATCH_NAME, 'batch.yaml'),
    MANIFEST
  );

  // kept-change: a complete change with no feature edits — archives cleanly.
  const keptDir = path.join(projectDir, '.ratchet', 'changes', 'kept-change');
  await writeFile(path.join(keptDir, '.ratchet.yaml'), 'schema: ratchet\n');
  await writeFile(path.join(keptDir, 'plan.md'), VALID_PLAN);

  // drop-locked: a complete change whose login.feature drops "Locked account".
  const dropDir = path.join(projectDir, '.ratchet', 'changes', 'drop-locked');
  await writeFile(path.join(dropDir, '.ratchet.yaml'), 'schema: ratchet\n');
  await writeFile(path.join(dropDir, 'plan.md'), VALID_PLAN);
  await writeFile(
    path.join(dropDir, 'features', 'user-auth', 'login.feature'),
    DROPPING_FEATURE
  );

  return projectDir;
}

afterAll(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('batch archive scenario-guard halt (e2e)', () => {
  it('halts at the offending member naming it and its lost scenario, then a re-run after individual resolution completes', async () => {
    const projectDir = await prepareProject();
    const batchDir = path.join(projectDir, '.ratchet', 'batches', BATCH_NAME);
    const changesArchive = path.join(projectDir, '.ratchet', 'changes', 'archive');
    const batchesArchive = path.join(projectDir, '.ratchet', 'batches', 'archive');

    // 1. The cascade archives kept-change, then halts at drop-locked: non-zero,
    //    naming the member, the store file, and the lost scenario.
    const halted = await runCLI(['batch', 'archive', BATCH_NAME, '--yes'], { cwd: projectDir });
    const haltedOut = `${halted.stdout}\n${halted.stderr}`;
    expect(halted.exitCode).not.toBe(0);
    expect(haltedOut).toContain('drop-locked');
    expect(haltedOut).toContain('user-auth/login.feature');
    expect(haltedOut).toContain('Locked account');

    // The earlier member is really archived; the batch directory stays in
    // place and no archived batch directory is created.
    expect(await fileExists(path.join(projectDir, '.ratchet', 'changes', 'kept-change'))).toBe(false);
    const changeArchiveEntries = await fs.readdir(changesArchive);
    expect(changeArchiveEntries.some((entry) => entry.endsWith('-kept-change'))).toBe(true);
    expect(await fileExists(batchDir)).toBe(true);
    expect(await fileExists(batchesArchive)).toBe(false);

    // 2. Resolve the offending member through its own archive flow, accepting
    //    the scenario removal.
    const resolved = await runCLI(
      ['archive', 'drop-locked', '-y', '--accept-removed-scenarios'],
      { cwd: projectDir }
    );
    expect(resolved.exitCode).toBe(0);

    // 3. Re-run: already-archived members are skipped, the cascade completes,
    //    and the batch directory is moved under batches/archive/.
    const rerun = await runCLI(['batch', 'archive', BATCH_NAME, '--yes'], { cwd: projectDir });
    expect(rerun.exitCode).toBe(0);
    expect(await fileExists(batchDir)).toBe(false);
    const batchArchiveEntries = await fs.readdir(batchesArchive);
    expect(batchArchiveEntries.some((entry) => entry.endsWith(`-${BATCH_NAME}`))).toBe(true);
  });
});
