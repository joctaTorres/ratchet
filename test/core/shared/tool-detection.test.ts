import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import {
  SKILL_NAMES,
  COMMAND_IDS,
  getToolsWithSkillsDir,
  getToolSkillStatus,
  getToolStates,
  extractGeneratedByVersion,
  getToolVersionStatus,
  getConfiguredTools,
  getAllToolVersionStatus,
} from '../../../src/core/shared/tool-detection.js';
import { getSkillTemplates, getCommandTemplates } from '../../../src/core/shared/skill-generation.js';
import { ALL_WORKFLOWS } from '../../../src/core/profiles.js';
import { AI_TOOLS } from '../../../src/core/config.js';
import { CommandAdapterRegistry } from '../../../src/core/command-generation/index.js';
import { toolHasAnyConfiguredCommand } from '../../../src/core/profile-sync-drift.js';

describe('tool-detection', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `ratchet-test-${randomUUID()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('SKILL_NAMES', () => {
    it('should contain the generated skill names', () => {
      expect(SKILL_NAMES).toHaveLength(12);
      expect(SKILL_NAMES).toContain('ratchet-propose');
      expect(SKILL_NAMES).toContain('ratchet-apply-change');
      expect(SKILL_NAMES).toContain('ratchet-verify-change');
      expect(SKILL_NAMES).toContain('ratchet-archive-change');
      expect(SKILL_NAMES).toContain('ratchet-propose-standard');
      expect(SKILL_NAMES).toContain('ratchet-apply-batch');
      expect(SKILL_NAMES).toContain('ratchet-archive-batch');
      expect(SKILL_NAMES).toContain('ratchet-propose-batch');
      expect(SKILL_NAMES).toContain('ratchet-decompose-phase');
      expect(SKILL_NAMES).toContain('ratchet-open-pr');
      expect(SKILL_NAMES).toContain('ratchet-brainstorm');
      expect(SKILL_NAMES).toContain('ratchet-eval');
      expect(SKILL_NAMES).not.toContain('ratchet-explore');
    });
  });

  describe('getToolsWithSkillsDir', () => {
    it('should return tools that have skillsDir configured', () => {
      const tools = getToolsWithSkillsDir();
      expect(tools).toContain('claude');
      expect(tools).toContain('cursor');
      expect(tools).toContain('opencode');
      expect(tools.length).toBeGreaterThan(0);
    });
  });

  describe('getToolSkillStatus', () => {
    it('should return not configured for unknown tool', () => {
      const status = getToolSkillStatus(testDir, 'unknown-tool');
      expect(status.configured).toBe(false);
      expect(status.fullyConfigured).toBe(false);
      expect(status.skillCount).toBe(0);
    });

    it('should return not configured when no skills exist', () => {
      const status = getToolSkillStatus(testDir, 'claude');
      expect(status.configured).toBe(false);
      expect(status.fullyConfigured).toBe(false);
      expect(status.skillCount).toBe(0);
    });

    it('should detect when one skill exists', async () => {
      const skillDir = path.join(testDir, '.claude', 'skills', 'ratchet-propose');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'test content');

      const status = getToolSkillStatus(testDir, 'claude');
      expect(status.configured).toBe(true);
      expect(status.fullyConfigured).toBe(false);
      expect(status.skillCount).toBe(1);
    });

    it('should detect when all skills exist', async () => {
      for (const skillName of SKILL_NAMES) {
        const skillDir = path.join(testDir, '.claude', 'skills', skillName);
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'test content');
      }

      const status = getToolSkillStatus(testDir, 'claude');
      expect(status.configured).toBe(true);
      expect(status.fullyConfigured).toBe(true);
      expect(status.skillCount).toBe(SKILL_NAMES.length);
    });
  });

  describe('getToolStates', () => {
    it('should return status for all tools with skillsDir', () => {
      const states = getToolStates(testDir);
      expect(states.has('claude')).toBe(true);
      expect(states.has('cursor')).toBe(true);

      const claudeStatus = states.get('claude');
      expect(claudeStatus?.configured).toBe(false);
    });

    it('should detect configured tools', async () => {
      const skillDir = path.join(testDir, '.claude', 'skills', 'ratchet-propose');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'test content');

      const states = getToolStates(testDir);
      expect(states.get('claude')?.configured).toBe(true);
      expect(states.get('cursor')?.configured).toBe(false);
    });
  });

  describe('extractGeneratedByVersion', () => {
    it('should return null for non-existent file', () => {
      const version = extractGeneratedByVersion(path.join(testDir, 'missing.md'));
      expect(version).toBeNull();
    });

    it('should return null when generatedBy is not present', async () => {
      const filePath = path.join(testDir, 'skill.md');
      await fs.writeFile(filePath, `---
name: ratchet-explore
metadata:
  author: ratchet
  version: "1.0"
---

Content here
`);

      const version = extractGeneratedByVersion(filePath);
      expect(version).toBeNull();
    });

    it('should extract generatedBy version with double quotes', async () => {
      const filePath = path.join(testDir, 'skill.md');
      await fs.writeFile(filePath, `---
name: ratchet-explore
metadata:
  author: ratchet
  version: "1.0"
  generatedBy: "0.23.0"
---

Content here
`);

      const version = extractGeneratedByVersion(filePath);
      expect(version).toBe('0.23.0');
    });

    it('should extract generatedBy version with single quotes', async () => {
      const filePath = path.join(testDir, 'skill.md');
      await fs.writeFile(filePath, `---
name: ratchet-explore
metadata:
  generatedBy: '0.24.0'
---

Content here
`);

      const version = extractGeneratedByVersion(filePath);
      expect(version).toBe('0.24.0');
    });

    it('should extract generatedBy version without quotes', async () => {
      const filePath = path.join(testDir, 'skill.md');
      await fs.writeFile(filePath, `---
name: ratchet-explore
metadata:
  generatedBy: 0.25.0
---

Content here
`);

      const version = extractGeneratedByVersion(filePath);
      expect(version).toBe('0.25.0');
    });
  });

  describe('getToolVersionStatus', () => {
    it('should return not configured for unknown tool', () => {
      const status = getToolVersionStatus(testDir, 'unknown-tool', '0.23.0');
      expect(status.configured).toBe(false);
      expect(status.generatedByVersion).toBeNull();
      expect(status.needsUpdate).toBe(false);
    });

    it('should return not configured when no skills exist', () => {
      const status = getToolVersionStatus(testDir, 'claude', '0.23.0');
      expect(status.configured).toBe(false);
      expect(status.generatedByVersion).toBeNull();
      expect(status.needsUpdate).toBe(false);
    });

    it('should detect needsUpdate when generatedBy is missing', async () => {
      const skillDir = path.join(testDir, '.claude', 'skills', 'ratchet-propose');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: ratchet-explore
metadata:
  author: ratchet
  version: "1.0"
---

Content here
`);

      const status = getToolVersionStatus(testDir, 'claude', '0.23.0');
      expect(status.configured).toBe(true);
      expect(status.generatedByVersion).toBeNull();
      expect(status.needsUpdate).toBe(true);
    });

    it('should detect needsUpdate when version differs', async () => {
      const skillDir = path.join(testDir, '.claude', 'skills', 'ratchet-propose');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: ratchet-explore
metadata:
  author: ratchet
  version: "1.0"
  generatedBy: "0.22.0"
---

Content here
`);

      const status = getToolVersionStatus(testDir, 'claude', '0.23.0');
      expect(status.configured).toBe(true);
      expect(status.generatedByVersion).toBe('0.22.0');
      expect(status.needsUpdate).toBe(true);
    });

    it('should not need update when version matches', async () => {
      const skillDir = path.join(testDir, '.claude', 'skills', 'ratchet-propose');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: ratchet-explore
metadata:
  author: ratchet
  version: "1.0"
  generatedBy: "0.23.0"
---

Content here
`);

      const status = getToolVersionStatus(testDir, 'claude', '0.23.0');
      expect(status.configured).toBe(true);
      expect(status.generatedByVersion).toBe('0.23.0');
      expect(status.needsUpdate).toBe(false);
    });

    it('should include tool name in status', async () => {
      const skillDir = path.join(testDir, '.claude', 'skills', 'ratchet-propose');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'content');

      const status = getToolVersionStatus(testDir, 'claude', '0.23.0');
      expect(status.toolId).toBe('claude');
      expect(status.toolName).toBe('Claude Code');
    });
  });

  describe('getConfiguredTools', () => {
    it('should return empty array when no tools are configured', () => {
      const tools = getConfiguredTools(testDir);
      expect(tools).toEqual([]);
    });

    it('should return configured tools', async () => {
      // Setup Claude
      const claudeSkillDir = path.join(testDir, '.claude', 'skills', 'ratchet-propose');
      await fs.mkdir(claudeSkillDir, { recursive: true });
      await fs.writeFile(path.join(claudeSkillDir, 'SKILL.md'), 'content');

      // Setup Cursor
      const cursorSkillDir = path.join(testDir, '.cursor', 'skills', 'ratchet-propose');
      await fs.mkdir(cursorSkillDir, { recursive: true });
      await fs.writeFile(path.join(cursorSkillDir, 'SKILL.md'), 'content');

      const tools = getConfiguredTools(testDir);
      expect(tools).toContain('claude');
      expect(tools).toContain('cursor');
      expect(tools).toHaveLength(2);
    });
  });

  describe('getAllToolVersionStatus', () => {
    it('should return empty array when no tools are configured', () => {
      const statuses = getAllToolVersionStatus(testDir, '0.23.0');
      expect(statuses).toEqual([]);
    });

    it('should return version status for all configured tools', async () => {
      // Setup Claude with old version
      const claudeSkillDir = path.join(testDir, '.claude', 'skills', 'ratchet-propose');
      await fs.mkdir(claudeSkillDir, { recursive: true });
      await fs.writeFile(path.join(claudeSkillDir, 'SKILL.md'), `---
metadata:
  generatedBy: "0.22.0"
---
`);

      // Setup Cursor with current version
      const cursorSkillDir = path.join(testDir, '.cursor', 'skills', 'ratchet-propose');
      await fs.mkdir(cursorSkillDir, { recursive: true });
      await fs.writeFile(path.join(cursorSkillDir, 'SKILL.md'), `---
metadata:
  generatedBy: "0.23.0"
---
`);

      const statuses = getAllToolVersionStatus(testDir, '0.23.0');
      expect(statuses).toHaveLength(2);

      const claudeStatus = statuses.find(s => s.toolId === 'claude');
      expect(claudeStatus?.generatedByVersion).toBe('0.22.0');
      expect(claudeStatus?.needsUpdate).toBe(true);

      const cursorStatus = statuses.find(s => s.toolId === 'cursor');
      expect(cursorStatus?.generatedByVersion).toBe('0.23.0');
      expect(cursorStatus?.needsUpdate).toBe(false);
    });
  });

  /**
   * Implements features/update-sync/detection-registry-parity.feature: the
   * detection registry (SKILL_NAMES / COMMAND_IDS) covers every shipped
   * workflow, decompose-phase and open-pr installations are counted like every
   * other workflow, and legacy-only detection entries are tolerated.
   */
  describe('detection-registry parity', () => {
    it('counts only-installed decompose-phase and open-pr skills for every tool with a skills dir', async () => {
      const toolIds = getToolsWithSkillsDir();
      expect(toolIds.length).toBeGreaterThan(0);

      for (const toolId of toolIds) {
        const tool = AI_TOOLS.find((t) => t.value === toolId);
        expect(tool?.skillsDir, `no skillsDir for tool '${toolId}'`).toBeDefined();

        for (const skillName of ['ratchet-decompose-phase', 'ratchet-open-pr']) {
          const skillDir = path.join(testDir, tool!.skillsDir!, 'skills', skillName);
          await fs.mkdir(skillDir, { recursive: true });
          await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'test content');
        }

        const status = getToolSkillStatus(testDir, toolId);
        expect(status.configured, `expected ${toolId} to be detected as configured`).toBe(true);
        expect(status.fullyConfigured, `expected ${toolId} to not be fully configured`).toBe(false);
        expect(status.skillCount, `expected both new skills to count for ${toolId}`).toBe(2);
      }
    });

    it('detects a tool with only the open-pr command installed for every registered agent', async () => {
      const originalCodexHome = process.env.CODEX_HOME;
      // Codex command paths are absolute under CODEX_HOME; redirect it into the
      // fixture so the test stays hermetic and never touches the real home dir.
      process.env.CODEX_HOME = path.join(testDir, '.codex-home');
      try {
        const adapters = CommandAdapterRegistry.getAll().filter((adapter) =>
          AI_TOOLS.some((tool) => tool.value === adapter.toolId && tool.skillsDir)
        );
        expect(adapters.length).toBeGreaterThan(0);

        for (const adapter of adapters) {
          expect(
            toolHasAnyConfiguredCommand(testDir, adapter.toolId),
            `expected no configured command for ${adapter.toolId} before the file is written`
          ).toBe(false);

          const commandPath = adapter.getFilePath('open-pr');
          // Absolute paths (codex under CODEX_HOME) are used as-is.
          const fullPath = path.isAbsolute(commandPath)
            ? commandPath
            : path.join(testDir, commandPath);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, 'test content');

          expect(
            toolHasAnyConfiguredCommand(testDir, adapter.toolId),
            `expected the open-pr command to be detected for ${adapter.toolId}`
          ).toBe(true);
        }
      } finally {
        if (originalCodexHome === undefined) {
          delete process.env.CODEX_HOME;
        } else {
          process.env.CODEX_HOME = originalCodexHome;
        }
      }
    });

    it('detection registry covers every workflow in ALL_WORKFLOWS', () => {
      const skillTemplates = getSkillTemplates();
      const commandTemplates = getCommandTemplates();

      for (const workflow of ALL_WORKFLOWS) {
        // Never skip: a workflow with no skill or command template is a hard
        // failure, not a pass — the generation registries must cover it.
        const skillEntry = skillTemplates.find((entry) => entry.workflowId === workflow);
        expect(skillEntry, `workflow '${workflow}' has no skill template`).toBeDefined();
        expect(SKILL_NAMES).toContain(skillEntry!.dirName);

        const commandEntry = commandTemplates.find((entry) => entry.id === workflow);
        expect(commandEntry, `workflow '${workflow}' has no command template`).toBeDefined();
        expect(COMMAND_IDS).toContain(commandEntry!.id);
      }
    });

    it('tolerates legacy-only detection entries (explore)', () => {
      const generatedCommandIds = getCommandTemplates().map((entry) => entry.id);
      const generatedSkillDirNames = getSkillTemplates().map((entry) => entry.dirName);

      // 'explore' is a legacy command id: still detected, but no current
      // workflow generates it — legacy ids are allowed.
      expect(COMMAND_IDS).toContain('explore');
      expect(generatedCommandIds).not.toContain('explore');

      // Parity asserts coverage only: everything generated is detected; extra
      // legacy entries in the registry never fail the check.
      for (const id of generatedCommandIds) {
        expect(COMMAND_IDS).toContain(id);
      }
      for (const dirName of generatedSkillDirNames) {
        expect(SKILL_NAMES).toContain(dirName);
      }
    });
  });
});
