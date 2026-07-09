/**
 * Unit tests for per-stage agent resolution.
 *
 * Implements: features/agent-stage-resolution/resolution.feature
 *
 * Two layers of pure/near-pure logic:
 *   - `resolveAgentForStage` — the pure stage → agent lookup (no fs, no spawn):
 *     scalar / full-map / partial-map / unset × each stage.
 *   - `resolveBatchSettings` — the per-stage cross-scope merge over project +
 *     manifest layers (map-over-map, map-over-scalar-base, scalar-over-map,
 *     single-scope unchanged), isolated via the `fs.mkdtemp` fixture.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  AGENT_STAGE_KEYS,
  resolveAgentForStage,
} from '../../../src/core/batch/agent-setting.js';
import { resolveBatchSettings } from '../../../src/core/batch/config.js';
import type { BatchManifest } from '../../../src/core/batch/manifest.js';

describe('resolveAgentForStage', () => {
  it('returns the scalar for every stage (a scalar covers all stages)', () => {
    for (const stage of AGENT_STAGE_KEYS) {
      expect(resolveAgentForStage('opencode', stage)).toBe('opencode');
    }
  });

  it('returns the mapped agent for each stage of a full map', () => {
    const map = { propose: 'claude', apply: 'opencode', verify: 'gemini' };
    expect(resolveAgentForStage(map, 'propose')).toBe('claude');
    expect(resolveAgentForStage(map, 'apply')).toBe('opencode');
    expect(resolveAgentForStage(map, 'verify')).toBe('gemini');
  });

  it('returns undefined for a stage a partial map does not name', () => {
    const map = { apply: 'opencode' };
    expect(resolveAgentForStage(map, 'apply')).toBe('opencode');
    expect(resolveAgentForStage(map, 'propose')).toBeUndefined();
    expect(resolveAgentForStage(map, 'verify')).toBeUndefined();
  });

  it('returns undefined for every stage when the setting is unset', () => {
    for (const stage of AGENT_STAGE_KEYS) {
      expect(resolveAgentForStage(undefined, stage)).toBeUndefined();
    }
  });
});

describe('resolveBatchSettings — per-stage cross-scope merge for agent', () => {
  let projectRoot: string;
  let userConfigHome: string;
  let priorXdgConfigHome: string | undefined;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-stage-'));
    await fs.mkdir(path.join(projectRoot, '.ratchet'), { recursive: true });
    // Isolate the user/global scope so resolution never reads the real machine.
    userConfigHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-stage-xdg-'));
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

  function manifest(agent: unknown): BatchManifest {
    return { name: 'b', phases: [], settings: { agent } } as unknown as BatchManifest;
  }

  it('merges two stage-maps nearest-wins per stage (project ← manifest)', async () => {
    await writeConfig('schema: ratchet\nbatch:\n  agent:\n    propose: claude\n    apply: claude\n');
    const { settings, sources } = resolveBatchSettings(
      projectRoot,
      manifest({ apply: 'opencode' })
    );
    // propose keeps the lower-scope map's entry; apply is overridden by the
    // nearer manifest; verify is unmapped → default (undefined here).
    expect(resolveAgentForStage(settings.agent, 'propose')).toBe('claude');
    expect(resolveAgentForStage(settings.agent, 'apply')).toBe('opencode');
    expect(resolveAgentForStage(settings.agent, 'verify')).toBeUndefined();
    // Both scopes contributed a map; the nearest contributing scope is manifest.
    expect(sources.agent).toBe('manifest');
    expect(settings.agent).toEqual({ propose: 'claude', apply: 'opencode' });
  });

  it('merges a partial stage-map over a scalar base from a lower scope', async () => {
    await writeConfig('schema: ratchet\nbatch:\n  agent: claude\n');
    const { settings, sources } = resolveBatchSettings(
      projectRoot,
      manifest({ apply: 'opencode' })
    );
    // The map overrides apply; the scalar base covers the stages it does not name.
    expect(resolveAgentForStage(settings.agent, 'apply')).toBe('opencode');
    expect(resolveAgentForStage(settings.agent, 'propose')).toBe('claude');
    expect(resolveAgentForStage(settings.agent, 'verify')).toBe('claude');
    expect(sources.agent).toBe('manifest');
    // Materialized full map so the scalar fallback is preserved per stage
    // (including the `pr` and `decompose` stages, which the scalar base also
    // covers).
    expect(settings.agent).toEqual({
      propose: 'claude',
      apply: 'opencode',
      verify: 'claude',
      pr: 'claude',
      decompose: 'claude',
    });
  });

  it('lets a nearer scalar override a farther stage-map for every stage', async () => {
    await writeConfig('schema: ratchet\nbatch:\n  agent:\n    propose: claude\n');
    const { settings, sources } = resolveBatchSettings(projectRoot, {
      name: 'b',
      phases: [],
      settings: { agent: 'opencode' },
    } as unknown as BatchManifest);
    for (const stage of AGENT_STAGE_KEYS) {
      expect(resolveAgentForStage(settings.agent, stage)).toBe('opencode');
    }
    expect(settings.agent).toBe('opencode');
    expect(sources.agent).toBe('manifest');
  });

  it('leaves a single-scope scalar unchanged', async () => {
    await writeConfig('schema: ratchet\nbatch:\n  agent: opencode\n');
    const { settings, sources } = resolveBatchSettings(projectRoot);
    expect(settings.agent).toBe('opencode');
    expect(sources.agent).toBe('project');
  });

  it('leaves a single-scope partial map unchanged (unmapped stages stay default)', async () => {
    await writeConfig('schema: ratchet\nbatch:\n  agent:\n    apply: opencode\n');
    const { settings, sources } = resolveBatchSettings(projectRoot);
    expect(settings.agent).toEqual({ apply: 'opencode' });
    expect(sources.agent).toBe('project');
    expect(resolveAgentForStage(settings.agent, 'apply')).toBe('opencode');
    expect(resolveAgentForStage(settings.agent, 'propose')).toBeUndefined();
  });

  it('leaves agent unset (default source) when no scope configures it', async () => {
    await writeConfig('schema: ratchet\n');
    const { settings, sources } = resolveBatchSettings(projectRoot);
    expect(settings.agent).toBeUndefined();
    expect(sources.agent).toBe('default');
  });
});
