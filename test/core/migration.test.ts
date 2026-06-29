/**
 * Fixture-isolated tests for src/core/migration.ts.
 *
 * Implements features/core-util-tests/migration.feature: the one-time profile
 * migration's scan, no-op, and migrate paths. Each scenario builds an isolated
 * project tree under fs.mkdtemp(os.tmpdir()) and an isolated global-config dir
 * pointed at by XDG_CONFIG_HOME, then tears both down and restores process.env
 * in afterEach — so the tests depend on no real repo or config, on each other,
 * or on execution order. The real scan/no-op/migrate logic runs unmocked
 * against the tmpdir tree and the tmpdir config file.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { scanInstalledWorkflows, migrateIfNeeded } from '../../src/core/migration.js';
import { getGlobalConfig, getGlobalConfigPath } from '../../src/core/global-config.js';
import { WORKFLOW_TO_SKILL_DIR } from '../../src/core/profile-sync-drift.js';
import { CommandAdapterRegistry } from '../../src/core/command-generation/index.js';
import type { AIToolOption } from '../../src/core/config.js';

const CLAUDE_TOOL: AIToolOption = {
  name: 'Claude Code',
  value: 'claude',
  available: true,
  skillsDir: '.claude',
};
const TOOLS = [CLAUDE_TOOL];

describe('migration', () => {
  let projectDir: string;
  let xdgDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-migration-project-'));
    xdgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-migration-xdg-'));
    originalEnv = { ...process.env };
    process.env.XDG_CONFIG_HOME = xdgDir;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(xdgDir, { recursive: true, force: true });
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  /** Writes the raw global config file under the isolated XDG dir. */
  function writeConfig(raw: string | Record<string, unknown>): void {
    const configPath = getGlobalConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const content = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
    fs.writeFileSync(configPath, content, 'utf-8');
  }

  /** Installs a workflow as a SKILL.md under the tool's skills dir. */
  function installSkill(workflowId: string): void {
    const skillFile = path.join(
      projectDir,
      CLAUDE_TOOL.skillsDir!,
      'skills',
      WORKFLOW_TO_SKILL_DIR[workflowId as keyof typeof WORKFLOW_TO_SKILL_DIR],
      'SKILL.md'
    );
    fs.mkdirSync(path.dirname(skillFile), { recursive: true });
    fs.writeFileSync(skillFile, `# ${workflowId}\n`, 'utf-8');
  }

  /** Installs a workflow as a command file at its adapter path. */
  function installCommand(workflowId: string): void {
    const adapter = CommandAdapterRegistry.get(CLAUDE_TOOL.value)!;
    const cmdPath = path.join(projectDir, adapter.getFilePath(workflowId));
    fs.mkdirSync(path.dirname(cmdPath), { recursive: true });
    fs.writeFileSync(cmdPath, `# ${workflowId}\n`, 'utf-8');
  }

  describe('scanInstalledWorkflows', () => {
    it('returns an empty list for a project with no installed workflows', () => {
      expect(scanInstalledWorkflows(projectDir, TOOLS)).toEqual([]);
    });

    it('reports a workflow installed as a skill', () => {
      installSkill('propose');

      expect(scanInstalledWorkflows(projectDir, TOOLS)).toContain('propose');
    });

    it('reports a workflow installed as a command', () => {
      installCommand('propose');

      expect(scanInstalledWorkflows(projectDir, TOOLS)).toContain('propose');
    });
  });

  describe('migrateIfNeeded', () => {
    it('is a no-op when a profile is already set', () => {
      writeConfig({ profile: 'core' });
      installSkill('propose');
      const before = fs.readFileSync(getGlobalConfigPath(), 'utf-8');

      migrateIfNeeded(projectDir, TOOLS);

      expect(fs.readFileSync(getGlobalConfigPath(), 'utf-8')).toBe(before);
    });

    it('is a no-op for a project with no installed workflows', () => {
      writeConfig({ featureFlags: {} });

      migrateIfNeeded(projectDir, TOOLS);

      const config = getGlobalConfig();
      // No profile was written, so the default 'core' is what surfaces.
      expect(config.profile).toBe('core');
      expect(config.workflows).toBeUndefined();
    });

    it('sets the custom profile with the detected workflows when workflows are installed', () => {
      writeConfig({ featureFlags: {} });
      installSkill('propose');
      installCommand('apply');

      migrateIfNeeded(projectDir, TOOLS);

      const config = getGlobalConfig();
      expect(config.profile).toBe('custom');
      expect(config.workflows).toEqual(expect.arrayContaining(['propose', 'apply']));
    });

    it('infers delivery "skills" when workflows are installed only as skills', () => {
      writeConfig({ featureFlags: {} });
      installSkill('propose');

      migrateIfNeeded(projectDir, TOOLS);

      expect(getGlobalConfig().delivery).toBe('skills');
    });

    it('infers delivery "commands" when workflows are installed only as commands', () => {
      writeConfig({ featureFlags: {} });
      installCommand('propose');

      migrateIfNeeded(projectDir, TOOLS);

      expect(getGlobalConfig().delivery).toBe('commands');
    });

    it('infers delivery "both" when workflows are installed as skills and commands', () => {
      writeConfig({ featureFlags: {} });
      installSkill('propose');
      installCommand('propose');

      migrateIfNeeded(projectDir, TOOLS);

      expect(getGlobalConfig().delivery).toBe('both');
    });

    it('preserves an already-set delivery field during migration', () => {
      writeConfig({ featureFlags: {}, delivery: 'skills' });
      installCommand('propose');

      migrateIfNeeded(projectDir, TOOLS);

      const config = getGlobalConfig();
      expect(config.profile).toBe('custom');
      expect(config.delivery).toBe('skills');
    });

    it('skips silently when the config file is malformed', () => {
      writeConfig('{ not valid json');
      installSkill('propose');

      expect(() => migrateIfNeeded(projectDir, TOOLS)).not.toThrow();
      // The malformed file was not rewritten — no migration was performed.
      expect(fs.readFileSync(getGlobalConfigPath(), 'utf-8')).toBe('{ not valid json');
    });
  });
});
