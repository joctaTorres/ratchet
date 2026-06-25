import { describe, it, expect } from 'vitest';
import {
  getProposeBatchSkillTemplate,
  getRctProposeBatchCommandTemplate,
} from '../../../../src/core/templates/workflows/propose-batch.js';
import { CommandAdapterRegistry } from '../../../../src/core/command-generation/registry.js';
import { generateCommand } from '../../../../src/core/command-generation/generator.js';
import type { CommandContent } from '../../../../src/core/command-generation/types.js';

describe('propose-batch workflow templates', () => {
  it('exposes a skill template that guides authoring a batch manifest', () => {
    const skill = getProposeBatchSkillTemplate();

    expect(skill.name).toBe('ratchet-propose-batch');
    expect(skill.description).toBeTruthy();

    const body = skill.instructions;
    // Writes a manifest via the existing batch machinery, not change directories.
    expect(body).toContain('ratchet new batch');
    expect(body).toContain('.ratchet/batches/<name>/batch.yaml');
    expect(body).toMatch(/never change directories|no change directories|not change directories/i);

    // The five-step guided flow.
    expect(body).toMatch(/explore the objective/i);
    expect(body).toMatch(/vertical-slice phase/i);
    expect(body).toMatch(/reject horizontal/i);
    expect(body).toContain('proof-of-work');

    // The three allowed proof-of-work kinds.
    expect(body).toContain('integration');
    expect(body).toContain('blackbox');
    expect(body).toContain('llm-judge');

    // Phase-one concrete proof vs later-phase refinable proof.
    expect(body).toMatch(/refined at phase entry/i);

    // Shallow DAG: only phase one decomposed.
    expect(body).toMatch(/shallow dag/i);
    expect(body).toContain('after');

    // Non-default gate/strategy recorded under settings.
    expect(body).toContain('settings');
    expect(body).toContain('gate');
    expect(body).toContain('strategy');

    // Gated hand-off into apply-batch (direct + indirect paths).
    expect(body).toMatch(/gate/i);
    expect(body).toContain('/rct:apply-batch <name>');
    // Direct: drive now, current session becomes the orchestrator.
    expect(body).toMatch(/batch orchestrator/i);
    // Indirect: defer; changes created lazily during `ratchet batch apply`.
    expect(body).toMatch(/ratchet batch apply/);
    expect(body).toMatch(/created\s+lazily/i);
    // No longer offers to propose phase-one changes as the next step.
    expect(body).not.toContain('/rct:propose ');
    expect(body).not.toMatch(/propose phase[- ]one('s)? (first )?change/i);

    // The four waterfall traps appear as rationale.
    expect(body).toMatch(/inflexibility to change/i);
    expect(body).toMatch(/late error detection/i);
    expect(body).toMatch(/early customer feedback/i);
    expect(body).toMatch(/planning fallacy/i);

    // Agent-neutral, per multi-agent-support standard.
    expect(body.toLowerCase()).toContain('your agent');
    expect(body).toContain('AskUserQuestion');
  });

  it('exposes a command template sharing the same authoring body', () => {
    const command = getRctProposeBatchCommandTemplate();

    expect(command.name).toBeTruthy();
    expect(command.category).toBe('Workflow');
    expect(command.tags).toEqual(['workflow', 'batch', 'experimental']);
    // Same shared body as the skill.
    expect(command.content).toBe(getProposeBatchSkillTemplate().instructions);
  });

  it('documents the required per-change done criterion', () => {
    const body = getProposeBatchSkillTemplate().instructions;
    // States that each change intent must carry a short, clear `done`.
    expect(body).toMatch(/per-change done/i);
    expect(body).toContain('`done`');
    expect(body).toMatch(/short, clear/i);
    // The field is required (no longer an optional per-change success).
    expect(body).toMatch(/required/i);
    expect(body).not.toMatch(/per-change success/i);
  });

  it('renders the apply-batch hand-off into every registered tool command', () => {
    // The command is the genuinely per-tool surface: the shared body is
    // formatted into each registered tool's command file via its adapter. Render
    // it through every adapter and assert the gated apply-batch hand-off
    // survives each tool's formatting (frontmatter/path differ; body must not).
    const cmd = getRctProposeBatchCommandTemplate();
    const content: CommandContent = {
      id: 'rct-propose-batch',
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
      // Direct path: chain into apply-batch as the orchestrator. (Some adapters
      // rewrite the `:` in `/rct:apply-batch` to `-`, so match either form.)
      expect(fileContent, `tool: ${adapter.toolId}`).toMatch(/\/rct[:-]apply-batch <name>/);
      expect(fileContent, `tool: ${adapter.toolId}`).toMatch(/batch orchestrator/i);
      // Indirect path: defer; lazy change creation during `ratchet batch apply`.
      expect(fileContent, `tool: ${adapter.toolId}`).toMatch(/ratchet batch apply/);
    }
  });
});
