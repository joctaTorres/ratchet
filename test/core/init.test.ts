import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { parse as parseYaml } from 'yaml';
import { InitCommand, type SandboxPermissionPrompts } from '../../src/core/init.js';
import { saveGlobalConfig, getGlobalConfig } from '../../src/core/global-config.js';
import { setProjectBatchPermissions } from '../../src/core/batch/config.js';
import { AI_TOOLS } from '../../src/core/config.js';
import { getToolsWithSkillsDir } from '../../src/core/shared/index.js';

const { confirmMock, selectMock, showWelcomeScreenMock, searchableMultiSelectMock, runDoctorAdvisoryMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  selectMock: vi.fn(),
  showWelcomeScreenMock: vi.fn().mockResolvedValue(undefined),
  searchableMultiSelectMock: vi.fn(),
  runDoctorAdvisoryMock: vi.fn(),
}));

vi.mock('../../src/commands/doctor.js', () => ({
  runDoctorAdvisory: runDoctorAdvisoryMock,
}));

vi.mock('@inquirer/prompts', () => ({
  confirm: confirmMock,
  select: selectMock,
}));

vi.mock('../../src/ui/welcome-screen.js', () => ({
  showWelcomeScreen: showWelcomeScreenMock,
}));

vi.mock('../../src/prompts/searchable-multi-select.js', () => ({
  searchableMultiSelect: searchableMultiSelectMock,
}));

describe('InitCommand', () => {
  let testDir: string;
  let configTempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-init-test-'));
    originalEnv = { ...process.env };
    // Use a temp dir for global config to avoid reading real config
    configTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-config-init-'));
    process.env.XDG_CONFIG_HOME = configTempDir;

    // Mock console.log to suppress output during tests
    vi.spyOn(console, 'log').mockImplementation(() => { });
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    selectMock.mockReset();
    selectMock.mockResolvedValue('repo-sandboxed-permissive');
    showWelcomeScreenMock.mockClear();
    searchableMultiSelectMock.mockReset();
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    await fs.rm(configTempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    vi.restoreAllMocks();
  });

  describe('execute with --tools flag', () => {
    it('should create Ratchet directory structure', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });

      await initCommand.execute(testDir);

      const ratchetPath = path.join(testDir, '.ratchet');
      expect(await directoryExists(ratchetPath)).toBe(true);
      expect(await directoryExists(path.join(ratchetPath, 'features'))).toBe(true);
      expect(await directoryExists(path.join(ratchetPath, 'standards'))).toBe(true);
      expect(await directoryExists(path.join(ratchetPath, 'changes'))).toBe(true);
      expect(await directoryExists(path.join(ratchetPath, 'changes', 'archive'))).toBe(true);
    });

    it('should create an empty standards directory', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });

      await initCommand.execute(testDir);

      const standardsPath = path.join(testDir, '.ratchet', 'standards');
      expect(await directoryExists(standardsPath)).toBe(true);
      expect(await fs.readdir(standardsPath)).toEqual([]);
    });

    it('should backfill the standards directory and preserve authored standards on re-init', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });
      await initCommand.execute(testDir);

      // Simulate an authored standard, then re-run init (extend mode)
      const standardsPath = path.join(testDir, '.ratchet', 'standards');
      const standardFile = path.join(standardsPath, 'testing.md');
      await fs.writeFile(standardFile, '# Testing\n\nEvery change has tests.');

      await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

      expect(await directoryExists(standardsPath)).toBe(true);
      expect(await fileExists(standardFile)).toBe(true);
      expect(await fs.readFile(standardFile, 'utf-8')).toContain('Every change has tests.');
    });

    it('should create config.yaml with default schema', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });

      await initCommand.execute(testDir);

      const configPath = path.join(testDir, '.ratchet', 'config.yaml');
      expect(await fileExists(configPath)).toBe(true);

      const content = await fs.readFile(configPath, 'utf-8');
      expect(content).toContain('schema: ratchet');
    });

    // features/eval-invariants/default-manifest.feature
    it('should create .ratchet/evals/invariants.yaml with spec-not-weakened active', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });

      await initCommand.execute(testDir);

      const manifestPath = path.join(testDir, '.ratchet', 'evals', 'invariants.yaml');
      expect(await fileExists(manifestPath)).toBe(true);

      const content = await fs.readFile(manifestPath, 'utf-8');
      const parsed = parseYaml(content);
      const specNotWeakened = parsed.invariants.find((i: any) => i.id === 'spec-not-weakened');
      expect(specNotWeakened).toBeDefined();
      expect(specNotWeakened.kind).toBe('monotonic');
      expect(specNotWeakened.active).toBe(true);
      expect(specNotWeakened.measure).toBe('scenario-count');
    });

    // features/ratchet-init/gitignore-eval-runs.feature
    it('should add .ratchet/evals/runs/ to a fresh project .gitignore', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });

      await initCommand.execute(testDir);

      const gitignorePath = path.join(testDir, '.gitignore');
      expect(await fileExists(gitignorePath)).toBe(true);
      const content = await fs.readFile(gitignorePath, 'utf-8');
      expect(content).toContain('.ratchet/evals/runs/');
    });

    // features/ratchet-init/gitignore-eval-runs.feature
    it('should not duplicate the eval-runs .gitignore entry on re-init', async () => {
      await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
      await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

      const gitignorePath = path.join(testDir, '.gitignore');
      const content = await fs.readFile(gitignorePath, 'utf-8');
      const occurrences = content.split('\n').filter((line) => line.trim() === '.ratchet/evals/runs/').length;
      expect(occurrences).toBe(1);
    });

    // features/ratchet-init/gitignore-eval-runs.feature
    it('should preserve an existing .gitignore and append the eval-runs entry only once', async () => {
      const gitignorePath = path.join(testDir, '.gitignore');
      await fs.writeFile(gitignorePath, 'node_modules/\ndist/\n');

      await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

      const content = await fs.readFile(gitignorePath, 'utf-8');
      expect(content).toContain('node_modules/');
      expect(content).toContain('dist/');
      const occurrences = content.split('\n').filter((line) => line.trim() === '.ratchet/evals/runs/').length;
      expect(occurrences).toBe(1);
    });

    it('should leave a user-edited invariants.yaml unchanged byte-for-byte on re-init', async () => {
      const initCommand1 = new InitCommand({ tools: 'claude', force: true });
      await initCommand1.execute(testDir);

      const manifestPath = path.join(testDir, '.ratchet', 'evals', 'invariants.yaml');
      const userEdited = 'invariants:\n  - id: spec-not-weakened\n    kind: monotonic\n    active: true\n    measure: scenario-count\n  - id: tests-still-exist\n    kind: deterministic\n    active: true\n    check:\n      run: "test -d test"\n';
      await fs.writeFile(manifestPath, userEdited);

      const initCommand2 = new InitCommand({ tools: 'claude', force: true });
      await initCommand2.execute(testDir);

      expect(await fs.readFile(manifestPath, 'utf-8')).toBe(userEdited);
    });

    it('should create core profile skills for Claude Code by default', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });

      await initCommand.execute(testDir);

      // Core profile: propose, apply, verify, archive, propose-standard, apply-batch, propose-batch
      const coreSkillNames = [
        'ratchet-propose',
        'ratchet-apply-change',
        'ratchet-verify-change',
        'ratchet-archive-change',
        'ratchet-propose-standard',
        'ratchet-apply-batch',
        'ratchet-archive-batch',
        'ratchet-propose-batch',
      ];

      for (const skillName of coreSkillNames) {
        const skillFile = path.join(testDir, '.claude', 'skills', skillName, 'SKILL.md');
        expect(await fileExists(skillFile)).toBe(true);

        const content = await fs.readFile(skillFile, 'utf-8');
        expect(content).toContain('---');
        expect(content).toContain('name:');
        expect(content).toContain('description:');
      }

      // Non-core / internal-only / opt-in skills should NOT be created.
      // eval stays opt-in; the batch workflows (apply-batch + propose-batch) ship by default.
      const nonCoreSkillNames = [
        'ratchet-explore',
        'ratchet-new-change',
        'ratchet-continue-change',
        'ratchet-ff-change',
        'ratchet-bulk-archive-change',
        'ratchet-eval',
      ];

      for (const skillName of nonCoreSkillNames) {
        const skillFile = path.join(testDir, '.claude', 'skills', skillName, 'SKILL.md');
        expect(await fileExists(skillFile)).toBe(false);
      }
    });

    it('should create core profile commands for Claude Code by default', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });

      await initCommand.execute(testDir);

      // Core profile: propose, apply, verify, archive, propose-standard, apply-batch, propose-batch
      const coreCommandNames = [
        'rct/propose.md',
        'rct/apply.md',
        'rct/verify.md',
        'rct/archive.md',
        'rct/propose-standard.md',
        'rct/apply-batch.md',
        'rct/archive-batch.md',
        'rct/propose-batch.md',
      ];

      for (const cmdName of coreCommandNames) {
        const cmdFile = path.join(testDir, '.claude', 'commands', cmdName);
        expect(await fileExists(cmdFile)).toBe(true);
      }

      // Non-core / internal-only / opt-in commands should NOT be created.
      // eval stays opt-in; the batch workflows (apply-batch + propose-batch) ship by default.
      const nonCoreCommandNames = [
        'rct/explore.md',
        'rct/new.md',
        'rct/continue.md',
        'rct/ff.md',
        'rct/bulk-archive.md',
        'rct/eval.md',
      ];

      for (const cmdName of nonCoreCommandNames) {
        const cmdFile = path.join(testDir, '.claude', 'commands', cmdName);
        expect(await fileExists(cmdFile)).toBe(false);
      }
    });

    it('should create skills in Cursor skills directory', async () => {
      const initCommand = new InitCommand({ tools: 'cursor', force: true });

      await initCommand.execute(testDir);

      const skillFile = path.join(testDir, '.cursor', 'skills', 'ratchet-propose', 'SKILL.md');
      expect(await fileExists(skillFile)).toBe(true);
    });

    it('should create skills in OpenCode skills directory', async () => {
      const initCommand = new InitCommand({ tools: 'opencode', force: true });

      await initCommand.execute(testDir);

      const skillFile = path.join(testDir, '.opencode', 'skills', 'ratchet-propose', 'SKILL.md');
      expect(await fileExists(skillFile)).toBe(true);
    });

    it('should create skills for multiple tools at once', async () => {
      const initCommand = new InitCommand({ tools: 'claude,cursor', force: true });

      await initCommand.execute(testDir);

      const claudeSkill = path.join(testDir, '.claude', 'skills', 'ratchet-propose', 'SKILL.md');
      const cursorSkill = path.join(testDir, '.cursor', 'skills', 'ratchet-propose', 'SKILL.md');

      expect(await fileExists(claudeSkill)).toBe(true);
      expect(await fileExists(cursorSkill)).toBe(true);
    });

    it('should select all tools with --tools all option', async () => {
      const initCommand = new InitCommand({ tools: 'all', force: true });

      await initCommand.execute(testDir);

      // Check a few representative tools
      const claudeSkill = path.join(testDir, '.claude', 'skills', 'ratchet-propose', 'SKILL.md');
      const cursorSkill = path.join(testDir, '.cursor', 'skills', 'ratchet-propose', 'SKILL.md');
      const opencodeSkill = path.join(testDir, '.opencode', 'skills', 'ratchet-propose', 'SKILL.md');

      expect(await fileExists(claudeSkill)).toBe(true);
      expect(await fileExists(cursorSkill)).toBe(true);
      expect(await fileExists(opencodeSkill)).toBe(true);
    });

    it('should skip tool configuration with --tools none option', async () => {
      const initCommand = new InitCommand({ tools: 'none', force: true });

      await initCommand.execute(testDir);

      // Should create Ratchet structure but no skills
      const ratchetPath = path.join(testDir, '.ratchet');
      expect(await directoryExists(ratchetPath)).toBe(true);

      // No tool-specific directories should be created
      const claudeSkillsDir = path.join(testDir, '.claude', 'skills');
      expect(await directoryExists(claudeSkillsDir)).toBe(false);
    });

    it('should throw error for invalid tool names', async () => {
      const initCommand = new InitCommand({ tools: 'invalid-tool', force: true });

      await expect(initCommand.execute(testDir)).rejects.toThrow(/Invalid tool\(s\): invalid-tool/);
    });

    it('should handle comma-separated tool names with spaces', async () => {
      const initCommand = new InitCommand({ tools: 'claude, cursor', force: true });

      await initCommand.execute(testDir);

      const claudeSkill = path.join(testDir, '.claude', 'skills', 'ratchet-propose', 'SKILL.md');
      const cursorSkill = path.join(testDir, '.cursor', 'skills', 'ratchet-propose', 'SKILL.md');

      expect(await fileExists(claudeSkill)).toBe(true);
      expect(await fileExists(cursorSkill)).toBe(true);
    });

    it('should reject combining reserved keywords with explicit tool ids', async () => {
      const initCommand = new InitCommand({ tools: 'all,claude', force: true });

      await expect(initCommand.execute(testDir)).rejects.toThrow(
        /Cannot combine reserved values "all" or "none" with specific tool IDs/
      );
    });

    it('should not create config.yaml if it already exists', async () => {
      // Pre-create config.yaml
      const ratchetDir = path.join(testDir, '.ratchet');
      await fs.mkdir(ratchetDir, { recursive: true });
      const configPath = path.join(ratchetDir, 'config.yaml');
      const existingContent = 'schema: custom-schema\n';
      await fs.writeFile(configPath, existingContent);

      const initCommand = new InitCommand({ tools: 'claude', force: true });
      await initCommand.execute(testDir);

      const content = await fs.readFile(configPath, 'utf-8');
      expect(content).toBe(existingContent);
    });

    it('should handle non-existent target directory', async () => {
      const newDir = path.join(testDir, 'new-project');
      const initCommand = new InitCommand({ tools: 'claude', force: true });

      await initCommand.execute(newDir);

      const ratchetPath = path.join(newDir, '.ratchet');
      expect(await directoryExists(ratchetPath)).toBe(true);
    });

    it('should work in extend mode (re-running init)', async () => {
      const initCommand1 = new InitCommand({ tools: 'claude', force: true });
      await initCommand1.execute(testDir);

      // Run init again with a different tool
      const initCommand2 = new InitCommand({ tools: 'cursor', force: true });
      await initCommand2.execute(testDir);

      // Both tools should have skills
      const claudeSkill = path.join(testDir, '.claude', 'skills', 'ratchet-propose', 'SKILL.md');
      const cursorSkill = path.join(testDir, '.cursor', 'skills', 'ratchet-propose', 'SKILL.md');

      expect(await fileExists(claudeSkill)).toBe(true);
      expect(await fileExists(cursorSkill)).toBe(true);
    });

    it('should refresh skills on re-run for the same tool', async () => {
      const initCommand1 = new InitCommand({ tools: 'claude', force: true });
      await initCommand1.execute(testDir);

      const skillFile = path.join(testDir, '.claude', 'skills', 'ratchet-propose', 'SKILL.md');
      const originalContent = await fs.readFile(skillFile, 'utf-8');

      // Modify the file
      await fs.writeFile(skillFile, '# Modified content\n');

      // Run init again
      const initCommand2 = new InitCommand({ tools: 'claude', force: true });
      await initCommand2.execute(testDir);

      const newContent = await fs.readFile(skillFile, 'utf-8');
      expect(newContent).toBe(originalContent);
    });
  });

  describe('skill content validation', () => {
    it('should generate valid SKILL.md with YAML frontmatter', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });
      await initCommand.execute(testDir);

      const skillFile = path.join(testDir, '.claude', 'skills', 'ratchet-propose', 'SKILL.md');
      const content = await fs.readFile(skillFile, 'utf-8');

      // Should have YAML frontmatter
      expect(content).toMatch(/^---\n/);
      expect(content).toContain('name: ratchet-propose');
      expect(content).toContain('description:');
      expect(content).toContain('license:');
      expect(content).toContain('compatibility:');
      expect(content).toContain('metadata:');
      expect(content).toMatch(/---\n\n/); // End of frontmatter
    });

    it('should include propose skill description', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });
      await initCommand.execute(testDir);

      const skillFile = path.join(testDir, '.claude', 'skills', 'ratchet-propose', 'SKILL.md');
      const content = await fs.readFile(skillFile, 'utf-8');

      expect(content).toContain('Propose a new change');
    });

    it('should include propose skill instructions', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });
      await initCommand.execute(testDir);

      const skillFile = path.join(testDir, '.claude', 'skills', 'ratchet-propose', 'SKILL.md');
      const content = await fs.readFile(skillFile, 'utf-8');

      expect(content).toContain('name: ratchet-propose');
    });

    it('should include apply-change skill instructions', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });
      await initCommand.execute(testDir);

      const skillFile = path.join(testDir, '.claude', 'skills', 'ratchet-apply-change', 'SKILL.md');
      const content = await fs.readFile(skillFile, 'utf-8');

      expect(content).toContain('name: ratchet-apply-change');
    });

    it('should embed generatedBy version in skill files', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });
      await initCommand.execute(testDir);

      const skillFile = path.join(testDir, '.claude', 'skills', 'ratchet-propose', 'SKILL.md');
      const content = await fs.readFile(skillFile, 'utf-8');

      // Should contain generatedBy field with a version string
      expect(content).toMatch(/generatedBy:\s*["']?\d+\.\d+\.\d+["']?/);
    });
  });

  describe('command generation', () => {
    it('should generate Claude Code commands with correct format', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });
      await initCommand.execute(testDir);

      const cmdFile = path.join(testDir, '.claude', 'commands', 'rct', 'propose.md');
      const content = await fs.readFile(cmdFile, 'utf-8');

      // Claude commands use YAML frontmatter
      expect(content).toMatch(/^---\n/);
      expect(content).toContain('name:');
      expect(content).toContain('description:');
    });

    it('should generate Cursor commands with correct format', async () => {
      const initCommand = new InitCommand({ tools: 'cursor', force: true });
      await initCommand.execute(testDir);

      const cmdFile = path.join(testDir, '.cursor', 'commands', 'rct-propose.md');
      expect(await fileExists(cmdFile)).toBe(true);

      const content = await fs.readFile(cmdFile, 'utf-8');
      expect(content).toMatch(/^---\n/);
    });
  });

  describe('error handling', () => {
    it('should provide helpful error for insufficient permissions', async () => {
      // Mock the permission check to fail
      const readOnlyDir = path.join(testDir, 'readonly');
      await fs.mkdir(readOnlyDir);

      const originalWriteFile = fs.writeFile;
      vi.spyOn(fs, 'writeFile').mockImplementation(
        async (filePath: any, ...args: any[]) => {
          if (
            typeof filePath === 'string' &&
            filePath.includes('.ratchet-test-')
          ) {
            throw new Error('EACCES: permission denied');
          }
          return originalWriteFile.call(fs, filePath, ...args);
        }
      );

      const initCommand = new InitCommand({ tools: 'claude', force: true });
      await expect(initCommand.execute(readOnlyDir)).rejects.toThrow(/Insufficient permissions/);
    });

    it('should throw error in non-interactive mode without --tools flag and no detected tools', async () => {
      const initCommand = new InitCommand({ interactive: false });

      await expect(initCommand.execute(testDir)).rejects.toThrow(/No tools detected and no --tools flag/);
    });
  });

  describe('tool-specific adapters', () => {
    it('should generate OpenCode command files', async () => {
      const initCommand = new InitCommand({ tools: 'opencode', force: true });
      await initCommand.execute(testDir);

      const cmdFile = path.join(testDir, '.opencode', 'commands', 'rct-propose.md');
      expect(await fileExists(cmdFile)).toBe(true);
    });

    it('should generate GitHub Copilot prompt files', async () => {
      const initCommand = new InitCommand({ tools: 'github-copilot', force: true });
      await initCommand.execute(testDir);

      const cmdFile = path.join(testDir, '.github', 'prompts', 'rct-propose.prompt.md');
      expect(await fileExists(cmdFile)).toBe(true);
    });
  });
});

describe('InitCommand - profile and detection features', () => {
  let testDir: string;
  let configTempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-init-profile-test-'));
    originalEnv = { ...process.env };
    // Use a temp dir for global config to avoid polluting real config
    configTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-config-test-'));
    process.env.XDG_CONFIG_HOME = configTempDir;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    selectMock.mockReset();
    selectMock.mockResolvedValue('repo-sandboxed-permissive');
    showWelcomeScreenMock.mockClear();
    searchableMultiSelectMock.mockReset();
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    await fs.rm(configTempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    vi.restoreAllMocks();
  });

  it('should use --profile flag to override global config', async () => {
    // Set global config to custom profile
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      delivery: 'both',
      workflows: ['explore', 'new', 'apply'],
    });

    // Override with --profile core
    const initCommand = new InitCommand({ tools: 'claude', force: true, profile: 'core' });
    await initCommand.execute(testDir);

    // Core profile skills should be created
    const proposeSkill = path.join(testDir, '.claude', 'skills', 'ratchet-propose', 'SKILL.md');
    expect(await fileExists(proposeSkill)).toBe(true);

    // Non-core skills (from the custom profile) should NOT be created
    const newChangeSkill = path.join(testDir, '.claude', 'skills', 'ratchet-new-change', 'SKILL.md');
    expect(await fileExists(newChangeSkill)).toBe(false);
  });

  it('should reject invalid --profile values', async () => {
    const initCommand = new InitCommand({
      tools: 'claude',
      force: true,
      profile: 'invalid-profile',
    });

    await expect(initCommand.execute(testDir)).rejects.toThrow(
      /Invalid profile "invalid-profile"/
    );
  });

  it('should use detected tools in non-interactive mode when no --tools flag', async () => {
    // Create a .claude directory to simulate detected tool
    await fs.mkdir(path.join(testDir, '.claude'), { recursive: true });

    const initCommand = new InitCommand({ interactive: false, force: true });
    await initCommand.execute(testDir);

    // Should have used claude (detected)
    const skillFile = path.join(testDir, '.claude', 'skills', 'ratchet-propose', 'SKILL.md');
    expect(await fileExists(skillFile)).toBe(true);
  });

  it('should auto-cleanup legacy artifacts in non-interactive mode without --force', async () => {
    // Create legacy OpenCode command files (singular 'command' path)
    const legacyDir = path.join(testDir, '.opencode', 'command');
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, 'rct-propose.md'), 'legacy content');

    // Run init in non-interactive mode without --force
    const initCommand = new InitCommand({ tools: 'opencode' });
    await initCommand.execute(testDir);

    // Legacy files should be cleaned up automatically
    expect(await fileExists(path.join(legacyDir, 'rct-propose.md'))).toBe(false);

    // New commands should be at the correct plural path
    const newCommandsDir = path.join(testDir, '.opencode', 'commands');
    expect(await directoryExists(newCommandsDir)).toBe(true);
  });

  it('should preselect configured tools but not directory-detected tools in extend mode', async () => {
    // Simulate existing Ratchet project (extend mode).
    await fs.mkdir(path.join(testDir, '.ratchet'), { recursive: true });

    // Configured with Ratchet
    const claudeSkillDir = path.join(testDir, '.claude', 'skills', 'ratchet-propose');
    await fs.mkdir(claudeSkillDir, { recursive: true });
    await fs.writeFile(path.join(claudeSkillDir, 'SKILL.md'), 'configured');

    // Directory detected only (not configured with Ratchet)
    await fs.mkdir(path.join(testDir, '.github'), { recursive: true });
    await fs.writeFile(path.join(testDir, '.github', 'copilot-instructions.md'), '');

    searchableMultiSelectMock.mockResolvedValue(['claude']);

    const initCommand = new InitCommand({ force: true });
    vi.spyOn(initCommand as any, 'canPromptInteractively').mockReturnValue(true);

    await initCommand.execute(testDir);

    expect(searchableMultiSelectMock).toHaveBeenCalledTimes(1);
    const [{ choices }] = searchableMultiSelectMock.mock.calls[0] as [{ choices: Array<{ value: string; preSelected?: boolean; detected?: boolean }> }];

    const claude = choices.find((choice) => choice.value === 'claude');
    const githubCopilot = choices.find((choice) => choice.value === 'github-copilot');

    expect(claude?.preSelected).toBe(true);
    expect(githubCopilot?.preSelected).toBe(false);
    expect(githubCopilot?.detected).toBe(true);
  });

  it('should preselect detected tools for first-time interactive setup', async () => {
    // First-time init: no .ratchet/ directory and no configured Ratchet skills.
    await fs.mkdir(path.join(testDir, '.github'), { recursive: true });
    await fs.writeFile(path.join(testDir, '.github', 'copilot-instructions.md'), '');

    searchableMultiSelectMock.mockResolvedValue(['github-copilot']);

    const initCommand = new InitCommand({ force: true });
    vi.spyOn(initCommand as any, 'canPromptInteractively').mockReturnValue(true);

    await initCommand.execute(testDir);

    expect(searchableMultiSelectMock).toHaveBeenCalledTimes(1);
    const [{ choices }] = searchableMultiSelectMock.mock.calls[0] as [{ choices: Array<{ value: string; preSelected?: boolean }> }];
    const githubCopilot = choices.find((choice) => choice.value === 'github-copilot');

    expect(githubCopilot?.preSelected).toBe(true);
  });

  it('should respect custom profile from global config', async () => {
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      delivery: 'both',
      workflows: ['apply', 'verify'],
    });

    const initCommand = new InitCommand({ tools: 'claude', force: true });
    await initCommand.execute(testDir);

    // Custom profile skills should be created
    const applySkill = path.join(testDir, '.claude', 'skills', 'ratchet-apply-change', 'SKILL.md');
    const verifySkill = path.join(testDir, '.claude', 'skills', 'ratchet-verify-change', 'SKILL.md');
    expect(await fileExists(applySkill)).toBe(true);
    expect(await fileExists(verifySkill)).toBe(true);

    // Non-selected skills should NOT be created
    const proposeSkill = path.join(testDir, '.claude', 'skills', 'ratchet-propose', 'SKILL.md');
    expect(await fileExists(proposeSkill)).toBe(false);
  });

  it('should migrate commands-only extend mode to custom profile without injecting propose', async () => {
    await fs.mkdir(path.join(testDir, '.ratchet'), { recursive: true });
    await fs.mkdir(path.join(testDir, '.claude', 'commands', 'rct'), { recursive: true });
    await fs.writeFile(path.join(testDir, '.claude', 'commands', 'rct', 'apply.md'), '# apply\n');

    const initCommand = new InitCommand({ tools: 'claude', force: true });
    await initCommand.execute(testDir);

    const config = getGlobalConfig();
    expect(config.profile).toBe('custom');
    expect(config.delivery).toBe('commands');
    expect(config.workflows).toEqual(['apply']);

    const applyCommand = path.join(testDir, '.claude', 'commands', 'rct', 'apply.md');
    const proposeCommand = path.join(testDir, '.claude', 'commands', 'rct', 'propose.md');
    expect(await fileExists(applyCommand)).toBe(true);
    expect(await fileExists(proposeCommand)).toBe(false);

    const proposeSkill = path.join(testDir, '.claude', 'skills', 'ratchet-propose', 'SKILL.md');
    expect(await fileExists(proposeSkill)).toBe(false);
  });

  it('should not prompt for confirmation when applying custom profile in interactive init', async () => {
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      delivery: 'both',
      workflows: ['apply', 'verify'],
    });

    const initCommand = new InitCommand({
      force: true,
      // Decline the sandbox-permission offer via the injected seam so this test
      // stays focused on profile confirmation (no real @inquirer confirm fires).
      sandboxPermissionPrompts: {
        confirmSetup: async () => false,
        selectPosture: async () => 'repo-sandboxed-permissive',
      },
    });
    vi.spyOn(initCommand as any, 'canPromptInteractively').mockReturnValue(true);
    vi.spyOn(initCommand as any, 'getSelectedTools').mockResolvedValue(['claude']);

    await initCommand.execute(testDir);

    expect(showWelcomeScreenMock).toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();

    const applySkill = path.join(testDir, '.claude', 'skills', 'ratchet-apply-change', 'SKILL.md');
    const verifySkill = path.join(testDir, '.claude', 'skills', 'ratchet-verify-change', 'SKILL.md');
    expect(await fileExists(applySkill)).toBe(true);
    expect(await fileExists(verifySkill)).toBe(true);

    const logCalls = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().map(String);
    expect(logCalls.some((entry) => entry.includes('Applying custom profile'))).toBe(false);
  });

  it('should respect delivery=skills setting (no commands)', async () => {
    saveGlobalConfig({
      featureFlags: {},
      profile: 'core',
      delivery: 'skills',
    });

    const initCommand = new InitCommand({ tools: 'claude', force: true });
    await initCommand.execute(testDir);

    // Skills should exist
    const skillFile = path.join(testDir, '.claude', 'skills', 'ratchet-propose', 'SKILL.md');
    expect(await fileExists(skillFile)).toBe(true);

    // Commands should NOT exist
    const cmdFile = path.join(testDir, '.claude', 'commands', 'rct', 'propose.md');
    expect(await fileExists(cmdFile)).toBe(false);
  });

  it('should respect delivery=commands setting (no skills)', async () => {
    saveGlobalConfig({
      featureFlags: {},
      profile: 'core',
      delivery: 'commands',
    });

    const initCommand = new InitCommand({ tools: 'claude', force: true });
    await initCommand.execute(testDir);

    // Skills should NOT exist
    const skillFile = path.join(testDir, '.claude', 'skills', 'ratchet-propose', 'SKILL.md');
    expect(await fileExists(skillFile)).toBe(false);

    // Commands should exist
    const cmdFile = path.join(testDir, '.claude', 'commands', 'rct', 'propose.md');
    expect(await fileExists(cmdFile)).toBe(true);
  });

  it('should remove commands on re-init when delivery changes to skills', async () => {
    saveGlobalConfig({
      featureFlags: {},
      profile: 'core',
      delivery: 'both',
    });

    const initCommand1 = new InitCommand({ tools: 'claude', force: true });
    await initCommand1.execute(testDir);

    const cmdFile = path.join(testDir, '.claude', 'commands', 'rct', 'propose.md');
    expect(await fileExists(cmdFile)).toBe(true);

    saveGlobalConfig({
      featureFlags: {},
      profile: 'core',
      delivery: 'skills',
    });

    const initCommand2 = new InitCommand({ tools: 'claude', force: true });
    await initCommand2.execute(testDir);

    expect(await fileExists(cmdFile)).toBe(false);

    const skillFile = path.join(testDir, '.claude', 'skills', 'ratchet-propose', 'SKILL.md');
    expect(await fileExists(skillFile)).toBe(true);
  });
  // ───────────────────────────────────────────────────────────
  // Sandbox permission setup offer (features/init/sandbox-permission-setup)
  // ───────────────────────────────────────────────────────────
  describe('sandbox permission setup offer', () => {
    /** A prompt seam that fails loudly if invoked — proves no prompting happened. */
    const neverPrompts: SandboxPermissionPrompts = {
      confirmSetup: async () => {
        throw new Error('confirmSetup must not be called in this scenario');
      },
      selectPosture: async () => {
        throw new Error('selectPosture must not be called in this scenario');
      },
    };

    async function readProjectPermissions(dir: string): Promise<unknown> {
      const configPath = path.join(dir, '.ratchet', 'config.yaml');
      const raw = await fs.readFile(configPath, 'utf-8');
      return (parseYaml(raw) as { batch?: { permissions?: unknown } })?.batch?.permissions;
    }

    it('offers permission setup when no project-level config exists, then saves the chosen posture', async () => {
      const confirmSetup = vi.fn().mockResolvedValue(true);
      const selectPosture = vi.fn().mockResolvedValue('curated-allowlist');
      const initCommand = new InitCommand({
        force: true,
        sandboxPermissionPrompts: { confirmSetup, selectPosture },
      });
      vi.spyOn(initCommand as any, 'canPromptInteractively').mockReturnValue(true);
      searchableMultiSelectMock.mockResolvedValue(['claude']);

      await initCommand.execute(testDir);

      // The offer was made (confirm) and posture selected on accept.
      expect(confirmSetup).toHaveBeenCalledTimes(1);
      expect(selectPosture).toHaveBeenCalledTimes(1);

      // Posture saved to the project config; init continued (structure created).
      expect(await readProjectPermissions(testDir)).toEqual({ posture: 'curated-allowlist' });
      expect(await directoryExists(path.join(testDir, '.ratchet', 'changes'))).toBe(true);

      // Schema is preserved in the config alongside permissions.
      const cfg = parseYaml(await fs.readFile(path.join(testDir, '.ratchet', 'config.yaml'), 'utf-8'));
      expect(cfg.schema).toBe('ratchet');
    });

    it('writes no permission config when the offer is declined', async () => {
      const confirmSetup = vi.fn().mockResolvedValue(false);
      const initCommand = new InitCommand({
        force: true,
        sandboxPermissionPrompts: {
          confirmSetup,
          selectPosture: neverPrompts.selectPosture,
        },
      });
      vi.spyOn(initCommand as any, 'canPromptInteractively').mockReturnValue(true);
      searchableMultiSelectMock.mockResolvedValue(['claude']);

      await initCommand.execute(testDir);

      expect(confirmSetup).toHaveBeenCalledTimes(1);
      // No permission config written; init still created the structure.
      expect(await readProjectPermissions(testDir)).toBeUndefined();
      expect(await directoryExists(path.join(testDir, '.ratchet', 'changes'))).toBe(true);
    });

    it('skips the offer entirely when a project-level config already exists, leaving it untouched', async () => {
      // Pre-existing project-level permission config.
      await fs.mkdir(path.join(testDir, '.ratchet'), { recursive: true });
      setProjectBatchPermissions(testDir, { posture: 'full-autonomy' });

      const initCommand = new InitCommand({
        force: true,
        sandboxPermissionPrompts: neverPrompts,
      });
      vi.spyOn(initCommand as any, 'canPromptInteractively').mockReturnValue(true);
      searchableMultiSelectMock.mockResolvedValue(['claude']);

      // neverPrompts throws if the offer fires; completing proves it was skipped.
      await initCommand.execute(testDir);

      // Existing config untouched.
      expect(await readProjectPermissions(testDir)).toEqual({ posture: 'full-autonomy' });
      expect(await directoryExists(path.join(testDir, '.ratchet', 'changes'))).toBe(true);
    });

    it('never prompts or writes a permission config in non-interactive mode', async () => {
      // --tools flag → non-interactive; the offer must never fire.
      const initCommand = new InitCommand({
        tools: 'claude',
        force: true,
        sandboxPermissionPrompts: neverPrompts,
      });

      await initCommand.execute(testDir);

      // No permission config written; init completed normally.
      expect(await readProjectPermissions(testDir)).toBeUndefined();
      expect(await directoryExists(path.join(testDir, '.ratchet', 'changes'))).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool validation & legacy-cleanup remainders
// Mirrors features/core-remainder-tests/init-update-remainders.feature
//   - Scenario: init validates an unknown requested tool
//   - Scenario: init rejects a tool that cannot generate skills
//   - Scenario: declining the interactive legacy-cleanup prompt cancels init
// ─────────────────────────────────────────────────────────────────────────────
describe('InitCommand - tool validation & legacy remainders', () => {
  let testDir: string;
  let configTempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-init-remainder-'));
    originalEnv = { ...process.env };
    configTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-config-remainder-'));
    process.env.XDG_CONFIG_HOME = configTempDir;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    selectMock.mockReset();
    selectMock.mockResolvedValue('repo-sandboxed-permissive');
    showWelcomeScreenMock.mockClear();
    searchableMultiSelectMock.mockReset();
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    await fs.rm(configTempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    vi.restoreAllMocks();
  });

  describe('validateTools', () => {
    it('raises an error listing the valid tool ids for an unknown requested tool', () => {
      const initCommand = new InitCommand();

      // Reach validateTools with a tool id that survived selection but is unknown
      // (e.g. an injected/stubbed selection that bypassed --tools parsing).
      const validToolIds = getToolsWithSkillsDir();
      expect(() =>
        (initCommand as any).validateTools(['totally-unknown-tool'], new Map())
      ).toThrow(/Unknown tool 'totally-unknown-tool'/);

      // The error message must enumerate the valid tool ids.
      try {
        (initCommand as any).validateTools(['totally-unknown-tool'], new Map());
        throw new Error('expected validateTools to throw');
      } catch (err) {
        const message = (err as Error).message;
        for (const id of validToolIds) {
          expect(message).toContain(id);
        }
      }
    });

    it('rejects a known tool with no skills directory, listing tools that support skill generation', () => {
      // Inject a known-but-skill-less tool into the shared AI_TOOLS source so the
      // tool resolves (passing the "unknown tool" gate) yet has no skillsDir.
      const skilllessTool = { name: 'Skill-less Tool', value: 'skill-less-tool', available: true };
      AI_TOOLS.push(skilllessTool as any);

      try {
        const initCommand = new InitCommand();
        const validWithSkills = getToolsWithSkillsDir();

        expect(() =>
          (initCommand as any).validateTools(['skill-less-tool'], new Map())
        ).toThrow(/does not support skill generation/);

        try {
          (initCommand as any).validateTools(['skill-less-tool'], new Map());
          throw new Error('expected validateTools to throw');
        } catch (err) {
          const message = (err as Error).message;
          // Lists the tools that DO support skill generation, not the skill-less one.
          expect(message).toContain('Tools with skill generation support');
          for (const id of validWithSkills) {
            expect(message).toContain(id);
          }
          expect(validWithSkills).not.toContain('skill-less-tool');
        }
      } finally {
        const idx = AI_TOOLS.findIndex((t) => t.value === 'skill-less-tool');
        if (idx !== -1) AI_TOOLS.splice(idx, 1);
      }
    });
  });

  describe('interactive legacy cleanup', () => {
    it('cancels init (reports cancellation, does not clean up) when the cleanup confirmation is declined', async () => {
      // Project with a legacy slash-command directory + a legacy structure file.
      const legacyCommandDir = path.join(testDir, '.claude', 'commands', 'ratchet');
      await fs.mkdir(legacyCommandDir, { recursive: true });
      await fs.writeFile(path.join(legacyCommandDir, 'proposal.md'), 'legacy command');
      const legacyAgents = path.join(testDir, '.ratchet', 'AGENTS.md');
      await fs.mkdir(path.join(testDir, '.ratchet'), { recursive: true });
      await fs.writeFile(legacyAgents, '# legacy agents');

      // Decline the interactive cleanup confirmation.
      confirmMock.mockResolvedValue(false);

      // process.exit(0) must abort init; capture it instead of killing the runner.
      const exitError = new Error('process.exit called');
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {
          throw exitError;
        }) as never);

      const initCommand = new InitCommand();
      // Force the interactive path so handleLegacyCleanup prompts via confirm.
      vi.spyOn(initCommand as any, 'canPromptInteractively').mockReturnValue(true);

      await expect(initCommand.execute(testDir)).rejects.toBe(exitError);

      // Cancellation reported and exit(0) requested.
      expect(confirmMock).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
      const logCalls = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .flat()
        .map(String);
      expect(logCalls.some((entry) => entry.includes('Initialization cancelled'))).toBe(true);

      // No cleanup happened: legacy artifacts remain untouched.
      expect(await fileExists(path.join(legacyCommandDir, 'proposal.md'))).toBe(true);
      expect(await directoryExists(legacyCommandDir)).toBe(true);
      expect(await fileExists(legacyAgents)).toBe(true);

      exitSpy.mockRestore();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Coverage remainders: argument-parsing edges, empty-selection guards, generation
// failure/skip branches, config-write failure, success-message branches, and the
// skill/command removal helpers' swallow-error paths.
// ─────────────────────────────────────────────────────────────────────────────
describe('InitCommand - coverage remainders', () => {
  let testDir: string;
  let configTempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-init-cover-'));
    originalEnv = { ...process.env };
    configTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-config-cover-'));
    process.env.XDG_CONFIG_HOME = configTempDir;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    selectMock.mockReset();
    selectMock.mockResolvedValue('repo-sandboxed-permissive');
    showWelcomeScreenMock.mockClear();
    searchableMultiSelectMock.mockReset();
    runDoctorAdvisoryMock.mockReset();
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    await fs.rm(configTempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    vi.restoreAllMocks();
  });

  describe('--tools argument parsing edges', () => {
    it('rejects a whitespace-only --tools value', async () => {
      const initCommand = new InitCommand({ tools: '   ' });
      await expect(initCommand.execute(testDir)).rejects.toThrow(
        /The --tools option requires a value/
      );
    });

    it('rejects a --tools value that is only separators', async () => {
      // After trimming the raw is non-empty (",,") but splitting yields no tokens,
      // exercising the "requires at least one tool ID" guard.
      const initCommand = new InitCommand({ tools: ', ,' });
      await expect(initCommand.execute(testDir)).rejects.toThrow(
        /requires at least one tool ID/
      );
    });
  });

  describe('interactive empty selection', () => {
    it('throws when the interactive multi-select returns no tools', async () => {
      // The prompt seam returns an empty selection; init must reject before any
      // generation happens (exercises the "At least one tool" guard).
      searchableMultiSelectMock.mockResolvedValue([]);

      const initCommand = new InitCommand({ force: true });
      vi.spyOn(initCommand as any, 'canPromptInteractively').mockReturnValue(true);

      await expect(initCommand.execute(testDir)).rejects.toThrow(
        /At least one tool must be selected/
      );
    });

    it('throws a no-tools-available error when no tools support skill generation', async () => {
      // getSelectedTools reads getToolsWithSkillsDir(); temporarily empty AI_TOOLS
      // so that list is empty, driving the interactive "No tools available" guard.
      const saved = AI_TOOLS.splice(0, AI_TOOLS.length);
      try {
        const initCommand = new InitCommand({ force: true });
        vi.spyOn(initCommand as any, 'canPromptInteractively').mockReturnValue(true);

        await expect(
          (initCommand as any).getSelectedTools(new Map(), false, [], testDir)
        ).rejects.toThrow(/No tools available for skill generation/);
      } finally {
        AI_TOOLS.splice(0, AI_TOOLS.length, ...saved);
      }
    });
  });

  describe('first-init doctor advisory', () => {
    it('swallows a doctor failure and logs under DEBUG without aborting init', async () => {
      process.env.DEBUG = '1';
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      // The mocked runDoctorAdvisory throws → the catch branch in
      // runFirstInitDoctor runs and (because DEBUG is set) logs via console.debug.
      runDoctorAdvisoryMock.mockImplementation(() => {
        throw new Error('doctor blew up');
      });

      const initCommand = new InitCommand({ tools: 'claude', force: true });
      await initCommand.execute(testDir);

      // Init still completed (structure exists) regardless of doctor outcome.
      expect(await directoryExists(path.join(testDir, '.ratchet', 'changes'))).toBe(true);
      // The DEBUG-guarded debug log fired.
      const debugCalls = debugSpy.mock.calls.flat().map(String);
      expect(debugCalls.some((l) => l.includes('doctor advisory skipped'))).toBe(true);
      debugSpy.mockRestore();
    });

    it('swallows a doctor failure silently when DEBUG is not set', async () => {
      delete process.env.DEBUG;
      delete process.env.RATCHET_DEBUG;
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      runDoctorAdvisoryMock.mockImplementation(() => {
        throw new Error('doctor blew up');
      });

      const initCommand = new InitCommand({ tools: 'claude', force: true });
      await initCommand.execute(testDir);

      expect(await directoryExists(path.join(testDir, '.ratchet', 'changes'))).toBe(true);
      // No debug log without DEBUG/RATCHET_DEBUG.
      expect(debugSpy).not.toHaveBeenCalled();
      debugSpy.mockRestore();
    });
  });

  describe('generation failure and skip branches', () => {
    it('records a tool as failed (and surfaces it) when its file writes throw', async () => {
      const tool = {
        value: 'claude',
        name: 'Claude Code',
        skillsDir: '.claude',
        wasConfigured: false,
      };

      const initCommand = new InitCommand({ force: true });

      const { FileSystemUtils } = await import('../../src/utils/file-system.js');
      const writeSpy = vi
        .spyOn(FileSystemUtils, 'writeFile')
        .mockRejectedValue(new Error('EACCES: cannot write skill'));

      try {
        const results = await (initCommand as any).generateSkillsAndCommands(testDir, [tool]);
        expect(results.createdTools).toHaveLength(0);
        expect(results.failedTools).toHaveLength(1);
        expect(results.failedTools[0].name).toBe('Claude Code');
        expect(results.failedTools[0].error.message).toContain('EACCES');

        // Now exercise the displaySuccessMessage failure branch with that result.
        (initCommand as any).displaySuccessMessage(testDir, [tool], results, 'created');
        const logCalls = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls
          .flat()
          .map(String);
        expect(logCalls.some((l) => l.includes('Failed:') && l.includes('Claude Code'))).toBe(true);
      } finally {
        writeSpy.mockRestore();
      }
    });

    it('skips command generation and reports it for a tool with a skills dir but no adapter', async () => {
      // Inject a fake tool that has a skillsDir (so it survives validateTools) but
      // no command adapter registered, exercising the commandsSkipped branch and
      // its display.
      const fakeTool = {
        name: 'Adapterless Tool',
        value: 'adapterless-tool',
        available: true,
        skillsDir: '.adapterless',
      };
      AI_TOOLS.push(fakeTool as any);
      try {
        saveGlobalConfig({ featureFlags: {}, profile: 'core', delivery: 'both' });

        const initCommand = new InitCommand({ tools: 'adapterless-tool', force: true });
        await initCommand.execute(testDir);

        // Skill files were written (skillsDir exists) ...
        const skillFile = path.join(
          testDir,
          '.adapterless',
          'skills',
          'ratchet-propose',
          'SKILL.md'
        );
        expect(await fileExists(skillFile)).toBe(true);

        // ... and the "commands skipped (no adapter)" line was emitted.
        const logCalls = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls
          .flat()
          .map(String);
        expect(
          logCalls.some((l) => l.includes('Commands skipped') && l.includes('adapterless-tool'))
        ).toBe(true);
      } finally {
        const idx = AI_TOOLS.findIndex((t) => t.value === 'adapterless-tool');
        if (idx !== -1) AI_TOOLS.splice(idx, 1);
      }
    });
  });

  describe('createConfig write failure', () => {
    it('returns "skipped" when writing config.yaml throws', async () => {
      const ratchetPath = path.join(testDir, '.ratchet');
      await fs.mkdir(ratchetPath, { recursive: true });

      const initCommand = new InitCommand({ force: true });
      const { FileSystemUtils } = await import('../../src/utils/file-system.js');
      const writeSpy = vi
        .spyOn(FileSystemUtils, 'writeFile')
        .mockRejectedValue(new Error('EROFS: read-only fs'));

      try {
        const status = await (initCommand as any).createConfig(ratchetPath, false);
        expect(status).toBe('skipped');
        // No config file was created.
        expect(await fileExists(path.join(ratchetPath, 'config.yaml'))).toBe(false);
      } finally {
        writeSpy.mockRestore();
      }
    });
  });

  describe('success-message removal branches', () => {
    it('reports removed command files and removed skill directories', () => {
      const initCommand = new InitCommand({ force: true });
      const results = {
        createdTools: [],
        refreshedTools: [],
        failedTools: [],
        commandsSkipped: [],
        removedCommandCount: 3,
        removedSkillCount: 2,
      };

      (initCommand as any).displaySuccessMessage(testDir, [], results, 'skipped');

      const logCalls = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .flat()
        .map(String);
      expect(logCalls.some((l) => l.includes('Removed: 3 command files'))).toBe(true);
      expect(logCalls.some((l) => l.includes('Removed: 2 skill directories'))).toBe(true);
    });
  });

  describe('removeSkillDirs / removeCommandFiles helpers', () => {
    it('removes existing skill directories and returns the count', async () => {
      const skillsDir = path.join(testDir, '.claude', 'skills');
      // Create a couple of known workflow skill dirs.
      for (const dirName of ['ratchet-propose', 'ratchet-apply-change']) {
        await fs.mkdir(path.join(skillsDir, dirName), { recursive: true });
        await fs.writeFile(path.join(skillsDir, dirName, 'SKILL.md'), 'x');
      }

      const initCommand = new InitCommand({ force: true });
      const removed = await (initCommand as any).removeSkillDirs(skillsDir);

      expect(removed).toBeGreaterThanOrEqual(2);
      expect(await directoryExists(path.join(skillsDir, 'ratchet-propose'))).toBe(false);
    });

    it('swallows errors while removing skill directories (returns 0)', async () => {
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'ratchet-propose'), { recursive: true });

      const initCommand = new InitCommand({ force: true });
      const rmSpy = vi
        .spyOn(fs, 'rm')
        .mockRejectedValue(new Error('EPERM: cannot remove dir'));
      try {
        const removed = await (initCommand as any).removeSkillDirs(skillsDir);
        // Every removal threw and was swallowed → nothing counted.
        expect(removed).toBe(0);
      } finally {
        rmSpy.mockRestore();
      }
    });

    it('swallows errors while removing command files (returns 0)', async () => {
      // Create real command files for claude so existsSync is true, then make
      // unlink throw so the swallow-error path runs.
      const { CommandAdapterRegistry } = await import(
        '../../src/core/command-generation/registry.js'
      );
      const adapter = CommandAdapterRegistry.get('claude');
      expect(adapter).toBeTruthy();
      // Materialize at least one command file at its real path.
      const { ALL_WORKFLOWS } = await import('../../src/core/profiles.js');
      for (const workflow of ALL_WORKFLOWS) {
        const cmdPath = adapter!.getFilePath(workflow);
        const full = path.isAbsolute(cmdPath) ? cmdPath : path.join(testDir, cmdPath);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, 'cmd');
      }

      const initCommand = new InitCommand({ force: true });
      const unlinkSpy = vi
        .spyOn(fs, 'unlink')
        .mockRejectedValue(new Error('EBUSY: cannot unlink'));
      try {
        const removed = await (initCommand as any).removeCommandFiles(testDir, 'claude');
        expect(removed).toBe(0);
      } finally {
        unlinkSpy.mockRestore();
      }
    });

    it('returns 0 from removeCommandFiles when the tool has no adapter', async () => {
      const initCommand = new InitCommand({ force: true });
      const removed = await (initCommand as any).removeCommandFiles(testDir, 'no-such-tool');
      expect(removed).toBe(0);
    });
  });

  describe('interactive legacy cleanup acceptance', () => {
    it('proceeds with cleanup when the interactive confirmation is accepted', async () => {
      // Legacy slash-command dir present; accepting the prompt removes it and init
      // continues to completion (exercises the accept path after the confirm).
      const legacyCommandDir = path.join(testDir, '.claude', 'commands', 'ratchet');
      await fs.mkdir(legacyCommandDir, { recursive: true });
      await fs.writeFile(path.join(legacyCommandDir, 'proposal.md'), 'legacy');

      confirmMock.mockResolvedValue(true);
      searchableMultiSelectMock.mockResolvedValue(['claude']);

      const initCommand = new InitCommand({
        sandboxPermissionPrompts: {
          confirmSetup: async () => false,
          selectPosture: async () => 'repo-sandboxed-permissive',
        },
      });
      vi.spyOn(initCommand as any, 'canPromptInteractively').mockReturnValue(true);

      await initCommand.execute(testDir);

      // Legacy dir was cleaned up and init completed.
      expect(await directoryExists(legacyCommandDir)).toBe(false);
      expect(await directoryExists(path.join(testDir, '.ratchet', 'changes'))).toBe(true);
    });
  });

  describe('canPromptInteractively default branch', () => {
    it('delegates to isInteractive when no tools arg and interactive not disabled', () => {
      // interactiveOption defaults to undefined and no toolsArg → reaches the final
      // isInteractive(...) return.
      const initCommand = new InitCommand({});
      const result = (initCommand as any).canPromptInteractively();
      expect(typeof result).toBe('boolean');
    });
  });
});

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
