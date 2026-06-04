import { describe, it, expect } from 'vitest';
import { CommandAdapterRegistry } from '../../../src/core/command-generation/registry.js';

const REGISTERED_TOOLS = ['claude', 'codex', 'cursor', 'github-copilot', 'opencode'] as const;

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
    it('should return array of exactly the five supported adapters', () => {
      const adapters = CommandAdapterRegistry.getAll();
      expect(Array.isArray(adapters)).toBe(true);
      expect(adapters.length).toBe(REGISTERED_TOOLS.length);
    });

    it('should include the five supported adapters', () => {
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
