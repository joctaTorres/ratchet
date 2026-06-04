import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { ArchiveCommand } from '../../src/core/archive.js';
import { RATCHET_DIR_NAME } from '../../src/core/config.js';

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
});
