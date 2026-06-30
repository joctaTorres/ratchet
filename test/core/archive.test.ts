import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { parse as parseYaml } from 'yaml';
import { ArchiveCommand } from '../../src/core/archive.js';
import { RATCHET_DIR_NAME } from '../../src/core/config.js';

// Mirror of .ratchet/changes/core-remainder-tests/features/core-remainder-tests/archive.feature
// Drives the interactive @inquirer/prompts (confirm/select) through stubbed answers so the
// non-`--yes` confirmation branches of archive are reachable under test.
const { confirmMock, selectMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  confirm: confirmMock,
  select: selectMock,
}));

async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf-8');
}

const VALID_FEATURE = `Feature: Login
  Scenario: Successful login
    Given a registered user
    When they submit valid credentials
    Then they are logged in
`;

const VALID_PLAN = `# add-login

## Why
We need authenticated access so that only registered users can reach the app.

## What Changes
Add a login form and a session-backed auth check.

## Design
Session cookie issued on successful credential check.

## Tasks
- [x] 1.1 Implement login form
`;

/**
 * Scaffold an active change with a valid feature + plan and the .ratchet.yaml
 * metadata that change discovery keys on.
 */
async function scaffoldChange(
  root: string,
  name: string,
  opts: { feature?: string; rel?: string; plan?: string; deleted?: string } = {}
): Promise<string> {
  const changeDir = path.join(root, RATCHET_DIR_NAME, 'changes', name);
  await fs.mkdir(changeDir, { recursive: true });
  await writeFile(path.join(changeDir, '.ratchet.yaml'), 'schema: ratchet\n');
  const rel = opts.rel ?? 'user-auth/login.feature';
  await writeFile(path.join(changeDir, 'features', rel), opts.feature ?? VALID_FEATURE);
  await writeFile(path.join(changeDir, 'plan.md'), opts.plan ?? VALID_PLAN);
  if (opts.deleted !== undefined) {
    await writeFile(path.join(changeDir, 'features', '.deleted'), opts.deleted);
  }
  return changeDir;
}

describe('ArchiveCommand', () => {
  let root: string;
  let cwd: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-archive-'));
    cwd = process.cwd();
    process.chdir(root);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Default: any prompt confirms. Individual tests override per-call as needed.
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    selectMock.mockReset();
  });

  afterEach(async () => {
    process.chdir(cwd);
    logSpy.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  });

  const storePath = (rel: string) => path.join(root, RATCHET_DIR_NAME, 'features', rel);
  const archivePath = (name: string) =>
    path.join(root, RATCHET_DIR_NAME, 'changes', 'archive', `${new Date().toISOString().split('T')[0]}-${name}`);

  it('copies the feature whole-file into .ratchet/features/<rel> and moves the change to archive', async () => {
    await scaffoldChange(root, 'add-login');

    await new ArchiveCommand().execute('add-login', { yes: true });

    // Store file created with identical content (whole-file copy).
    const stored = await fs.readFile(storePath('user-auth/login.feature'), 'utf-8');
    expect(stored).toBe(VALID_FEATURE);

    // Change moved into dated archive dir; original removed.
    await expect(
      fs.access(path.join(root, RATCHET_DIR_NAME, 'changes', 'add-login'))
    ).rejects.toThrow();
    await expect(fs.access(archivePath('add-login'))).resolves.toBeUndefined();
    // .ratchet.yaml moves with the directory.
    await expect(
      fs.access(path.join(archivePath('add-login'), '.ratchet.yaml'))
    ).resolves.toBeUndefined();
  });

  it('overwrites an existing store file when a later change touches the same path', async () => {
    // Pre-populate the store with old content.
    await writeFile(storePath('user-auth/login.feature'), 'Feature: Login OLD\n');

    const updated = VALID_FEATURE.replace('Successful login', 'Successful login (v2)');
    await scaffoldChange(root, 'update-login', { feature: updated });

    await new ArchiveCommand().execute('update-login', { yes: true });

    const stored = await fs.readFile(storePath('user-auth/login.feature'), 'utf-8');
    expect(stored).toBe(updated);
  });

  it('removes a store file via features/.deleted tombstone', async () => {
    await writeFile(storePath('user-auth/legacy.feature'), 'Feature: Legacy\n');

    await scaffoldChange(root, 'drop-legacy', {
      deleted: 'user-auth/legacy.feature\n',
    });

    await new ArchiveCommand().execute('drop-legacy', { yes: true });

    await expect(fs.access(storePath('user-auth/legacy.feature'))).rejects.toThrow();
  });

  it('does not update the feature store with --skip-features but still archives', async () => {
    await scaffoldChange(root, 'no-store');

    await new ArchiveCommand().execute('no-store', { yes: true, skipFeatures: true });

    await expect(fs.access(storePath('user-auth/login.feature'))).rejects.toThrow();
    await expect(fs.access(archivePath('no-store'))).resolves.toBeUndefined();
  });

  it('does not print delta-style + ~ - counts', async () => {
    await scaffoldChange(root, 'add-login');

    await new ArchiveCommand().execute('add-login', { yes: true });

    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).not.toMatch(/~ \d+ modified/);
    expect(output).not.toMatch(/→ \d+ renamed/);
    expect(output).toMatch(/Feature store updated successfully/);
  });

  it('blocks archive when a feature is invalid (missing Then)', async () => {
    const badFeature = `Feature: Login
  Scenario: Broken
    Given a user
    When they act
`;
    await scaffoldChange(root, 'bad-feature', { feature: badFeature });

    await new ArchiveCommand().execute('bad-feature', { yes: true });

    // Validation failed → change NOT moved, store NOT updated.
    await expect(
      fs.access(path.join(root, RATCHET_DIR_NAME, 'changes', 'bad-feature'))
    ).resolves.toBeUndefined();
    await expect(fs.access(archivePath('bad-feature'))).rejects.toThrow();
  });

  it('throws when there is no Ratchet changes directory', async () => {
    await expect(new ArchiveCommand().execute('whatever', { yes: true })).rejects.toThrow(
      /No Ratchet changes directory/
    );
  });

  it('throws when the named change does not exist', async () => {
    // Create the changes dir but no matching change.
    await fs.mkdir(path.join(root, RATCHET_DIR_NAME, 'changes'), { recursive: true });
    await expect(new ArchiveCommand().execute('ghost', { yes: true })).rejects.toThrow(
      /Change 'ghost' not found/
    );
  });

  it('throws when an archive with the same date prefix already exists', async () => {
    await scaffoldChange(root, 'dup');
    // Pre-create the dated archive target so the existence check trips.
    await fs.mkdir(archivePath('dup'), { recursive: true });

    await expect(new ArchiveCommand().execute('dup', { yes: true })).rejects.toThrow(
      /already exists/
    );
  });

  it('emits non-blocking plan warnings but still archives (Why too short)', async () => {
    const shortWhyPlan = VALID_PLAN.replace(
      'We need authenticated access so that only registered users can reach the app.',
      'short'
    );
    await scaffoldChange(root, 'warn-plan', { plan: shortWhyPlan });

    await new ArchiveCommand().execute('warn-plan', { yes: true });

    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toMatch(/Plan warnings/);
    // Plan warnings are non-blocking: the change is still archived.
    await expect(fs.access(archivePath('warn-plan'))).resolves.toBeUndefined();
  });

  it('continues past incomplete tasks with --yes and reports it', async () => {
    const incompletePlan = VALID_PLAN.replace('- [x] 1.1', '- [ ] 1.1');
    await scaffoldChange(root, 'incomplete', { plan: incompletePlan });

    await new ArchiveCommand().execute('incomplete', { yes: true });

    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toMatch(/incomplete task\(s\) found\. Continuing due to --yes/);
    await expect(fs.access(archivePath('incomplete'))).resolves.toBeUndefined();
  });

  it('reports "No feature changes to apply" when the store already matches', async () => {
    // Pre-populate the store with identical content so applyFeatures finds no diff.
    await writeFile(storePath('user-auth/login.feature'), VALID_FEATURE);
    await scaffoldChange(root, 'idempotent');

    await new ArchiveCommand().execute('idempotent', { yes: true });

    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toMatch(/No feature changes to apply/);
    await expect(fs.access(archivePath('idempotent'))).resolves.toBeUndefined();
  });

  it('warns and archives when validation is skipped with --no-validate and --yes', async () => {
    const badFeature = `Feature: Login\n  Scenario: Broken\n    Given a user\n    When they act\n`;
    await scaffoldChange(root, 'skip-validate', { feature: badFeature });

    await new ArchiveCommand().execute('skip-validate', { yes: true, noValidate: true });

    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toMatch(/Skipping validation/);
    // Even an invalid feature archives when validation is skipped.
    await expect(fs.access(archivePath('skip-validate'))).resolves.toBeUndefined();
  });

  it('materializes declared standard links into the store when features are applied', async () => {
    // Change declares a standard tag in its .ratchet.yaml metadata.
    const changeDir = await scaffoldChange(root, 'with-standard');
    await writeFile(
      path.join(changeDir, '.ratchet.yaml'),
      'schema: ratchet\nstandards:\n  - testing\n'
    );
    // A standard document with that tag exists in the store's standards library so
    // the reverse "## Implemented by" block can be regenerated too.
    await writeFile(
      path.join(root, RATCHET_DIR_NAME, 'standards', 'testing.md'),
      '---\ntag: testing\n---\n\n# Testing strategy\n\nBody.\n'
    );

    await new ArchiveCommand().execute('with-standard', { yes: true });

    // Forward link: the per-capability sidecar maps the feature to the declared tag.
    const sidecarPath = storePath('user-auth/.ratchet.yaml');
    const sidecar = parseYaml(await fs.readFile(sidecarPath, 'utf-8')) as {
      features: Record<string, string[]>;
    };
    expect(sidecar.features['login.feature']).toEqual(['testing']);

    // Reverse link: the standard gained an "## Implemented by" block listing the feature.
    const standardDoc = await fs.readFile(
      path.join(root, RATCHET_DIR_NAME, 'standards', 'testing.md'),
      'utf-8'
    );
    expect(standardDoc).toMatch(/## Implemented by/);
    expect(standardDoc).toMatch(/user-auth\/login\.feature/);

    // And the change itself was archived.
    await expect(fs.access(archivePath('with-standard'))).resolves.toBeUndefined();

    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toMatch(/Standard links materialized for: testing/);
  });

  it('cancels the archive when the skip-validation confirmation is declined', async () => {
    await scaffoldChange(root, 'decline-skip');
    // No --yes flag, validation disabled → archive asks to confirm the skip.
    confirmMock.mockResolvedValueOnce(false);

    await new ArchiveCommand().execute('decline-skip', { noValidate: true });

    // Declining cancels: the change is NOT archived and stays in place.
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toMatch(/Archive cancelled/);
    await expect(
      fs.access(path.join(root, RATCHET_DIR_NAME, 'changes', 'decline-skip'))
    ).resolves.toBeUndefined();
    await expect(fs.access(archivePath('decline-skip'))).rejects.toThrow();
    // The skip-validation confirm was the prompt shown.
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it('skips the feature store but still archives when the feature-store prompt is declined', async () => {
    await scaffoldChange(root, 'decline-store');
    // No --yes: archive asks "Proceed with feature store update?" — decline it.
    confirmMock.mockResolvedValueOnce(false);

    await new ArchiveCommand().execute('decline-store', {});

    // Store left untouched, but the change is still moved to the archive.
    await expect(fs.access(storePath('user-auth/login.feature'))).rejects.toThrow();
    await expect(fs.access(archivePath('decline-store'))).resolves.toBeUndefined();
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toMatch(/Skipping feature store update\. Proceeding with archive/);
  });

  it('selects a change interactively when no name is given', async () => {
    await scaffoldChange(root, 'pick-me');
    // selectChange resolves to the chosen change name; feature-store confirm is true by default.
    selectMock.mockResolvedValueOnce('pick-me');

    await new ArchiveCommand().execute(undefined, {});

    expect(selectMock).toHaveBeenCalledTimes(1);
    await expect(fs.access(archivePath('pick-me'))).resolves.toBeUndefined();
  });

  it('aborts gracefully when the interactive change selection is cancelled', async () => {
    await scaffoldChange(root, 'pick-me');
    // select() rejects on Ctrl+C; selectChange swallows it and returns null.
    selectMock.mockRejectedValueOnce(new Error('User force closed the prompt'));

    await new ArchiveCommand().execute(undefined, {});

    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toMatch(/No change selected\. Aborting/);
    // Nothing archived.
    await expect(
      fs.access(path.join(root, RATCHET_DIR_NAME, 'changes', 'pick-me'))
    ).resolves.toBeUndefined();
  });
});
