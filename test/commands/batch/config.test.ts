/**
 * Integration tests for the `batch config` verb.
 *
 * Implements features/batch-command-tests/config.feature: resolve / get / set of
 * batch settings over an isolated tmpdir fixture repo — values render with their
 * source, the secret `authToken` never leaks, and invalid `--set` input leaves
 * the project config file untouched.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { parse as parseYaml } from 'yaml';
import { makeBatchFixture, type BatchFixture } from './batch-fixture.js';

const { resolvePlanningHomeMock } = vi.hoisted(() => ({
  resolvePlanningHomeMock: vi.fn(),
}));

vi.mock('../../../src/core/planning-home.js', () => ({
  resolveCurrentPlanningHomeSync: resolvePlanningHomeMock,
}));

import { batchConfigCommand } from '../../../src/commands/batch/config.js';

describe('batchConfigCommand', () => {
  let fixture: BatchFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeBatchFixture();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resolvePlanningHomeMock.mockReturnValue({ root: fixture.root });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fixture.cleanup();
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  it('renders project-level settings annotated with their source', async () => {
    await fixture.writeProjectConfig('batch:\n  gate: after-propose\n');

    await batchConfigCommand(undefined, {});

    const out = output();
    expect(out).toContain('gate');
    expect(out).toContain('after-propose');
    expect(out).toContain('[project]');
  });

  it('shows a manifest-overridden value as sourced from the manifest', async () => {
    await fixture.writeBatch('b', { settings: { gate: 'autonomous' } });

    await batchConfigCommand('b', {});

    const out = output();
    expect(out).toContain('autonomous');
    expect(out).toContain('[manifest]');
  });

  it('throws when the named batch does not exist', async () => {
    await expect(batchConfigCommand('ghost', {})).rejects.toThrow(/not found/);
  });

  it('rejects a --set value with no equals sign', async () => {
    await expect(batchConfigCommand(undefined, { set: 'gate' })).rejects.toThrow(/key=value/);
  });

  it('leaves the config file unchanged when --set has an invalid enum value', async () => {
    await fixture.writeProjectConfig('batch:\n  gate: voluntary\n');
    const before = await fs.readFile(fixture.configPath(), 'utf-8');

    await expect(batchConfigCommand(undefined, { set: 'gate=bogus' })).rejects.toThrow(
      /Invalid value/
    );

    const after = await fs.readFile(fixture.configPath(), 'utf-8');
    expect(after).toBe(before);
  });

  it('writes a valid --set to the project-level batch section', async () => {
    await batchConfigCommand(undefined, { set: 'gate=autonomous' });

    const config = parseYaml(await fs.readFile(fixture.configPath(), 'utf-8')) as {
      batch: { gate: string };
    };
    expect(config.batch.gate).toBe('autonomous');
    expect(output()).toContain('Set batch.gate = autonomous');
  });

  it('emits a JSON ack for a valid --set when --json is set', async () => {
    await batchConfigCommand(undefined, { set: 'gate=autonomous', json: true });

    const parsed = JSON.parse(output()) as { ok: boolean; key: string; value: string };
    expect(parsed).toEqual({ ok: true, key: 'gate', value: 'autonomous' });
  });

  it('never echoes a secret setting value back', async () => {
    const secret = 'super-secret-token-abcdef1234567890';

    await batchConfigCommand(undefined, { set: `authToken=${secret}` });

    const out = output();
    expect(out).not.toContain(secret);
    expect(out).toContain('***');
  });

  it('masks the secret authToken in --json resolved output', async () => {
    await fixture.writeBatch('b', { settings: { authToken: 'secret-token-value-123456' } });

    await batchConfigCommand('b', { json: true });

    const parsed = JSON.parse(output()) as { settings: { authToken?: string } };
    expect(parsed.settings.authToken).toBe('***');
  });
});

describe('batchConfigCommand permissions block', () => {
  let fixture: BatchFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let xdgConfigHome: string;
  let priorXdgConfigHome: string | undefined;

  beforeEach(async () => {
    fixture = await makeBatchFixture();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resolvePlanningHomeMock.mockReturnValue({ root: fixture.root });

    // Drive the `user` permission scope through an isolated global config dir so
    // the resolved posture is sourced from `[user]` and the permissions block
    // renders allow / deny / per-agent raw lines.
    xdgConfigHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-xdg-cfg-'));
    priorXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    const globalDir = path.join(xdgConfigHome, 'ratchet');
    await fs.mkdir(globalDir, { recursive: true });
    await fs.writeFile(
      path.join(globalDir, 'config.json'),
      JSON.stringify({ batch: { permissions: { posture: 'curated-allowlist' } } }),
      'utf-8'
    );
  });

  afterEach(async () => {
    if (priorXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = priorXdgConfigHome;
    }
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fixture.cleanup();
    await fs.rm(xdgConfigHome, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  it('renders the permissions posture from the user scope plus allow/deny/raw rows', async () => {
    // Project scope contributes allow / deny / per-agent raw; the user scope
    // sets the posture, so the posture row is annotated `[user]`.
    await fixture.writeProjectConfig(
      [
        'batch:',
        '  permissions:',
        '    allow: ["Bash(ls:*)"]',
        '    deny: ["Bash(rm:*)"]',
        '    raw:',
        '      claude: ["--allowedTools", "Read"]',
        '',
      ].join('\n')
    );

    await batchConfigCommand(undefined, {});

    const out = output();
    expect(out).toContain('permissions');
    expect(out).toContain('curated-allowlist');
    expect(out).toContain('[user]');
    expect(out).toContain('allow');
    expect(out).toContain('Bash(ls:*)');
    expect(out).toContain('deny');
    expect(out).toContain('Bash(rm:*)');
    expect(out).toContain('raw.claude');
    expect(out).toContain('--allowedTools');
  });
});
