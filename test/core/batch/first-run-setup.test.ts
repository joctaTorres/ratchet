import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { parse as parseYaml } from 'yaml';
import {
  maybeRunFirstRunSetup,
  type FirstRunPrompts,
} from '../../../src/core/batch/first-run-setup.js';
import { hasPermissionConfig, setProjectBatchPermissions } from '../../../src/core/batch/config.js';
import { readUserBatchPermissions } from '../../../src/core/global-config.js';

let projectRoot: string;
let userConfigHome: string;
let priorXdg: string | undefined;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'first-run-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet'), { recursive: true });
  await fs.writeFile(path.join(projectRoot, '.ratchet', 'config.yaml'), 'schema: ratchet\n', 'utf-8');
  userConfigHome = await fs.mkdtemp(path.join(os.tmpdir(), 'first-run-xdg-'));
  priorXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = userConfigHome;
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
  await fs.rm(userConfigHome, { recursive: true, force: true });
  if (priorXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = priorXdg;
});

/** A prompt seam that fails loudly if invoked — proves no prompting happened. */
const neverPrompts: FirstRunPrompts = {
  selectPosture: async () => {
    throw new Error('selectPosture must not be called in this scenario');
  },
  selectScope: async () => {
    throw new Error('selectScope must not be called in this scenario');
  },
};

describe('first-run setup — non-interactive must never prompt, write, or hang', () => {
  it('no config + non-interactive: returns the default posture, writes nothing, never prompts', async () => {
    // The neverPrompts seam guarantees no prompt fires; if it blocked on a real
    // prompt the test would hang and time out, so completing IS the no-hang proof.
    const result = await maybeRunFirstRunSetup(projectRoot, {
      interactive: false,
      prompts: neverPrompts,
      quiet: true,
    });
    expect(result.action).toBe('non-interactive-fallback');
    expect(result.posture).toBe('repo-sandboxed-permissive');
    expect(result.savedTo).toBeUndefined();
    // No config written at either scope.
    expect(hasPermissionConfig(projectRoot)).toBe(false);
    expect(readUserBatchPermissions()).toBeUndefined();
    const cfg = parseYaml(readFileSync(path.join(projectRoot, '.ratchet', 'config.yaml'), 'utf-8'));
    expect(cfg.batch?.permissions).toBeUndefined();
  });

  it('completes promptly without blocking (bounded by the test timeout)', async () => {
    await expect(
      maybeRunFirstRunSetup(projectRoot, { interactive: false, prompts: neverPrompts, quiet: true })
    ).resolves.toBeDefined();
  });
});

describe('first-run setup — interactive guided flow', () => {
  it('saves the chosen posture to the project config by default', async () => {
    const prompts: FirstRunPrompts = {
      selectPosture: async () => 'curated-allowlist',
      selectScope: async () => 'project',
    };
    const result = await maybeRunFirstRunSetup(projectRoot, {
      interactive: true,
      prompts,
      quiet: true,
    });
    expect(result.action).toBe('prompted');
    expect(result.savedTo).toBe('project');
    const cfg = parseYaml(readFileSync(path.join(projectRoot, '.ratchet', 'config.yaml'), 'utf-8'));
    expect(cfg.batch.permissions.posture).toBe('curated-allowlist');
    expect(readUserBatchPermissions()).toBeUndefined();
  });

  it('can save to the user config instead, leaving the project config untouched', async () => {
    const prompts: FirstRunPrompts = {
      selectPosture: async () => 'full-autonomy',
      selectScope: async () => 'user',
    };
    const result = await maybeRunFirstRunSetup(projectRoot, {
      interactive: true,
      prompts,
      quiet: true,
    });
    expect(result.savedTo).toBe('user');
    expect(readUserBatchPermissions()).toEqual({ posture: 'full-autonomy' });
    const cfg = parseYaml(readFileSync(path.join(projectRoot, '.ratchet', 'config.yaml'), 'utf-8'));
    expect(cfg.batch?.permissions).toBeUndefined();
  });
});

describe('first-run setup — idempotency', () => {
  it('is a no-op once a policy exists at the project scope (no re-prompt)', async () => {
    setProjectBatchPermissions(projectRoot, { posture: 'repo-sandboxed-permissive' });
    const result = await maybeRunFirstRunSetup(projectRoot, {
      interactive: true,
      prompts: neverPrompts,
      quiet: true,
    });
    expect(result.action).toBe('already-configured');
  });
});
