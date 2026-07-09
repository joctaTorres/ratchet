/**
 * Unit tests for the batch `prGrouping` setting and the `pr` routable agent
 * stage.
 *
 * Implements: features/pr-grouping-config/schema.feature
 *
 * Pure schema/resolution — no spawn. Two surfaces are exercised:
 *   - `prGrouping` (`off` / `whole-batch`) accepted at both config scopes, an
 *     invalid mode rejected at both, and `resolveBatchSettings` defaulting it to
 *     `off` (source `default`) while honoring a project / manifest override.
 *   - the shared `agent` stage-map accepting `pr` as a fourth stage at both
 *     scopes, and still rejecting an unknown stage key.
 *
 * The scope indirection mirrors `agent-setting.test.ts`: one scenario asserts
 * identical behavior at the project-config `batch` schema and the manifest
 * override schema.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { ProjectConfigSchema } from '../../../src/core/project-config.js';
import { BatchSettingsOverrideSchema } from '../../../src/core/batch/manifest.js';
import { resolveBatchSettings } from '../../../src/core/batch/config.js';
import type { BatchManifest } from '../../../src/core/batch/manifest.js';

// The two config scopes. Each parses a `batch`-shaped object and reports whether
// validation succeeded plus the resolved value, so a single scenario asserts
// identical behavior at both scopes.
const scopes: {
  name: string;
  parse: (batch: unknown) => { success: boolean; data?: Record<string, unknown> };
}[] = [
  {
    name: 'project-config',
    parse: (batch) => {
      const result = ProjectConfigSchema.shape.batch.safeParse(batch);
      return result.success
        ? { success: true, data: result.data as Record<string, unknown> }
        : { success: false };
    },
  },
  {
    name: 'manifest',
    parse: (batch) => {
      const result = BatchSettingsOverrideSchema.safeParse(batch);
      return result.success
        ? { success: true, data: result.data as Record<string, unknown> }
        : { success: false };
    },
  },
];

describe.each(scopes)('prGrouping at $name scope', ({ parse }) => {
  it('accepts `off` (resolves to the string)', () => {
    const result = parse({ prGrouping: 'off' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data?.prGrouping).toBe('off');
  });

  it('accepts `whole-batch` (resolves to the string)', () => {
    const result = parse({ prGrouping: 'whole-batch' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data?.prGrouping).toBe('whole-batch');
  });

  it('accepts the stacked `per-phase` mode (resolves to the string)', () => {
    const result = parse({ prGrouping: 'per-phase' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data?.prGrouping).toBe('per-phase');
  });

  it('accepts the stacked `per-change` mode (resolves to the string)', () => {
    const result = parse({ prGrouping: 'per-change' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data?.prGrouping).toBe('per-change');
  });

  it('rejects a bogus mode', () => {
    expect(parse({ prGrouping: 'bogus' }).success).toBe(false);
  });
});

describe.each(scopes)('the `pr` agent stage at $name scope', ({ parse }) => {
  it('accepts an `agent` stage-map that names `pr`', () => {
    const result = parse({ agent: { apply: 'opencode', pr: 'claude' } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.agent).toEqual({ apply: 'opencode', pr: 'claude' });
    }
  });

  it('accepts a full propose/apply/verify/pr stage-map', () => {
    const map = { propose: 'claude', apply: 'opencode', verify: 'opencode', pr: 'claude' };
    const result = parse({ agent: map });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data?.agent).toEqual(map);
  });

  it('still rejects an unknown stage key', () => {
    expect(parse({ agent: { deploy: 'claude' } }).success).toBe(false);
  });
});

// Resolution across scopes, isolated via the tmpdir fixture pattern already used
// in config.test.ts.
describe('resolveBatchSettings prGrouping', () => {
  let projectRoot: string;
  let userConfigHome: string;
  let priorXdgConfigHome: string | undefined;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-grouping-'));
    await fs.mkdir(path.join(projectRoot, '.ratchet'), { recursive: true });
    // Isolate the user/global scope so resolution never reads the real machine's
    // ~/.config/ratchet.
    userConfigHome = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-grouping-xdg-'));
    priorXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = userConfigHome;
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(userConfigHome, { recursive: true, force: true });
    if (priorXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = priorXdgConfigHome;
  });

  async function writeConfig(content: string): Promise<void> {
    await fs.writeFile(path.join(projectRoot, '.ratchet', 'config.yaml'), content, 'utf-8');
  }

  it('defaults to `off` with source `default` when unset', async () => {
    await writeConfig('schema: ratchet\n');
    const { settings, sources } = resolveBatchSettings(projectRoot);
    expect(settings.prGrouping).toBe('off');
    expect(sources.prGrouping).toBe('default');
  });

  it('honors a project-config override', async () => {
    await writeConfig('schema: ratchet\nbatch:\n  prGrouping: whole-batch\n');
    const { settings, sources } = resolveBatchSettings(projectRoot);
    expect(settings.prGrouping).toBe('whole-batch');
    expect(sources.prGrouping).toBe('project');
  });

  it('lets the manifest override the project default', async () => {
    await writeConfig('schema: ratchet\nbatch:\n  prGrouping: off\n');
    const manifest = {
      name: 'q3-prs',
      phases: [],
      settings: { prGrouping: 'whole-batch' },
    } as unknown as BatchManifest;
    const { settings, sources } = resolveBatchSettings(projectRoot, manifest);
    expect(settings.prGrouping).toBe('whole-batch');
    expect(sources.prGrouping).toBe('manifest');
  });
});
