import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UpdateCommand, scanInstalledWorkflows } from '../../src/core/update.js';
import { InitCommand } from '../../src/core/init.js';
import { FileSystemUtils } from '../../src/utils/file-system.js';
import { RATCHET_MARKERS } from '../../src/core/config.js';
import type { GlobalConfig } from '../../src/core/global-config.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { randomUUID } from 'crypto';

// Shared mutable mock config state
const mockState = {
  config: {
    featureFlags: {},
    profile: 'core' as const,
    delivery: 'both' as const,
  } as GlobalConfig,
};

// Mock global config module to isolate tests from the machine's actual config
vi.mock('../../src/core/global-config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/global-config.js')>();

  return {
    ...actual,
    getGlobalConfig: () => ({ ...mockState.config }),
    saveGlobalConfig: vi.fn(),
  };
});

// Interactive-prompt seams. By default isInteractive() falls through to the real
// implementation; individual tests flip `interactiveState.value` to drive the
// interactive legacy-cleanup / tool-selection branches without a real TTY.
const { confirmMock, searchableMultiSelectMock, interactiveState } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  searchableMultiSelectMock: vi.fn(),
  interactiveState: { value: null as boolean | null },
}));

vi.mock('@inquirer/prompts', () => ({
  confirm: confirmMock,
}));

vi.mock('../../src/prompts/searchable-multi-select.js', () => ({
  searchableMultiSelect: searchableMultiSelectMock,
}));

vi.mock('../../src/utils/interactive.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/interactive.js')>();
  return {
    ...actual,
    isInteractive: (value?: boolean | import('../../src/utils/interactive.js').InteractiveOptions) =>
      interactiveState.value === null ? actual.isInteractive(value) : interactiveState.value,
  };
});

// Helper to set mock config for tests
function setMockConfig(config: GlobalConfig) {
  mockState.config = config;
}

function resetMockConfig() {
  mockState.config = { featureFlags: {}, profile: 'core', delivery: 'both' };
}

describe('UpdateCommand', () => {
  let testDir: string;
  let updateCommand: UpdateCommand;

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = path.join(os.tmpdir(), `ratchet-test-${randomUUID()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Create ratchet directory
    const ratchetDir = path.join(testDir, '.ratchet');
    await fs.mkdir(ratchetDir, { recursive: true });

    updateCommand = new UpdateCommand();

    // Reset mock config to defaults
    resetMockConfig();

    // Reset interactive-prompt seams; default to the real isInteractive().
    interactiveState.value = null;
    confirmMock.mockReset();
    searchableMultiSelectMock.mockReset();

    // Clear all mocks before each test
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    // Restore all mocks after each test
    vi.restoreAllMocks();
    interactiveState.value = null;

    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('basic validation', () => {
    it('should throw error if ratchet directory does not exist', async () => {
      // Remove ratchet directory
      await fs.rm(path.join(testDir, '.ratchet'), {
        recursive: true,
        force: true,
      });

      await expect(updateCommand.execute(testDir)).rejects.toThrow(
        "No Ratchet directory found. Run 'ratchet init' first."
      );
    });

    it('should report no configured tools when none exist', async () => {
      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No configured tools found')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('skill updates', () => {
    it('should update skill files for configured Claude tool', async () => {
      // Set up a configured Claude tool by creating skill directories
      const skillsDir = path.join(testDir, '.claude', 'skills');
      const exploreSkillDir = path.join(skillsDir, 'ratchet-propose');
      await fs.mkdir(exploreSkillDir, { recursive: true });

      // Create an existing skill file
      const oldSkillContent = `---
name: ratchet-propose (old)
description: Old description
license: MIT
compatibility: Requires ratchet CLI.
metadata:
  author: ratchet
  version: "0.9"
---

Old instructions content
`;
      await fs.writeFile(
        path.join(exploreSkillDir, 'SKILL.md'),
        oldSkillContent
      );

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Check skill file was updated
      const updatedSkill = await fs.readFile(
        path.join(exploreSkillDir, 'SKILL.md'),
        'utf-8'
      );
      expect(updatedSkill).toContain('name: ratchet-propose');
      expect(updatedSkill).not.toContain('Old instructions content');
      expect(updatedSkill).toContain('license: MIT');

      // Check console output
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updating 1 tool(s): claude')
      );

      consoleSpy.mockRestore();
    });

    it('should update core profile skill files when tool is configured', async () => {
      // Set up a configured tool with one skill directory
      const skillsDir = path.join(testDir, '.claude', 'skills');

      // Create at least one skill to mark tool as configured
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        'old content'
      );

      await updateCommand.execute(testDir);

      // Verify core profile skill files were created/updated (propose, apply, verify, archive)
      const coreSkillNames = [
        'ratchet-propose',
        'ratchet-apply-change',
        'ratchet-verify-change',
        'ratchet-archive-change',
      ];

      for (const skillName of coreSkillNames) {
        const skillFile = path.join(skillsDir, skillName, 'SKILL.md');
        const exists = await FileSystemUtils.fileExists(skillFile);
        expect(exists).toBe(true);

        const content = await fs.readFile(skillFile, 'utf-8');
        expect(content).toContain('---');
        expect(content).toContain('name:');
        expect(content).toContain('description:');
      }

      // Verify non-core / internal-only skills are NOT created
      const nonCoreSkillNames = [
        'ratchet-explore',
        'ratchet-new-change',
        'ratchet-continue-change',
        'ratchet-ff-change',
        'ratchet-bulk-archive-change',
      ];

      for (const skillName of nonCoreSkillNames) {
        const skillFile = path.join(skillsDir, skillName, 'SKILL.md');
        const exists = await FileSystemUtils.fileExists(skillFile);
        expect(exists).toBe(false);
      }
    });
  });

  describe('command updates', () => {
    it('should update rct commands for configured Claude tool', async () => {
      // Set up a configured Claude tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        'old content'
      );

      await updateCommand.execute(testDir);

      // Check rct command files were created
      const commandsDir = path.join(testDir, '.claude', 'commands', 'rct');
      const exploreCmd = path.join(commandsDir, 'propose.md');
      const exists = await FileSystemUtils.fileExists(exploreCmd);
      expect(exists).toBe(true);

      const content = await fs.readFile(exploreCmd, 'utf-8');
      expect(content).toContain('---');
      expect(content).toContain('name:');
      expect(content).toContain('description:');
      expect(content).toContain('category:');
      expect(content).toContain('tags:');
    });

    it('should update core profile rct commands when tool is configured', async () => {
      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        'old content'
      );

      await updateCommand.execute(testDir);

      // Verify core profile commands were created (propose, apply, verify, archive)
      const coreCommandIds = ['propose', 'apply', 'verify', 'archive'];
      const commandsDir = path.join(testDir, '.claude', 'commands', 'rct');
      for (const cmdId of coreCommandIds) {
        const cmdFile = path.join(commandsDir, `${cmdId}.md`);
        const exists = await FileSystemUtils.fileExists(cmdFile);
        expect(exists).toBe(true);
      }

      // Verify non-core / internal-only commands are NOT created
      const nonCoreCommandIds = ['explore', 'new', 'continue', 'ff', 'bulk-archive'];
      for (const cmdId of nonCoreCommandIds) {
        const cmdFile = path.join(commandsDir, `${cmdId}.md`);
        const exists = await FileSystemUtils.fileExists(cmdFile);
        expect(exists).toBe(false);
      }
    });

  });

  describe('multi-tool support', () => {
    it('should update multiple configured tools', async () => {
      // Set up Claude
      const claudeSkillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(claudeSkillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(claudeSkillsDir, 'ratchet-propose', 'SKILL.md'),
        'old'
      );

      // Set up Cursor
      const cursorSkillsDir = path.join(testDir, '.cursor', 'skills');
      await fs.mkdir(path.join(cursorSkillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(cursorSkillsDir, 'ratchet-propose', 'SKILL.md'),
        'old'
      );

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Both tools should be updated
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updating 2 tool(s)')
      );

      // Verify Claude skills updated
      const claudeSkill = await fs.readFile(
        path.join(claudeSkillsDir, 'ratchet-propose', 'SKILL.md'),
        'utf-8'
      );
      expect(claudeSkill).toContain('name: ratchet-propose');

      // Verify Cursor skills updated
      const cursorSkill = await fs.readFile(
        path.join(cursorSkillsDir, 'ratchet-propose', 'SKILL.md'),
        'utf-8'
      );
      expect(cursorSkill).toContain('name: ratchet-propose');

      consoleSpy.mockRestore();
    });

    it('should update OpenCode tool with correct command format', async () => {
      // Set up OpenCode
      const opencodeSkillsDir = path.join(testDir, '.opencode', 'skills');
      await fs.mkdir(path.join(opencodeSkillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(opencodeSkillsDir, 'ratchet-propose', 'SKILL.md'),
        'old'
      );

      await updateCommand.execute(testDir);

      const opencodeCmd = path.join(
        testDir,
        '.opencode',
        'commands',
        'rct-propose.md'
      );
      const exists = await FileSystemUtils.fileExists(opencodeCmd);
      expect(exists).toBe(true);

      const content = await fs.readFile(opencodeCmd, 'utf-8');
      expect(content).toContain('---');
      expect(content).toContain('description:');
    });

    it('should update GitHub Copilot tool with correct command format', async () => {
      const ghSkillsDir = path.join(testDir, '.github', 'skills');
      await fs.mkdir(path.join(ghSkillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(ghSkillsDir, 'ratchet-propose', 'SKILL.md'),
        'old'
      );

      await updateCommand.execute(testDir);

      const ghCmd = path.join(
        testDir,
        '.github',
        'prompts',
        'rct-propose.prompt.md'
      );
      const exists = await FileSystemUtils.fileExists(ghCmd);
      expect(exists).toBe(true);

      const content = await fs.readFile(ghCmd, 'utf-8');
      expect(content).toContain('---');
      expect(content).toContain('description:');
    });
  });

  describe('error handling', () => {
    it('should handle tool update failures gracefully', async () => {
      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        'old'
      );

      // Mock writeFile to fail for skills
      const originalWriteFile = FileSystemUtils.writeFile.bind(FileSystemUtils);
      const writeSpy = vi
        .spyOn(FileSystemUtils, 'writeFile')
        .mockImplementation(async (filePath, content) => {
          if (filePath.includes('SKILL.md')) {
            throw new Error('EACCES: permission denied');
          }
          return originalWriteFile(filePath, content);
        });

      const consoleSpy = vi.spyOn(console, 'log');

      // Should not throw
      await updateCommand.execute(testDir);

      // Should report failure
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed')
      );

      writeSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it('should continue updating other tools when one fails', async () => {
      // Set up Claude and Cursor
      const claudeSkillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(claudeSkillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(claudeSkillsDir, 'ratchet-propose', 'SKILL.md'),
        'old'
      );

      const cursorSkillsDir = path.join(testDir, '.cursor', 'skills');
      await fs.mkdir(path.join(cursorSkillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(cursorSkillsDir, 'ratchet-propose', 'SKILL.md'),
        'old'
      );

      // Mock writeFile to fail only for Claude
      const originalWriteFile = FileSystemUtils.writeFile.bind(FileSystemUtils);
      const writeSpy = vi
        .spyOn(FileSystemUtils, 'writeFile')
        .mockImplementation(async (filePath, content) => {
          if (filePath.includes('.claude') && filePath.includes('SKILL.md')) {
            throw new Error('EACCES: permission denied');
          }
          return originalWriteFile(filePath, content);
        });

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Cursor should still be updated - check the actual format from ora spinner
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updated: Cursor')
      );

      // Claude should be reported as failed
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed')
      );

      writeSpy.mockRestore();
      consoleSpy.mockRestore();
    });
  });

  describe('tool detection', () => {
    it('should detect tool as configured only when skill file exists', async () => {
      // Create skills directory but no skill files
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(skillsDir, { recursive: true });

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Should report no configured tools
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No configured tools found')
      );

      consoleSpy.mockRestore();
    });

    it('should detect tool when any single skill exists', async () => {
      // Create only one skill file
      const skillDir = path.join(
        testDir,
        '.claude',
        'skills',
        'ratchet-archive-change'
      );
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'old');

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Should detect and update Claude
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updating 1 tool(s): claude')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('skill content validation', () => {
    it('should generate valid YAML frontmatter in skill files', async () => {
      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        'old'
      );

      await updateCommand.execute(testDir);

      const skillContent = await fs.readFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        'utf-8'
      );

      // Validate frontmatter structure
      expect(skillContent).toMatch(/^---\n/);
      expect(skillContent).toContain('name:');
      expect(skillContent).toContain('description:');
      expect(skillContent).toContain('license:');
      expect(skillContent).toContain('compatibility:');
      expect(skillContent).toContain('metadata:');
      expect(skillContent).toContain('author:');
      expect(skillContent).toContain('version:');
      expect(skillContent).toMatch(/---\n\n/);
    });

    it('should include proper instructions in skill files', async () => {
      // Set up a configured tool with apply-change skill (which is in core profile)
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-apply-change'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-apply-change', 'SKILL.md'),
        'old'
      );

      await updateCommand.execute(testDir);

      const skillContent = await fs.readFile(
        path.join(skillsDir, 'ratchet-apply-change', 'SKILL.md'),
        'utf-8'
      );

      // Apply skill should contain implementation instructions
      expect(skillContent.toLowerCase()).toContain('task');
    });
  });

  describe('success output', () => {
    it('should display success message with tool name', async () => {
      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        'old'
      );

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // The success output uses "✓ Updated: <name>"
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updated: Claude Code')
      );

      consoleSpy.mockRestore();
    });

    it('should suggest IDE restart after update', async () => {
      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        'old'
      );

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Restart your IDE')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('smart update detection', () => {
    it('should show "up to date" message when skills have current version', async () => {
      // Initialize full core profile output so there is no profile/delivery drift.
      const initCommand = new InitCommand({ tools: 'claude', force: true });
      await initCommand.execute(testDir);

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('up to date')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('--force')
      );

      consoleSpy.mockRestore();
    });

    it('should detect update needed when generatedBy is missing', async () => {
      // Set up a configured tool without generatedBy
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        `---
name: ratchet-propose
metadata:
  author: ratchet
  version: "1.0"
---

Legacy content without generatedBy
`
      );

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Should show "unknown → version" in the update message
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('unknown')
      );

      consoleSpy.mockRestore();
    });

    it('should detect update needed when version differs', async () => {
      // Set up a configured tool with old version
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        `---
name: ratchet-propose
metadata:
  generatedBy: "0.1.0"
---

Old version content
`
      );

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Should show version transition
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('0.1.0')
      );

      consoleSpy.mockRestore();
    });

    it('should embed generatedBy in updated skill files', async () => {
      // Set up a configured tool without generatedBy
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        'old content without version'
      );

      await updateCommand.execute(testDir);

      const updatedContent = await fs.readFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        'utf-8'
      );

      // Should contain generatedBy field (accepts an optional prerelease suffix,
      // e.g. "0.1.0" or "0.1.0-beta.0").
      expect(updatedContent).toMatch(/generatedBy:\s*["']\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?["']/);
    });
  });

  describe('--force flag', () => {
    it('should update when force is true even if up to date', async () => {
      // Set up a configured tool with current version
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), {
        recursive: true,
      });

      const { version } = await import('../../package.json');
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        `---
metadata:
  generatedBy: "${version}"
---
Content
`
      );

      const consoleSpy = vi.spyOn(console, 'log');

      // Create update command with force option
      const forceUpdateCommand = new UpdateCommand({ force: true });
      await forceUpdateCommand.execute(testDir);

      // Should show "Force updating" message
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Force updating')
      );

      // Should show updated message
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updated: Claude Code')
      );

      consoleSpy.mockRestore();
    });

    it('should not show --force hint when force is used', async () => {
      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        'old content'
      );

      const consoleSpy = vi.spyOn(console, 'log');

      const forceUpdateCommand = new UpdateCommand({ force: true });
      await forceUpdateCommand.execute(testDir);

      // Get all console.log calls as strings
      const allCalls = consoleSpy.mock.calls.map(call =>
        call.map(arg => String(arg)).join(' ')
      );

      // Should not show "Use --force" since force was used
      const hasForceHint = allCalls.some(call => call.includes('Use --force'));
      expect(hasForceHint).toBe(false);

      consoleSpy.mockRestore();
    });

    it('should update all tools when force is used with mixed versions', async () => {
      // Set up Claude with current version
      const { version } = await import('../../package.json');
      const claudeSkillDir = path.join(testDir, '.claude', 'skills', 'ratchet-propose');
      await fs.mkdir(claudeSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(claudeSkillDir, 'SKILL.md'),
        `---
metadata:
  generatedBy: "${version}"
---
`
      );

      // Set up Cursor with old version
      const cursorSkillDir = path.join(testDir, '.cursor', 'skills', 'ratchet-propose');
      await fs.mkdir(cursorSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(cursorSkillDir, 'SKILL.md'),
        `---
metadata:
  generatedBy: "0.1.0"
---
`
      );

      const consoleSpy = vi.spyOn(console, 'log');

      const forceUpdateCommand = new UpdateCommand({ force: true });
      await forceUpdateCommand.execute(testDir);

      // Should show both tools being force updated
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Force updating 2 tool(s)')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('version tracking', () => {
    it('should show version in success message', async () => {
      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        'old'
      );

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Should show version in success message
      const { version } = await import('../../package.json');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(`(v${version})`)
      );

      consoleSpy.mockRestore();
    });

    it('should only update tools that need updating', async () => {
      // Initialize both tools so Cursor is fully synced with profile/delivery.
      const initCommand = new InitCommand({ tools: 'claude,cursor', force: true });
      await initCommand.execute(testDir);

      // Make Claude stale to force a version update. The version check reads the
      // first generated skill in SKILL_NAMES order (propose), so stale that file.
      const claudeSkillFile = path.join(testDir, '.claude', 'skills', 'ratchet-propose', 'SKILL.md');
      const claudeContent = await fs.readFile(claudeSkillFile, 'utf-8');
      await fs.writeFile(
        claudeSkillFile,
        claudeContent.replace(/generatedBy:\s*["'][^"']+["']/, 'generatedBy: "0.0.0"')
      );

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Should show only Claude being updated
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updating 1 tool(s)')
      );

      // Should mention Cursor is already up to date
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Already up to date: cursor')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('legacy cleanup', () => {
    it('should detect and auto-cleanup legacy files with --force flag', async () => {
      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        'old'
      );

      // Create legacy CLAUDE.md with Ratchet markers
      const legacyContent = `${RATCHET_MARKERS.start}
# Ratchet Instructions

These instructions are for AI assistants.
${RATCHET_MARKERS.end}
`;
      await fs.writeFile(path.join(testDir, 'CLAUDE.md'), legacyContent);

      const consoleSpy = vi.spyOn(console, 'log');

      // Create update command with force option
      const forceUpdateCommand = new UpdateCommand({ force: true });
      await forceUpdateCommand.execute(testDir);

      // Should show v1 upgrade message
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Upgrading to the new Ratchet')
      );

      // Should show marker removal message (config files are never deleted, only have markers removed)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Removed Ratchet markers from CLAUDE.md')
      );

      // Config file should still exist (never deleted)
      const legacyExists = await FileSystemUtils.fileExists(
        path.join(testDir, 'CLAUDE.md')
      );
      expect(legacyExists).toBe(true);

      // File should have markers removed
      const content = await fs.readFile(path.join(testDir, 'CLAUDE.md'), 'utf-8');
      expect(content).not.toContain(RATCHET_MARKERS.start);
      expect(content).not.toContain(RATCHET_MARKERS.end);

      consoleSpy.mockRestore();
    });

    it('should warn but continue with update when legacy files found in non-interactive mode', async () => {
      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        'old'
      );

      // Create legacy CLAUDE.md with Ratchet markers
      const legacyContent = `${RATCHET_MARKERS.start}
# Ratchet Instructions
${RATCHET_MARKERS.end}
`;
      await fs.writeFile(path.join(testDir, 'CLAUDE.md'), legacyContent);

      const consoleSpy = vi.spyOn(console, 'log');

      // Run without --force in non-interactive mode (CI environment)
      await updateCommand.execute(testDir);

      // Should show v1 upgrade message
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Upgrading to the new Ratchet')
      );

      // Should show warning about --force
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Run with --force to auto-cleanup')
      );

      // Should continue with update
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updated: Claude Code')
      );

      // Legacy file should still exist (not cleaned up)
      const legacyExists = await FileSystemUtils.fileExists(
        path.join(testDir, 'CLAUDE.md')
      );
      expect(legacyExists).toBe(true);

      consoleSpy.mockRestore();
    });

    it('should cleanup legacy slash command directories with --force', async () => {
      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        'old'
      );

      // Create legacy slash command directory
      const legacyCommandDir = path.join(testDir, '.claude', 'commands', 'ratchet');
      await fs.mkdir(legacyCommandDir, { recursive: true });
      await fs.writeFile(
        path.join(legacyCommandDir, 'old-command.md'),
        'old command'
      );

      const consoleSpy = vi.spyOn(console, 'log');

      // Create update command with force option
      const forceUpdateCommand = new UpdateCommand({ force: true });
      await forceUpdateCommand.execute(testDir);

      // Should show cleanup message for directory
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Removed .claude/commands/ratchet/')
      );

      // Legacy directory should be deleted
      const legacyDirExists = await FileSystemUtils.directoryExists(legacyCommandDir);
      expect(legacyDirExists).toBe(false);

      consoleSpy.mockRestore();
    });

    it('should cleanup legacy .ratchet/AGENTS.md with --force', async () => {
      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        'old'
      );

      // Create legacy .ratchet/AGENTS.md
      await fs.writeFile(
        path.join(testDir, '.ratchet', 'AGENTS.md'),
        '# Old AGENTS.md content'
      );

      const consoleSpy = vi.spyOn(console, 'log');

      // Create update command with force option
      const forceUpdateCommand = new UpdateCommand({ force: true });
      await forceUpdateCommand.execute(testDir);

      // Should show cleanup message
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Removed .ratchet/AGENTS.md')
      );

      // Legacy file should be deleted
      const legacyExists = await FileSystemUtils.fileExists(
        path.join(testDir, '.ratchet', 'AGENTS.md')
      );
      expect(legacyExists).toBe(false);

      consoleSpy.mockRestore();
    });

    it('should not show legacy cleanup messages when no legacy files exist', async () => {
      // Set up a configured tool with no legacy files
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        'old'
      );

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Should not show v1 upgrade message (no legacy files)
      const calls = consoleSpy.mock.calls.map(call =>
        call.map(arg => String(arg)).join(' ')
      );
      const hasLegacyMessage = calls.some(call =>
        call.includes('Upgrading to the new Ratchet')
      );
      expect(hasLegacyMessage).toBe(false);

      consoleSpy.mockRestore();
    });

    it('should remove Ratchet marker block from mixed content files', async () => {
      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        'old'
      );

      // Create CLAUDE.md with mixed content (user content + Ratchet markers)
      const mixedContent = `# My Project

Some user-defined instructions here.

${RATCHET_MARKERS.start}
# Ratchet Instructions

These instructions are for AI assistants.
${RATCHET_MARKERS.end}

More user content after markers.
`;
      await fs.writeFile(path.join(testDir, 'CLAUDE.md'), mixedContent);

      const consoleSpy = vi.spyOn(console, 'log');

      // Create update command with force option
      const forceUpdateCommand = new UpdateCommand({ force: true });
      await forceUpdateCommand.execute(testDir);

      // Should show marker removal message
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Removed Ratchet markers from CLAUDE.md')
      );

      // File should still exist
      const fileExists = await FileSystemUtils.fileExists(
        path.join(testDir, 'CLAUDE.md')
      );
      expect(fileExists).toBe(true);

      // File should have markers removed but preserve user content
      const updatedContent = await fs.readFile(
        path.join(testDir, 'CLAUDE.md'),
        'utf-8'
      );
      expect(updatedContent).toContain('# My Project');
      expect(updatedContent).toContain('Some user-defined instructions here');
      expect(updatedContent).toContain('More user content after markers');
      expect(updatedContent).not.toContain(RATCHET_MARKERS.start);
      expect(updatedContent).not.toContain(RATCHET_MARKERS.end);

      consoleSpy.mockRestore();
    });
  });

  describe('legacy tool upgrade', () => {
    it('should upgrade legacy tools to new skills with --force', async () => {
      // Create legacy slash command directory (no skills exist yet)
      const legacyCommandDir = path.join(testDir, '.claude', 'commands', 'ratchet');
      await fs.mkdir(legacyCommandDir, { recursive: true });
      await fs.writeFile(
        path.join(legacyCommandDir, 'proposal.md'),
        'old command content'
      );

      const consoleSpy = vi.spyOn(console, 'log');

      // Create update command with force option
      const forceUpdateCommand = new UpdateCommand({ force: true });
      await forceUpdateCommand.execute(testDir);

      // Should show detected tools message
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Tools detected from legacy artifacts')
      );

      // Should show Claude Code being set up
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Claude Code')
      );

      // Should show getting started message for newly configured tools
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Getting started')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('/rct:propose')
      );

      // Skills should be created
      const skillFile = path.join(testDir, '.claude', 'skills', 'ratchet-propose', 'SKILL.md');
      const skillExists = await FileSystemUtils.fileExists(skillFile);
      expect(skillExists).toBe(true);

      // Legacy directory should be deleted
      const legacyDirExists = await FileSystemUtils.directoryExists(legacyCommandDir);
      expect(legacyDirExists).toBe(false);

      consoleSpy.mockRestore();
    });

    it('should upgrade multiple legacy tools with --force', async () => {
      // Create legacy command directories for Claude and Cursor
      await fs.mkdir(path.join(testDir, '.claude', 'commands', 'ratchet'), { recursive: true });
      await fs.writeFile(
        path.join(testDir, '.claude', 'commands', 'ratchet', 'proposal.md'),
        'content'
      );

      await fs.mkdir(path.join(testDir, '.cursor', 'commands'), { recursive: true });
      await fs.writeFile(
        path.join(testDir, '.cursor', 'commands', 'ratchet-proposal.md'),
        'content'
      );

      const consoleSpy = vi.spyOn(console, 'log');

      // Create update command with force option
      const forceUpdateCommand = new UpdateCommand({ force: true });
      await forceUpdateCommand.execute(testDir);

      // Should detect both tools
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Tools detected from legacy artifacts')
      );

      // Both tools should have skills created
      const claudeSkillFile = path.join(testDir, '.claude', 'skills', 'ratchet-propose', 'SKILL.md');
      const cursorSkillFile = path.join(testDir, '.cursor', 'skills', 'ratchet-propose', 'SKILL.md');

      expect(await FileSystemUtils.fileExists(claudeSkillFile)).toBe(true);
      expect(await FileSystemUtils.fileExists(cursorSkillFile)).toBe(true);

      consoleSpy.mockRestore();
    });

    it('should not upgrade legacy tools already configured', async () => {
      // Set up a configured Claude tool with skills
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), { recursive: true });
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        'existing skill'
      );

      // Also create legacy directory (simulating partial upgrade)
      const legacyCommandDir = path.join(testDir, '.claude', 'commands', 'ratchet');
      await fs.mkdir(legacyCommandDir, { recursive: true });
      await fs.writeFile(
        path.join(legacyCommandDir, 'proposal.md'),
        'old command'
      );

      const consoleSpy = vi.spyOn(console, 'log');

      // Create update command with force option
      const forceUpdateCommand = new UpdateCommand({ force: true });
      await forceUpdateCommand.execute(testDir);

      // Legacy cleanup should happen
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Removed .claude/commands/ratchet/')
      );

      // Should NOT show "Tools detected from legacy artifacts" because claude is already configured
      const calls = consoleSpy.mock.calls.map(call =>
        call.map(arg => String(arg)).join(' ')
      );
      const hasDetectedMessage = calls.some(call =>
        call.includes('Tools detected from legacy artifacts')
      );
      expect(hasDetectedMessage).toBe(false);

      // Should update existing skills (not "Getting started" for newly configured)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updated: Claude Code')
      );

      consoleSpy.mockRestore();
    });

    it('should upgrade only unconfigured legacy tools when mixed', async () => {
      // Set up configured Claude tool with skills
      const claudeSkillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(claudeSkillsDir, 'ratchet-propose'), { recursive: true });
      await fs.writeFile(
        path.join(claudeSkillsDir, 'ratchet-propose', 'SKILL.md'),
        'existing skill'
      );

      // Create legacy commands for both Claude (configured) and Cursor (not configured)
      await fs.mkdir(path.join(testDir, '.claude', 'commands', 'ratchet'), { recursive: true });
      await fs.writeFile(
        path.join(testDir, '.claude', 'commands', 'ratchet', 'proposal.md'),
        'content'
      );

      await fs.mkdir(path.join(testDir, '.cursor', 'commands'), { recursive: true });
      await fs.writeFile(
        path.join(testDir, '.cursor', 'commands', 'ratchet-proposal.md'),
        'content'
      );

      const consoleSpy = vi.spyOn(console, 'log');

      // Create update command with force option
      const forceUpdateCommand = new UpdateCommand({ force: true });
      await forceUpdateCommand.execute(testDir);

      // Should detect Cursor as a legacy tool to upgrade (but not Claude)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Tools detected from legacy artifacts')
      );

      // Cursor skills should be created
      const cursorSkillFile = path.join(testDir, '.cursor', 'skills', 'ratchet-propose', 'SKILL.md');
      expect(await FileSystemUtils.fileExists(cursorSkillFile)).toBe(true);

      // Should show "Getting started" for newly configured Cursor
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Getting started')
      );

      consoleSpy.mockRestore();
    });

    it('should not show getting started message when no new tools configured', async () => {
      // Set up a configured tool (no legacy artifacts)
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), { recursive: true });
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        'old skill'
      );

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Should NOT show "Getting started" message
      const calls = consoleSpy.mock.calls.map(call =>
        call.map(arg => String(arg)).join(' ')
      );
      const hasGettingStarted = calls.some(call =>
        call.includes('Getting started')
      );
      expect(hasGettingStarted).toBe(false);

      consoleSpy.mockRestore();
    });

    it('should create only effective profile skills when upgrading legacy tools', async () => {
      // Create legacy command directory
      await fs.mkdir(path.join(testDir, '.claude', 'commands', 'ratchet'), { recursive: true });
      await fs.writeFile(
        path.join(testDir, '.claude', 'commands', 'ratchet', 'proposal.md'),
        'content'
      );

      // Create update command with force option
      const forceUpdateCommand = new UpdateCommand({ force: true });
      await forceUpdateCommand.execute(testDir);

      // Default profile is core, so only core workflows should be generated.
      const skillNames = [
        'ratchet-propose',
        'ratchet-apply-change',
        'ratchet-verify-change',
        'ratchet-archive-change',
      ];

      const skillsDir = path.join(testDir, '.claude', 'skills');
      for (const skillName of skillNames) {
        const skillFile = path.join(skillsDir, skillName, 'SKILL.md');
        const exists = await FileSystemUtils.fileExists(skillFile);
        expect(exists).toBe(true);
      }

      const nonCoreSkill = path.join(skillsDir, 'ratchet-new-change', 'SKILL.md');
      expect(await FileSystemUtils.fileExists(nonCoreSkill)).toBe(false);
    });

    it('should create commands when upgrading legacy tools', async () => {
      // Create legacy command directory
      await fs.mkdir(path.join(testDir, '.claude', 'commands', 'ratchet'), { recursive: true });
      await fs.writeFile(
        path.join(testDir, '.claude', 'commands', 'ratchet', 'proposal.md'),
        'content'
      );

      // Create update command with force option
      const forceUpdateCommand = new UpdateCommand({ force: true });
      await forceUpdateCommand.execute(testDir);

      // New rct commands should be created
      const commandsDir = path.join(testDir, '.claude', 'commands', 'rct');
      const exploreCmd = path.join(commandsDir, 'propose.md');
      const exists = await FileSystemUtils.fileExists(exploreCmd);
      expect(exists).toBe(true);
    });

    it('should not inject non-profile workflows when upgrading legacy tools', async () => {
      setMockConfig({
        featureFlags: {},
        profile: 'custom',
        delivery: 'both',
        workflows: ['apply'],
      });

      await fs.mkdir(path.join(testDir, '.claude', 'commands', 'ratchet'), { recursive: true });
      await fs.writeFile(
        path.join(testDir, '.claude', 'commands', 'ratchet', 'proposal.md'),
        'content'
      );

      const forceUpdateCommand = new UpdateCommand({ force: true });
      await forceUpdateCommand.execute(testDir);

      const skillsDir = path.join(testDir, '.claude', 'skills');
      expect(await FileSystemUtils.fileExists(
        path.join(skillsDir, 'ratchet-apply-change', 'SKILL.md')
      )).toBe(true);
      expect(await FileSystemUtils.fileExists(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md')
      )).toBe(false);

      const commandsDir = path.join(testDir, '.claude', 'commands', 'rct');
      expect(await FileSystemUtils.fileExists(
        path.join(commandsDir, 'apply.md')
      )).toBe(true);
      expect(await FileSystemUtils.fileExists(
        path.join(commandsDir, 'propose.md')
      )).toBe(false);
    });
  });

  describe('profile-aware updates', () => {
    it('should generate only profile workflows when custom profile is set', async () => {
      // Set custom profile with only apply and verify
      setMockConfig({
        featureFlags: {},
        profile: 'custom',
        delivery: 'both',
        workflows: ['apply', 'verify'],
      });

      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-apply-change'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'ratchet-apply-change', 'SKILL.md'), 'old');

      await updateCommand.execute(testDir);

      // Should create apply and verify skills
      expect(await FileSystemUtils.fileExists(
        path.join(skillsDir, 'ratchet-apply-change', 'SKILL.md')
      )).toBe(true);
      expect(await FileSystemUtils.fileExists(
        path.join(skillsDir, 'ratchet-verify-change', 'SKILL.md')
      )).toBe(true);

      // Should NOT create non-profile skills
      expect(await FileSystemUtils.fileExists(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md')
      )).toBe(false);
    });

    it('should respect skills-only delivery setting', async () => {
      setMockConfig({
        featureFlags: {},
        profile: 'core',
        delivery: 'skills',
      });

      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'ratchet-propose', 'SKILL.md'), 'old');

      await updateCommand.execute(testDir);

      // Skills should be created
      expect(await FileSystemUtils.fileExists(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md')
      )).toBe(true);

      // Commands should NOT be created
      const commandsDir = path.join(testDir, '.claude', 'commands', 'rct');
      expect(await FileSystemUtils.fileExists(
        path.join(commandsDir, 'propose.md')
      )).toBe(false);
    });

    it('should respect commands-only delivery setting', async () => {
      setMockConfig({
        featureFlags: {},
        profile: 'core',
        delivery: 'commands',
      });

      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'ratchet-propose', 'SKILL.md'), 'old');

      await updateCommand.execute(testDir);

      // Commands should be created
      const commandsDir = path.join(testDir, '.claude', 'commands', 'rct');
      expect(await FileSystemUtils.fileExists(
        path.join(commandsDir, 'propose.md')
      )).toBe(true);

      // Skills should be removed for commands-only delivery
      expect(await FileSystemUtils.fileExists(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md')
      )).toBe(false);
    });

    it('should apply config sync when templates are up to date', async () => {
      setMockConfig({
        featureFlags: {},
        profile: 'core',
        delivery: 'skills',
      });

      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), { recursive: true });
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8')) as { version: string };
      await fs.writeFile(
        path.join(skillsDir, 'ratchet-propose', 'SKILL.md'),
        `---
name: ratchet-propose
metadata:
  generatedBy: "${packageJson.version}"
---
content
`
      );

      const commandsDir = path.join(testDir, '.claude', 'commands', 'rct');
      await fs.mkdir(commandsDir, { recursive: true });
      await fs.writeFile(path.join(commandsDir, 'propose.md'), 'old command');

      await updateCommand.execute(testDir);

      // Command files should be removed due to delivery change, even though skill version is current
      expect(await FileSystemUtils.fileExists(
        path.join(commandsDir, 'propose.md')
      )).toBe(false);
    });

    it('should detect commands-only tool configuration', async () => {
      setMockConfig({
        featureFlags: {},
        profile: 'core',
        delivery: 'commands',
      });

      const commandsDir = path.join(testDir, '.claude', 'commands', 'rct');
      await fs.mkdir(commandsDir, { recursive: true });
      await fs.writeFile(path.join(commandsDir, 'propose.md'), 'existing command');

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Should not short-circuit with "No configured tools found"
      const calls = consoleSpy.mock.calls.map(call =>
        call.map(arg => String(arg)).join(' ')
      );
      const hasNoConfiguredMessage = calls.some(call =>
        call.includes('No configured tools found')
      );
      expect(hasNoConfiguredMessage).toBe(false);

      // Commands should be updated/generated for the core profile
      expect(await FileSystemUtils.fileExists(
        path.join(commandsDir, 'propose.md')
      )).toBe(true);

      consoleSpy.mockRestore();
    });

    it('should remove workflows outside profile during update sync', async () => {
      // Custom profile selecting only propose; verify is deselected.
      setMockConfig({
        featureFlags: {},
        profile: 'custom',
        delivery: 'both',
        workflows: ['propose'],
      });

      // Set up tool with an extra (deselected) workflow beyond the profile
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'ratchet-propose', 'SKILL.md'), 'old');

      // Add a deselected workflow (verify) that is still a known workflow
      await fs.mkdir(path.join(skillsDir, 'ratchet-verify-change'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'ratchet-verify-change', 'SKILL.md'), 'old');
      const extraCommandFile = path.join(testDir, '.claude', 'commands', 'rct', 'verify.md');
      await fs.mkdir(path.dirname(extraCommandFile), { recursive: true });
      await fs.writeFile(extraCommandFile, 'old');

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Deselected workflow artifacts should be removed for both delivery surfaces.
      expect(await FileSystemUtils.fileExists(
        path.join(skillsDir, 'ratchet-verify-change', 'SKILL.md')
      )).toBe(false);
      expect(await FileSystemUtils.fileExists(extraCommandFile)).toBe(false);

      // Should report deselected workflow cleanup.
      const calls = consoleSpy.mock.calls.map(call =>
        call.map(arg => String(arg)).join(' ')
      );
      const hasDeselectedRemovalNote = calls.some(call =>
        call.includes('deselected workflows')
      );
      expect(hasDeselectedRemovalNote).toBe(true);

      consoleSpy.mockRestore();
    });
  });

  describe('new tool detection', () => {
    it('should detect new tool directories not currently configured', async () => {
      // Set up a configured Claude tool
      const claudeSkillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(claudeSkillsDir, 'ratchet-propose'), { recursive: true });
      await fs.writeFile(path.join(claudeSkillsDir, 'ratchet-propose', 'SKILL.md'), 'old');

      // Create a Cursor directory (not configured — no skills)
      await fs.mkdir(path.join(testDir, '.cursor'), { recursive: true });

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Should detect Cursor as a new tool
      const calls = consoleSpy.mock.calls.map(call =>
        call.map(arg => String(arg)).join(' ')
      );
      const hasNewToolMessage = calls.some(call =>
        call.includes("Detected new tool: Cursor. Run 'ratchet init' to add it.")
      );
      expect(hasNewToolMessage).toBe(true);

      consoleSpy.mockRestore();
    });

    it('should consolidate multiple new tools into one message', async () => {
      // Set up a configured Claude tool
      const claudeSkillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(claudeSkillsDir, 'ratchet-propose'), { recursive: true });
      await fs.writeFile(path.join(claudeSkillsDir, 'ratchet-propose', 'SKILL.md'), 'old');

      // Create two unconfigured tool directories
      await fs.mkdir(path.join(testDir, '.github'), { recursive: true });
      await fs.writeFile(path.join(testDir, '.github', 'copilot-instructions.md'), '');
      await fs.mkdir(path.join(testDir, '.opencode'), { recursive: true });

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      const calls = consoleSpy.mock.calls.map(call =>
        call.map(arg => String(arg)).join(' ')
      );

      const consolidatedCalls = calls.filter(call =>
        call.includes('Detected new tools:')
      );
      expect(consolidatedCalls).toHaveLength(1);
      expect(consolidatedCalls[0]).toContain('GitHub Copilot');
      expect(consolidatedCalls[0]).toContain('OpenCode');
      expect(consolidatedCalls[0]).toContain("Run 'ratchet init' to add them.");

      const repeatedSingularCalls = calls.filter(call =>
        call.includes('Detected new tool:')
      );
      expect(repeatedSingularCalls).toHaveLength(0);

      consoleSpy.mockRestore();
    });

    it('should not show new tool message when no new tools detected', async () => {
      // Set up a configured tool (only Claude, no other tool directories)
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'ratchet-propose', 'SKILL.md'), 'old');

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      const calls = consoleSpy.mock.calls.map(call =>
        call.map(arg => String(arg)).join(' ')
      );
      const hasNewToolMessage = calls.some(call =>
        call.includes('Detected new tool')
      );
      expect(hasNewToolMessage).toBe(false);

      consoleSpy.mockRestore();
    });
  });

  describe('scanInstalledWorkflows', () => {
    it('should detect installed workflows across tools', async () => {
      // Create skills for Claude
      const claudeSkillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(claudeSkillsDir, 'ratchet-propose'), { recursive: true });
      await fs.writeFile(path.join(claudeSkillsDir, 'ratchet-propose', 'SKILL.md'), 'content');
      await fs.mkdir(path.join(claudeSkillsDir, 'ratchet-apply-change'), { recursive: true });
      await fs.writeFile(path.join(claudeSkillsDir, 'ratchet-apply-change', 'SKILL.md'), 'content');

      const workflows = scanInstalledWorkflows(testDir, ['claude']);
      expect(workflows).toContain('propose');
      expect(workflows).toContain('apply');
      expect(workflows).not.toContain('verify');
    });

    it('should return union of workflows across multiple tools', async () => {
      // Claude has propose
      const claudeSkillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(claudeSkillsDir, 'ratchet-propose'), { recursive: true });
      await fs.writeFile(path.join(claudeSkillsDir, 'ratchet-propose', 'SKILL.md'), 'content');

      // Cursor has apply
      const cursorSkillsDir = path.join(testDir, '.cursor', 'skills');
      await fs.mkdir(path.join(cursorSkillsDir, 'ratchet-apply-change'), { recursive: true });
      await fs.writeFile(path.join(cursorSkillsDir, 'ratchet-apply-change', 'SKILL.md'), 'content');

      const workflows = scanInstalledWorkflows(testDir, ['claude', 'cursor']);
      expect(workflows).toContain('propose');
      expect(workflows).toContain('apply');
    });

    it('should only match workflows in ALL_WORKFLOWS', async () => {
      // Create a custom skill directory that doesn't match any workflow
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'my-custom-skill'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'my-custom-skill', 'SKILL.md'), 'content');

      const workflows = scanInstalledWorkflows(testDir, ['claude']);
      expect(workflows).toHaveLength(0);
    });

    it('should return empty array when no tools have skills', async () => {
      const workflows = scanInstalledWorkflows(testDir, ['claude']);
      expect(workflows).toHaveLength(0);
    });

    it('should detect installed workflows from managed command files', async () => {
      const commandsDir = path.join(testDir, '.claude', 'commands', 'rct');
      await fs.mkdir(commandsDir, { recursive: true });
      await fs.writeFile(path.join(commandsDir, 'propose.md'), 'content');

      const workflows = scanInstalledWorkflows(testDir, ['claude']);
      expect(workflows).toContain('propose');
    });
  });

  describe('tools output', () => {
    it('should list affected tools in output', async () => {
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'ratchet-propose', 'SKILL.md'), 'old');

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      const calls = consoleSpy.mock.calls.map(call =>
        call.map(arg => String(arg)).join(' ')
      );
      const hasToolsList = calls.some(call =>
        call.includes('Tools:') && call.includes('Claude Code')
      );
      expect(hasToolsList).toBe(true);

      consoleSpy.mockRestore();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Legacy-cleanup decision branches & interactive legacy tool-selection.
  // Mirrors features/core-remainder-tests/init-update-remainders.feature
  //   - Scenario: update warns and continues when legacy cleanup needs --force
  //   - Scenario: declining update's interactive cleanup continues the skill update
  //   - Scenario: selecting no tools during update skips tool setup
  // ───────────────────────────────────────────────────────────────────────────
  describe('legacy-cleanup decision branches', () => {
    it('warns to re-run with --force or interactively and continues without cleaning up (non-interactive, no --force)', async () => {
      // Configured tool so the update proceeds past the "no tools" short-circuit.
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'ratchet-propose', 'SKILL.md'), 'old');

      // Legacy CLAUDE.md with Ratchet markers.
      await fs.writeFile(
        path.join(testDir, 'CLAUDE.md'),
        `${RATCHET_MARKERS.start}\n# Ratchet Instructions\n${RATCHET_MARKERS.end}\n`
      );

      // Force the non-interactive branch explicitly.
      interactiveState.value = false;

      const consoleSpy = vi.spyOn(console, 'log');

      // No --force, non-interactive.
      await updateCommand.execute(testDir);

      // Warns to re-run with --force / interactively.
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Run with --force to auto-cleanup legacy files, or run interactively.')
      );

      // Continues with the skill update.
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updated: Claude Code')
      );

      // No cleanup happened: legacy markers remain.
      const content = await fs.readFile(path.join(testDir, 'CLAUDE.md'), 'utf-8');
      expect(content).toContain(RATCHET_MARKERS.start);
      expect(content).toContain(RATCHET_MARKERS.end);

      consoleSpy.mockRestore();
    });

    it('skips cleanup and proceeds with the skill update when the interactive cleanup confirmation is declined', async () => {
      // Configured tool so the update proceeds.
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'ratchet-propose', 'SKILL.md'), 'old');

      // Legacy CLAUDE.md with Ratchet markers.
      await fs.writeFile(
        path.join(testDir, 'CLAUDE.md'),
        `${RATCHET_MARKERS.start}\n# Ratchet Instructions\n${RATCHET_MARKERS.end}\n`
      );

      // Interactive session; user declines the cleanup confirmation.
      interactiveState.value = true;
      confirmMock.mockResolvedValue(false);

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Confirmation was prompted and declined.
      expect(confirmMock).toHaveBeenCalledTimes(1);

      // Reports skipping cleanup but continuing the skill update.
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping legacy cleanup. Continuing with skill update...')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updated: Claude Code')
      );

      // Cleanup skipped: legacy markers remain.
      const content = await fs.readFile(path.join(testDir, 'CLAUDE.md'), 'utf-8');
      expect(content).toContain(RATCHET_MARKERS.start);
      expect(content).toContain(RATCHET_MARKERS.end);

      consoleSpy.mockRestore();
    });

    it('reports skipping tool setup when no tools are selected during the interactive legacy tool-selection', async () => {
      // Legacy slash-command directory (no skills yet) so update offers to set up
      // the detected legacy tool via the interactive multi-select.
      const legacyCommandDir = path.join(testDir, '.claude', 'commands', 'ratchet');
      await fs.mkdir(legacyCommandDir, { recursive: true });
      await fs.writeFile(path.join(legacyCommandDir, 'proposal.md'), 'old command');

      // Interactive session; accept cleanup, then select NO tools.
      interactiveState.value = true;
      confirmMock.mockResolvedValue(true);
      searchableMultiSelectMock.mockResolvedValue([]);

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // The legacy tool-selection prompt fired.
      expect(searchableMultiSelectMock).toHaveBeenCalledTimes(1);

      // Reports skipping tool setup.
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping tool setup.')
      );

      // No skills were generated for the deselected tool.
      const skillFile = path.join(testDir, '.claude', 'skills', 'ratchet-propose', 'SKILL.md');
      expect(await FileSystemUtils.fileExists(skillFile)).toBe(false);

      consoleSpy.mockRestore();
    });
  });
});
