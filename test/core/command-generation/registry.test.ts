import { describe, it, expect } from 'vitest';
import { CommandAdapterRegistry } from '../../../src/core/command-generation/registry.js';
import { generateCommand } from '../../../src/core/command-generation/generator.js';
import { getCommandContents } from '../../../src/core/shared/skill-generation.js';

const REGISTERED_TOOLS = ['claude', 'codex', 'cursor', 'gemini', 'github-copilot', 'opencode'] as const;

/**
 * Per-agent file-path suffix for the `decompose-phase` command. Asserted by
 * ITERATING the registry (multi-agent-support: a generated artifact must land for
 * every agent, never claude-only). Codex's path is absolute under CODEX_HOME, so
 * we match the suffix.
 */
const DECOMPOSE_PATH_SUFFIX: Record<string, string> = {
  claude: '.claude/commands/rct/decompose-phase.md',
  codex: 'prompts/rct-decompose-phase.md',
  cursor: '.cursor/commands/rct-decompose-phase.md',
  gemini: '.gemini/commands/rct-decompose-phase.md',
  'github-copilot': '.github/prompts/rct-decompose-phase.prompt.md',
  opencode: '.opencode/commands/rct-decompose-phase.md',
};

describe('command-generation/registry', () => {
  describe('get', () => {
    it('should return Claude adapter for "claude"', () => {
      const adapter = CommandAdapterRegistry.get('claude');
      expect(adapter).toBeDefined();
      expect(adapter?.toolId).toBe('claude');
    });

    it('should return Cursor adapter for "cursor"', () => {
      const adapter = CommandAdapterRegistry.get('cursor');
      expect(adapter).toBeDefined();
      expect(adapter?.toolId).toBe('cursor');
    });

    it('should return OpenCode adapter for "opencode"', () => {
      const adapter = CommandAdapterRegistry.get('opencode');
      expect(adapter).toBeDefined();
      expect(adapter?.toolId).toBe('opencode');
    });

    it('should return undefined for unregistered tool', () => {
      const adapter = CommandAdapterRegistry.get('unknown-tool');
      expect(adapter).toBeUndefined();
    });

    it('should return undefined for a dropped tool', () => {
      expect(CommandAdapterRegistry.get('windsurf')).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      const adapter = CommandAdapterRegistry.get('');
      expect(adapter).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('should return array of exactly the supported adapters', () => {
      const adapters = CommandAdapterRegistry.getAll();
      expect(Array.isArray(adapters)).toBe(true);
      expect(adapters.length).toBe(REGISTERED_TOOLS.length);
    });

    it('should include the supported adapters', () => {
      const toolIds = CommandAdapterRegistry.getAll().map((a) => a.toolId).sort();
      expect(toolIds).toEqual([...REGISTERED_TOOLS].sort());
    });
  });

  describe('has', () => {
    it('should return true for registered tools', () => {
      for (const toolId of REGISTERED_TOOLS) {
        expect(CommandAdapterRegistry.has(toolId)).toBe(true);
      }
    });

    it('should return false for unregistered tools', () => {
      expect(CommandAdapterRegistry.has('unknown')).toBe(false);
      expect(CommandAdapterRegistry.has('windsurf')).toBe(false);
      expect(CommandAdapterRegistry.has('')).toBe(false);
    });
  });

  describe('decompose-phase command is generated for EVERY registered agent', () => {
    const [content] = getCommandContents(['decompose-phase']);

    it('the shared command content exists and authors only the manifest edit', () => {
      expect(content).toBeDefined();
      expect(content.id).toBe('decompose-phase');
      // The body owns the lazy-decomposition semantics: it authors change intents
      // into the manifest, never change directories.
      expect(content.body).toMatch(/change intents/i);
      expect(content.body).toMatch(/never change directories|NOT create any change directories/i);
    });

    it('renders for all registered agents at each agent path (iterate the registry)', () => {
      const tools = CommandAdapterRegistry.getAll().map((a) => a.toolId).sort();
      // Guard: the registry is exactly the supported set, so iterating it covers
      // every agent — the new artifact can never silently land for claude only.
      expect(tools).toEqual([...REGISTERED_TOOLS].sort());

      for (const adapter of CommandAdapterRegistry.getAll()) {
        const result = generateCommand(content, adapter);
        const suffix = DECOMPOSE_PATH_SUFFIX[adapter.toolId];
        expect(suffix, `no expected path for ${adapter.toolId}`).toBeDefined();
        expect(result.path.replace(/\\/g, '/')).toContain(suffix);
        // The rendered file carries the shared body for this agent.
        expect(result.fileContent).toContain('change intents');
      }
    });

    it('resolves the invocation token per agent (claude `/rct:`, others `/rct-`)', () => {
      expect(CommandAdapterRegistry.get('claude')!.getInvocation('decompose-phase')).toBe(
        '/rct:decompose-phase'
      );
      for (const toolId of REGISTERED_TOOLS.filter((t) => t !== 'claude')) {
        expect(CommandAdapterRegistry.get(toolId)!.getInvocation('decompose-phase')).toBe(
          '/rct-decompose-phase'
        );
      }
    });
  });

  describe('adapter functionality', () => {
    it('registered adapters should have working getFilePath', () => {
      expect(CommandAdapterRegistry.get('claude')?.getFilePath('test')).toContain('.claude');
      expect(CommandAdapterRegistry.get('cursor')?.getFilePath('test')).toContain('.cursor');
      expect(CommandAdapterRegistry.get('opencode')?.getFilePath('test')).toContain('.opencode');
    });

    it('registered adapters should have working formatFile', () => {
      const content = {
        id: 'test',
        name: 'Test',
        description: 'Test desc',
        category: 'Test',
        tags: ['tag1'],
        body: 'Body content',
      };

      const adapters = CommandAdapterRegistry.getAll();
      for (const adapter of adapters) {
        const output = adapter.formatFile(content);
        expect(output).toContain('Body content');
      }
    });
  });
});
