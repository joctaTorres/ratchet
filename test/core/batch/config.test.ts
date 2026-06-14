import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { parse as parseYaml } from 'yaml';
import {
  resolveBatchSettings,
  validateSetting,
  setProjectBatchSetting,
  DEFAULT_BATCH_SETTINGS,
} from '../../../src/core/batch/config.js';
import type { BatchManifest } from '../../../src/core/batch/manifest.js';

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

  it('accepts the local and docker loci and rejects an unknown locus', () => {
    expect(validateSetting('locus', 'local').ok).toBe(true);
    expect(validateSetting('locus', 'docker').ok).toBe(true);
    const bad = validateSetting('locus', 'remote');
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('local');
    expect(bad.error).toContain('docker');
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
});
