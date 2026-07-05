import { describe, it, expect } from 'vitest';
import {
  getPrOpenSkillTemplate,
  getRctPrOpenCommandTemplate,
} from '../../../../src/core/templates/workflows/pr-open.js';
import { CommandAdapterRegistry } from '../../../../src/core/command-generation/registry.js';
import { generateCommand } from '../../../../src/core/command-generation/generator.js';
import type { CommandContent } from '../../../../src/core/command-generation/types.js';

/**
 * Unit tests for the shared PR-open workflow templates.
 *
 * Implements `features/pr-open-instruction/shared-command.feature`: the shared,
 * forge-agnostic PR-open command authored once in the command/workflow layer, with
 * its own command id (`pr-open`) and paired skill (`ratchet-pr-open`), whose body
 * instructs the spawned PR agent to read `git log` for the repo's commit style,
 * commit the accumulated work, push the work branch, and open exactly one
 * forge-agnostic PR to its base branch.
 */

describe('pr-open workflow templates', () => {
  it('exposes a skill template with the canonical identity', () => {
    const skill = getPrOpenSkillTemplate();

    expect(skill.name).toBe('ratchet-pr-open');
    expect(skill.description).toBeTruthy();
    expect(skill.instructions).toBeTruthy();
  });

  it('exposes a command template sharing the SAME shared body as the skill', () => {
    const command = getRctPrOpenCommandTemplate();

    expect(command.name).toBeTruthy();
    expect(command.category).toBe('Workflow');
    expect(command.tags).toEqual(['workflow', 'batch', 'experimental']);
    // One author of the lifecycle instructions: the command body IS the skill body.
    expect(command.content).toBe(getPrOpenSkillTemplate().instructions);
  });

  describe('the shared body instructs the whole PR-open lifecycle', () => {
    const body = getPrOpenSkillTemplate().instructions;

    it('directs reading git log for the commit style with a semantic/Conventional default', () => {
      expect(body).toContain('git log');
      expect(body).toMatch(/commit[- ]message style|commit style/i);
      // Defaults to semantic / Conventional Commits when the history is unclear.
      expect(body).toMatch(/semantic/i);
      expect(body).toMatch(/conventional commits/i);
      expect(body).toMatch(/default/i);
    });

    it('directs committing the accumulated uncommitted work of the prior stage agents', () => {
      expect(body).toMatch(/accumulated/i);
      expect(body).toMatch(/uncommitted/i);
      expect(body).toMatch(/prior stage agents/i);
      expect(body).toMatch(/commit/i);
    });

    it('directs pushing the work branch to its remote', () => {
      expect(body).toMatch(/push/i);
      expect(body).toMatch(/work branch/i);
      expect(body).toMatch(/remote/i);
    });

    it('directs opening EXACTLY ONE pull request to the base branch', () => {
      expect(body).toMatch(/exactly one/i);
      expect(body).toMatch(/pull request/i);
      expect(body).toMatch(/base branch/i);
      // Never more than one PR.
      expect(body).toMatch(/never more than one/i);
    });

    it('is forge-agnostic: uses whichever forge CLI the environment provides', () => {
      expect(body).toMatch(/forge cli/i);
      expect(body).toMatch(/environment provides/i);
      // gh / glab are examples only, never the required tool.
      expect(body).toContain('gh');
      expect(body).toContain('glab');
      expect(body).toMatch(/examples?/i);
      // Hard-codes no ratchet-specific toolchain as required.
      expect(body).toMatch(/no ratchet-specific|never silently substitute a\s+ratchet/i);
    });

    it('is agent-neutral: refers to the coding agent generically, names no single agent', () => {
      expect(body).toMatch(/coding agent/i);
      // Assumes no capability unique to one agent.
      expect(body).toMatch(/any agent/i);
      // Never names a single agent or a single-agent-only tool.
      expect(body).not.toContain('Claude');
      expect(body).not.toContain('AskUserQuestion');
    });
  });

  it('renders the PR-open lifecycle into every registered tool command', () => {
    // The command is the per-tool surface: the shared body is formatted into each
    // registered tool's command file via its adapter. Render it through EVERY
    // adapter and assert the core lifecycle instructions survive each tool's
    // formatting (frontmatter/path differ; body must not) — no agent special-cased.
    const cmd = getRctPrOpenCommandTemplate();
    const content: CommandContent = {
      id: 'pr-open',
      name: cmd.name,
      description: cmd.description,
      category: cmd.category,
      tags: cmd.tags,
      body: cmd.content,
    };

    const adapters = CommandAdapterRegistry.getAll();
    expect(adapters.length).toBeGreaterThanOrEqual(5);
    for (const adapter of adapters) {
      const { fileContent } = generateCommand(content, adapter);
      expect(fileContent, `tool: ${adapter.toolId}`).toContain('git log');
      expect(fileContent, `tool: ${adapter.toolId}`).toMatch(/exactly one/i);
      expect(fileContent, `tool: ${adapter.toolId}`).toMatch(/forge cli/i);
      // Agent-neutral across every tool's rendered file.
      expect(fileContent, `tool: ${adapter.toolId}`).not.toContain('AskUserQuestion');
    }
  });
});
