// Mirrors the refuse → accept flow of
// .ratchet/changes/scenario-loss-guard/features/archive-change/archive.feature
// ("Archiving a change that would drop store scenarios is refused" +
//  "Accepting scenario removal with --accept-removed-scenarios").
import { afterAll, describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { runCLI } from '../helpers/run-cli.js';

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

const tempRoots: string[] = [];

const STORE_FEATURE = `Feature: Login
  Scenario: Successful login
    Given a registered user
    When they submit valid credentials
    Then they are logged in
`;

// Valid feature that drops "Successful login".
const DROPPING_FEATURE = `Feature: Login
  Scenario: Password reset
    Given a registered user
    When they request a password reset
    Then a reset email is sent
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
 * Minimal project: a store file holding "Successful login" and an active
 * change "add-login" whose version of the same file drops that scenario.
 */
async function prepareProject(): Promise<string> {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'ratchet-scenario-safe-archive-'));
  tempRoots.push(base);
  const projectDir = path.join(base, 'project');

  await writeFile(
    path.join(projectDir, '.ratchet', 'features', 'user-auth', 'login.feature'),
    STORE_FEATURE
  );
  const changeDir = path.join(projectDir, '.ratchet', 'changes', 'add-login');
  await writeFile(path.join(changeDir, '.ratchet.yaml'), 'schema: ratchet\n');
  await writeFile(path.join(changeDir, 'plan.md'), VALID_PLAN);
  await writeFile(
    path.join(changeDir, 'features', 'user-auth', 'login.feature'),
    DROPPING_FEATURE
  );
  return projectDir;
}

afterAll(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('scenario-safe archive (e2e)', () => {
  it('refuses a scenario-dropping archive non-zero naming the lost scenario, then archives with --accept-removed-scenarios', async () => {
    const projectDir = await prepareProject();
    const storeFile = path.join(projectDir, '.ratchet', 'features', 'user-auth', 'login.feature');
    const changeDir = path.join(projectDir, '.ratchet', 'changes', 'add-login');

    // 1. Refuse: dropping archive exits non-zero and names the lost scenario.
    const refused = await runCLI(['archive', 'add-login', '-y'], { cwd: projectDir });
    expect(refused.exitCode).not.toBe(0);
    expect(`${refused.stdout}\n${refused.stderr}`).toContain('Successful login');

    // Store untouched; change not moved into the archive.
    expect(await fs.readFile(storeFile, 'utf-8')).toBe(STORE_FEATURE);
    expect(await fileExists(changeDir)).toBe(true);

    // 2. Accept: the same archive with the flag succeeds.
    const accepted = await runCLI(
      ['archive', 'add-login', '-y', '--accept-removed-scenarios'],
      { cwd: projectDir }
    );
    expect(accepted.exitCode).toBe(0);

    // Store overwritten with the change's version; change moved to the archive.
    expect(await fs.readFile(storeFile, 'utf-8')).toBe(DROPPING_FEATURE);
    expect(await fileExists(changeDir)).toBe(false);
    const archiveEntries = await fs.readdir(
      path.join(projectDir, '.ratchet', 'changes', 'archive')
    );
    expect(archiveEntries.some((entry) => entry.endsWith('-add-login'))).toBe(true);
  });
});
