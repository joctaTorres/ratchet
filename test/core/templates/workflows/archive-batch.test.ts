import { describe, it, expect } from 'vitest';
import {
  getArchiveBatchSkillTemplate,
  getRctArchiveBatchCommandTemplate,
} from '../../../../src/core/templates/workflows/archive-batch.js';
import {
  getSkillTemplates,
  getCommandTemplates,
  generateSkillContent,
} from '../../../../src/core/shared/skill-generation.js';
import { CommandAdapterRegistry } from '../../../../src/core/command-generation/registry.js';
import { generateCommand } from '../../../../src/core/command-generation/generator.js';
import type { CommandContent } from '../../../../src/core/command-generation/types.js';

describe('archive-batch workflow templates', () => {
  it('exposes a skill template that drives the cascading archive command', () => {
    const skill = getArchiveBatchSkillTemplate();
    expect(skill.name).toBe('ratchet-archive-batch');
    expect(skill.description).toBeTruthy();

    const body = skill.instructions;
    // Reports status and invokes the CLI to perform the cascade + move.
    expect(body).toContain('ratchet batch status');
    expect(body).toContain('ratchet batch archive');
    // Never moves directories by hand.
    expect(body).toMatch(/never move directories by hand|do \*\*not\*\* `mv`/i);
    // Agent-neutral, with a structured-question fallback (multi-agent-support).
    expect(body.toLowerCase()).toContain('your agent');
    expect(body).toContain('AskUserQuestion');
    expect(body).toMatch(/plain prose/i);
  });

  it('exposes a command template sharing the same body', () => {
    const command = getRctArchiveBatchCommandTemplate();
    expect(command.name).toBeTruthy();
    expect(command.category).toBe('Workflow');
    expect(command.tags).toEqual(['workflow', 'archive-batch', 'experimental']);
    expect(command.content).toBe(getArchiveBatchSkillTemplate().instructions);
  });

  it('is registered as a single shared skill + command in the generation arrays', () => {
    const skillEntries = getSkillTemplates().filter((e) => e.dirName === 'ratchet-archive-batch');
    expect(skillEntries).toHaveLength(1);
    expect(skillEntries[0].workflowId).toBe('archive-batch');

    const commandEntries = getCommandTemplates().filter((e) => e.id === 'archive-batch');
    expect(commandEntries).toHaveLength(1);
  });

  it('renders the archive-batch skill for every supported agent (via the registry)', () => {
    const entry = getSkillTemplates(['archive-batch']);
    expect(entry).toHaveLength(1);

    // Iterate the adapter registry rather than hard-coding an agent list: ratchet
    // init writes the skill for each registered adapter, so the body must render
    // for all of them and no adapter may be missing it.
    const adapters = CommandAdapterRegistry.getAll();
    expect(adapters.length).toBeGreaterThanOrEqual(6);
    for (const adapter of adapters) {
      const content = generateSkillContent(entry[0].template, '0.0.0-test');
      expect(content, `tool: ${adapter.toolId}`).toContain('name: ratchet-archive-batch');
      expect(content, `tool: ${adapter.toolId}`).toContain('ratchet batch archive');
      expect(content.toLowerCase(), `tool: ${adapter.toolId}`).toContain('your agent');
    }
  });

  it('renders the archive-batch command for every registered tool', () => {
    const cmd = getRctArchiveBatchCommandTemplate();
    const content: CommandContent = {
      id: 'archive-batch',
      name: cmd.name,
      description: cmd.description,
      category: cmd.category,
      tags: cmd.tags,
      body: cmd.content,
    };

    const adapters = CommandAdapterRegistry.getAll();
    expect(adapters.length).toBeGreaterThanOrEqual(6);
    for (const adapter of adapters) {
      const { fileContent } = generateCommand(content, adapter);
      // The cascading archive invocation survives each tool's formatting.
      expect(fileContent, `tool: ${adapter.toolId}`).toContain('ratchet batch archive');
      // The body stays agent-neutral across every adapter.
      expect(fileContent.toLowerCase(), `tool: ${adapter.toolId}`).toContain('your agent');
    }
  });
});
