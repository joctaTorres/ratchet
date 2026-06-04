import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { InitCommand } from '../../src/core/init.js';
import { newChangeCommand } from '../../src/commands/workflow/new-change.js';
import { statusCommand } from '../../src/commands/workflow/status.js';
import { instructionsCommand, applyInstructionsCommand } from '../../src/commands/workflow/instructions.js';
import { RATCHET_DIR_NAME } from '../../src/core/config.js';

/**
 * Capture everything written to console.log while running `fn`, returning the
 * joined output. Restores the original logger afterward.
 */
async function captureLog(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return lines.join('\n');
}

/** Parse the last JSON object printed during `fn`. */
async function captureJson(fn: () => Promise<void>): Promise<any> {
  const out = await captureLog(fn);
  // The command prints a single JSON document; grab the first balanced object.
  const start = out.indexOf('{');
  expect(start).toBeGreaterThanOrEqual(0);
  return JSON.parse(out.slice(start));
}

describe('artifact workflow (ratchet schema)', () => {
  let root: string;
  let cwd: string;
  const changeName = 'add-login';

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-artifact-workflow-'));
    cwd = process.cwd();
    // Scaffold a real project (suppress its console output).
    const initSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await new InitCommand({ tools: 'claude', force: true }).execute(root);
    } finally {
      initSpy.mockRestore();
    }
    process.chdir(root);
  });

  afterEach(async () => {
    process.chdir(cwd);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('scaffolds with the ratchet schema and the features store', async () => {
    await expect(
      fs.access(path.join(root, RATCHET_DIR_NAME, 'features'))
    ).resolves.toBeUndefined();
  });

  it('runs new change -> instructions features -> instructions plan -> status -> instructions apply', async () => {
    // 1. new change
    await captureLog(() => newChangeCommand(changeName, { json: true }));
    const changeDir = path.join(root, RATCHET_DIR_NAME, 'changes', changeName);
    await expect(fs.access(path.join(changeDir, '.ratchet.yaml'))).resolves.toBeUndefined();

    // 2. instructions for the `features` artifact
    const featuresInstr = await captureJson(() =>
      instructionsCommand('features', { change: changeName, json: true })
    );
    expect(featuresInstr.artifactId ?? featuresInstr.artifact ?? featuresInstr.id).toBe('features');
    // The instruction guides naming features/<capability>/<name>.feature.
    const featuresBlob = JSON.stringify(featuresInstr);
    expect(featuresBlob).toMatch(/\.feature/);

    // 3. instructions for the `plan` artifact (requires features)
    const planInstr = await captureJson(() =>
      instructionsCommand('plan', { change: changeName, json: true })
    );
    expect(planInstr.artifactId ?? planInstr.artifact ?? planInstr.id).toBe('plan');

    // 4. write valid artifacts, then status reports both done with applyRequires=[plan]
    await fs.mkdir(path.join(changeDir, 'features', 'user-auth'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'features', 'user-auth', 'login.feature'),
      'Feature: Login\n  Scenario: OK\n    Given a user\n    When they log in\n    Then they are in\n',
      'utf-8'
    );
    await fs.writeFile(
      path.join(changeDir, 'plan.md'),
      [
        '# add-login',
        '',
        '## Why',
        'We need authenticated access so only registered users reach the app.',
        '',
        '## What Changes',
        'Add a login form and a session check.',
        '',
        '## Design',
        'Session cookie on success.',
        '',
        '## Tasks',
        '- [ ] 1.1 Implement login',
        '',
      ].join('\n'),
      'utf-8'
    );

    const status = await captureJson(() => statusCommand({ change: changeName, json: true }));
    expect(status.applyRequires).toEqual(['plan']);
    const byId = Object.fromEntries(
      (status.artifacts as Array<{ id: string; status: string }>).map(a => [a.id, a.status])
    );
    expect(byId.features).toBe('done');
    expect(byId.plan).toBe('done');

    // 5. apply instructions parse ## Tasks from plan.md
    const apply = await captureJson(() =>
      applyInstructionsCommand({ change: changeName, json: true })
    );
    expect(apply.progress.total).toBe(1);
    expect(apply.progress.complete).toBe(0);
    expect(apply.tasks).toHaveLength(1);
    expect(apply.state).toBe('ready');
  });
});
