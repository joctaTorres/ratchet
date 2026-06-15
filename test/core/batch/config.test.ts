import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { parse as parseYaml } from 'yaml';
import {
  resolveBatchSettings,
  validateSetting,
  validateRemoteSettings,
  setProjectBatchSetting,
  redactSettings,
  REDACTED_PLACEHOLDER,
  DEFAULT_BATCH_SETTINGS,
  type BatchSettings,
} from '../../../src/core/batch/config.js';
import {
  BatchManifestSchema,
  type BatchManifest,
} from '../../../src/core/batch/manifest.js';

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-config-'));
  await fs.mkdir(path.join(projectRoot, '.ratchet'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

async function writeConfig(content: string): Promise<void> {
  await fs.writeFile(path.join(projectRoot, '.ratchet', 'config.yaml'), content, 'utf-8');
}

describe('resolveBatchSettings', () => {
  it('uses defaults when no batch section is present', async () => {
    await writeConfig('schema: ratchet\n');
    const { settings, sources } = resolveBatchSettings(projectRoot);
    expect(settings).toEqual(DEFAULT_BATCH_SETTINGS);
    expect(sources.gate).toBe('default');
  });

  it('reflects project config values', async () => {
    await writeConfig('schema: ratchet\nbatch:\n  gate: every-phase\n  strategy: feature\n');
    const { settings, sources } = resolveBatchSettings(projectRoot);
    expect(settings.gate).toBe('every-phase');
    expect(settings.strategy).toBe('feature');
    expect(sources.gate).toBe('project');
    expect(sources.proofOfWork).toBe('default');
  });

  it('lets the manifest override project defaults', async () => {
    await writeConfig('schema: ratchet\nbatch:\n  gate: voluntary\n');
    const manifest = {
      name: 'q3-auth',
      phases: [],
      settings: { gate: 'after-propose' },
    } as unknown as BatchManifest;
    const { settings, sources } = resolveBatchSettings(projectRoot, manifest);
    expect(settings.gate).toBe('after-propose');
    expect(sources.gate).toBe('manifest');
  });

  it('defaults the execution locus to local (source default)', async () => {
    await writeConfig('schema: ratchet\n');
    const { settings, sources } = resolveBatchSettings(projectRoot);
    expect(settings.locus).toBe('local');
    expect(sources.locus).toBe('default');
  });

  it('honors a project-level locus (source project)', async () => {
    await writeConfig('schema: ratchet\nbatch:\n  locus: local\n');
    const { settings, sources } = resolveBatchSettings(projectRoot);
    expect(settings.locus).toBe('local');
    expect(sources.locus).toBe('project');
  });

  it('honors a manifest locus override (source manifest)', async () => {
    await writeConfig('schema: ratchet\n');
    const manifest = {
      name: 'q3-auth',
      phases: [],
      settings: { locus: 'local' },
    } as unknown as BatchManifest;
    const { settings, sources } = resolveBatchSettings(projectRoot, manifest);
    expect(settings.locus).toBe('local');
    expect(sources.locus).toBe('manifest');
  });

  it('accepts the docker locus from project config', async () => {
    await writeConfig('schema: ratchet\nbatch:\n  locus: docker\n');
    const { settings, sources } = resolveBatchSettings(projectRoot);
    expect(settings.locus).toBe('docker');
    expect(sources.locus).toBe('project');
  });

  it('accepts a manifest docker locus override', async () => {
    await writeConfig('schema: ratchet\n');
    const manifest = {
      name: 'q3-auth',
      phases: [],
      settings: { locus: 'docker' },
    } as unknown as BatchManifest;
    const { settings, sources } = resolveBatchSettings(projectRoot, manifest);
    expect(settings.locus).toBe('docker');
    expect(sources.locus).toBe('manifest');
  });

  it('leaves image unset by default with the defaults source', async () => {
    await writeConfig('schema: ratchet\n');
    const { settings, sources } = resolveBatchSettings(projectRoot);
    expect(settings.image).toBeUndefined();
    expect(sources.image).toBe('default');
  });

  it('resolves a project-level image (source project)', async () => {
    await writeConfig('schema: ratchet\nbatch:\n  image: my/registry:tag\n');
    const { settings, sources } = resolveBatchSettings(projectRoot);
    expect(settings.image).toBe('my/registry:tag');
    expect(sources.image).toBe('project');
  });

  it('lets a manifest image override the project image (source manifest)', async () => {
    await writeConfig('schema: ratchet\nbatch:\n  image: project/image:1\n');
    const manifest = {
      name: 'q3-auth',
      phases: [],
      settings: { image: 'manifest/image:2' },
    } as unknown as BatchManifest;
    const { settings, sources } = resolveBatchSettings(projectRoot, manifest);
    expect(settings.image).toBe('manifest/image:2');
    expect(sources.image).toBe('manifest');
  });
});

describe('validateSetting', () => {
  it('accepts a valid gate value', () => {
    expect(validateSetting('gate', 'after-propose').ok).toBe(true);
  });

  it('rejects an invalid gate value listing allowed values', () => {
    const result = validateSetting('gate', 'whenever');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('voluntary');
    expect(result.error).toContain('after-propose');
  });

  it('rejects an unknown key', () => {
    expect(validateSetting('nope', 'x').ok).toBe(false);
  });

  it('accepts free-form agent', () => {
    expect(validateSetting('agent', 'claude-code').ok).toBe(true);
  });

  it('accepts the local, docker, and remote loci and rejects an unknown locus', () => {
    expect(validateSetting('locus', 'local').ok).toBe(true);
    expect(validateSetting('locus', 'docker').ok).toBe(true);
    expect(validateSetting('locus', 'remote').ok).toBe(true);
    const bad = validateSetting('locus', 'cloud');
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('local');
    expect(bad.error).toContain('docker');
    expect(bad.error).toContain('remote');
  });

  it('accepts a non-empty host/authToken and rejects an empty one', () => {
    expect(validateSetting('host', 'localhost').ok).toBe(true);
    expect(validateSetting('authToken', 'secret-token').ok).toBe(true);
    const emptyHost = validateSetting('host', '');
    expect(emptyHost.ok).toBe(false);
    expect(emptyHost.error).toContain('host');
    const blankToken = validateSetting('authToken', '   ');
    expect(blankToken.ok).toBe(false);
    expect(blankToken.error).toContain('authToken');
  });

  it('accepts a numeric port and rejects a non-numeric or non-positive one', () => {
    expect(validateSetting('port', '8000').ok).toBe(true);
    const word = validateSetting('port', 'abc');
    expect(word.ok).toBe(false);
    expect(word.error).toContain('port');
    expect(validateSetting('port', '0').ok).toBe(false);
    expect(validateSetting('port', '-1').ok).toBe(false);
    expect(validateSetting('port', '12.5').ok).toBe(false);
    expect(validateSetting('port', '').ok).toBe(false);
  });

  it('accepts a non-empty image and rejects an empty one', () => {
    expect(validateSetting('image', 'python:3.12').ok).toBe(true);
    const empty = validateSetting('image', '');
    expect(empty.ok).toBe(false);
    expect(empty.error).toContain('image');
    const blank = validateSetting('image', '   ');
    expect(blank.ok).toBe(false);
  });
});

describe('setProjectBatchSetting', () => {
  it('writes a valid gate value into config.yaml', async () => {
    await writeConfig('schema: ratchet\n');
    const result = setProjectBatchSetting(projectRoot, 'gate', 'after-propose');
    expect(result.ok).toBe(true);
    const parsed = parseYaml(
      readFileSync(path.join(projectRoot, '.ratchet', 'config.yaml'), 'utf-8')
    );
    expect(parsed.batch.gate).toBe('after-propose');
    expect(parsed.schema).toBe('ratchet');
  });

  it('leaves the file unchanged on invalid input', async () => {
    const original = 'schema: ratchet\nbatch:\n  gate: voluntary\n';
    await writeConfig(original);
    const result = setProjectBatchSetting(projectRoot, 'gate', 'whenever');
    expect(result.ok).toBe(false);
    const after = readFileSync(
      path.join(projectRoot, '.ratchet', 'config.yaml'),
      'utf-8'
    );
    expect(after).toBe(original);
  });

  it('leaves the file unchanged when a non-numeric port is set', async () => {
    const original = 'schema: ratchet\n';
    await writeConfig(original);
    const result = setProjectBatchSetting(projectRoot, 'port', 'not-a-number');
    expect(result.ok).toBe(false);
    const after = readFileSync(path.join(projectRoot, '.ratchet', 'config.yaml'), 'utf-8');
    expect(after).toBe(original);
  });

  it('writes valid remote flat settings into config.yaml', async () => {
    await writeConfig('schema: ratchet\n');
    expect(setProjectBatchSetting(projectRoot, 'locus', 'remote').ok).toBe(true);
    expect(setProjectBatchSetting(projectRoot, 'host', 'localhost').ok).toBe(true);
    expect(setProjectBatchSetting(projectRoot, 'port', '8123').ok).toBe(true);
    expect(setProjectBatchSetting(projectRoot, 'authToken', 'tok').ok).toBe(true);
    const parsed = parseYaml(
      readFileSync(path.join(projectRoot, '.ratchet', 'config.yaml'), 'utf-8')
    );
    expect(parsed.batch.locus).toBe('remote');
    expect(parsed.batch.host).toBe('localhost');
    // YAML reads a numeric string back as a number.
    expect(parsed.batch.port).toBe(8123);
    expect(parsed.batch.authToken).toBe('tok');
  });
});

describe('remote flat settings resolution', () => {
  it('resolves project-level host/port/authToken with the project source', async () => {
    await writeConfig(
      'schema: ratchet\nbatch:\n  locus: remote\n  host: example.com\n  port: 9000\n  authToken: sekret\n'
    );
    const { settings, sources } = resolveBatchSettings(projectRoot);
    expect(settings.locus).toBe('remote');
    expect(settings.host).toBe('example.com');
    expect(settings.port).toBe(9000);
    expect(settings.authToken).toBe('sekret');
    expect(sources.host).toBe('project');
    expect(sources.port).toBe('project');
    expect(sources.authToken).toBe('project');
  });

  it('lets a manifest override the remote settings (source manifest)', async () => {
    await writeConfig('schema: ratchet\nbatch:\n  host: project-host\n  port: 1111\n');
    const manifest = {
      name: 'q',
      phases: [],
      settings: { locus: 'remote', host: 'manifest-host', port: 2222, authToken: 'm-tok' },
    } as unknown as BatchManifest;
    const { settings, sources } = resolveBatchSettings(projectRoot, manifest);
    expect(settings.host).toBe('manifest-host');
    expect(settings.port).toBe(2222);
    expect(sources.host).toBe('manifest');
    expect(sources.port).toBe('manifest');
  });

  it('leaves host/port/authToken unset (default source) for local', async () => {
    await writeConfig('schema: ratchet\n');
    const { settings, sources } = resolveBatchSettings(projectRoot);
    expect(settings.host).toBeUndefined();
    expect(settings.port).toBeUndefined();
    expect(settings.authToken).toBeUndefined();
    expect(sources.host).toBe('default');
  });
});

describe('validateRemoteSettings (cross-field)', () => {
  const base: BatchSettings = { ...DEFAULT_BATCH_SETTINGS };

  it('returns null when locus is not remote (flat keys ignored)', () => {
    expect(validateRemoteSettings({ ...base, locus: 'local' })).toBeNull();
    expect(validateRemoteSettings({ ...base, locus: 'docker' })).toBeNull();
  });

  it('returns null when remote has host, port, and authToken', () => {
    expect(
      validateRemoteSettings({ ...base, locus: 'remote', host: 'h', port: 80, authToken: 't' })
    ).toBeNull();
  });

  it('names the missing keys when remote config is incomplete', () => {
    const msg = validateRemoteSettings({ ...base, locus: 'remote' });
    expect(msg).not.toBeNull();
    expect(msg).toContain('host');
    expect(msg).toContain('port');
    expect(msg).toContain('authToken');
  });

  it('rejects a missing host but keeps the others', () => {
    const msg = validateRemoteSettings({ ...base, locus: 'remote', port: 80, authToken: 't' });
    expect(msg).toContain('host');
    expect(msg).not.toContain(': port');
  });

  it('never echoes the secret token in the error message', () => {
    const msg = validateRemoteSettings({ ...base, locus: 'remote', host: 'h', port: 80 });
    expect(msg).not.toContain('authToken=');
    // It names the key but never a value.
    expect(msg).toContain('authToken');
  });
});

describe('redactSettings (secret handling)', () => {
  it('replaces a present authToken with the placeholder and leaves the rest', () => {
    const redacted = redactSettings({
      ...DEFAULT_BATCH_SETTINGS,
      locus: 'remote',
      host: 'h',
      port: 80,
      authToken: 'super-secret',
    });
    expect(redacted.authToken).toBe(REDACTED_PLACEHOLDER);
    expect(redacted.authToken).not.toContain('super-secret');
    expect(redacted.host).toBe('h');
    expect(redacted.port).toBe(80);
  });

  it('leaves an unset authToken unset', () => {
    const redacted = redactSettings({ ...DEFAULT_BATCH_SETTINGS });
    expect(redacted.authToken).toBeUndefined();
  });

  it('does not mutate the input settings', () => {
    const original: BatchSettings = { ...DEFAULT_BATCH_SETTINGS, authToken: 'keep' };
    redactSettings(original);
    expect(original.authToken).toBe('keep');
  });
});

describe('manifest schema with remote keys', () => {
  it('accepts remote locus and the flat host/port/authToken', () => {
    const result = BatchManifestSchema.safeParse({
      name: 'b',
      settings: { locus: 'remote', host: 'localhost', port: 8000, authToken: 'tok' },
      phases: [],
    });
    expect(result.success).toBe(true);
  });

  it('stays strict — rejects an unknown settings key', () => {
    const result = BatchManifestSchema.safeParse({
      name: 'b',
      settings: { locus: 'remote', bogus: 'x' },
      phases: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-numeric port', () => {
    const result = BatchManifestSchema.safeParse({
      name: 'b',
      settings: { locus: 'remote', port: 'not-a-number' },
      phases: [],
    });
    expect(result.success).toBe(false);
  });
});
