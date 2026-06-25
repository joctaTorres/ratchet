import { describe, it, expect } from 'vitest';
import {
  getBrainstormSkillTemplate,
  getRctBrainstormCommandTemplate,
} from '../../../../src/core/templates/workflows/brainstorm.js';
import { CommandAdapterRegistry } from '../../../../src/core/command-generation/registry.js';
import { generateCommand } from '../../../../src/core/command-generation/generator.js';
import type { CommandContent } from '../../../../src/core/command-generation/types.js';

describe('brainstorm workflow templates', () => {
  it('exposes a skill template that guides idea -> design -> route', () => {
    const skill = getBrainstormSkillTemplate();

    expect(skill.name).toBe('ratchet-brainstorm');
    expect(skill.description).toBeTruthy();

    const body = skill.instructions;

    // Explore project context first (files, docs, recent commits) before anything.
    expect(body).toMatch(/explore the project context first/i);
    expect(body).toMatch(/files,?\s+docs,?\s+and recent\s+commits/i);

    // Clarifying questions: one at a time, one per message, purpose/constraints/success.
    expect(body).toMatch(/one at a time/i);
    expect(body).toMatch(/one question per message/i);
    expect(body).toMatch(/purpose, constraints, and success\s+criteria/i);
    // Prefer multiple choice, fall back to open-ended.
    expect(body).toMatch(/multiple-choice/i);
    expect(body).toMatch(/open-ended/i);

    // 2-3 approaches with a leading recommendation, YAGNI.
    expect(body).toMatch(/two to three/i);
    expect(body).toMatch(/lead with your recommended approach/i);
    expect(body).toContain('YAGNI');

    // Section-by-section design with per-section approval, isolation/clarity.
    expect(body).toMatch(/section by section/i);
    expect(body).toMatch(/approval after each section/i);
    expect(body).toMatch(/isolation and clarity/i);

    // Existing-codebase: explore current patterns, no unrelated refactoring.
    expect(body).toMatch(/existing codebase/i);
    expect(body).toMatch(/do\s+\*\*not\*\*\s+propose unrelated refactoring/i);

    // Does no implementation itself.
    expect(body).toMatch(/no implementation/i);

    // Agent-neutral, per multi-agent-support standard.
    expect(body.toLowerCase()).toContain('your agent');
    expect(body.toLowerCase()).toContain('the coding agent');
    expect(body).not.toContain('Claude');

    // Structured-question tooling optional with a plain-prose fallback.
    expect(body).toContain('AskUserQuestion');
    expect(body).toMatch(/if your agent has\s+one/i);
    expect(body).toMatch(/plain prose/i);
  });

  it('describes the capability-gated, server-less, just-in-time visual aid', () => {
    const body = getBrainstormSkillTemplate().instructions;

    // Never upfront; capability-gated; first genuinely visual question.
    expect(body).toMatch(/not\*?\*? offer any visual companion upfront/i);
    expect(body).toMatch(/shown than told/i);
    expect(body).toMatch(/just-in-time/i);
    // Offer is its own message and waits for the user.
    expect(body).toMatch(/its own message/i);
    expect(body).toMatch(/wait for the user's response/i);
    // No server / file dependency; text-only always works.
    expect(body).toMatch(/bundles \*\*no\*\* browser\s+companion server/i);
    expect(body).toMatch(/text-only/i);
    // Per-question decision: visual for visual, text for conceptual/tradeoff/scope.
    expect(body).toMatch(/per question/i);
    expect(body).toMatch(/conceptual, tradeoff, or scope/i);
  });

  it('terminates by recommending and gating a route into propose / propose-batch', () => {
    const body = getBrainstormSkillTemplate().instructions;

    // Single cohesive change -> propose; big split effort -> propose-batch.
    expect(body).toContain('/rct:propose');
    expect(body).toContain('/rct:propose-batch');
    expect(body).toMatch(/single, cohesive change/i);
    expect(body).toMatch(/split into (multiple changes|phases)/i);

    // Explicit gate, never automatic; chains in only on approval.
    expect(body).toMatch(/explicit gate, never automatic/i);
    expect(body).toMatch(/never chain in automatically/i);
    expect(body).toMatch(/on approval/i);
  });

  it('omits the removed source behaviors (negative scenarios)', () => {
    const body = getBrainstormSkillTemplate().instructions;

    // No writing-plans / implementation-skill handoff.
    expect(body).toMatch(/no skill other than/i);
    expect(body).not.toMatch(/writing-plans skill is the next step|invoke the writing-plans skill to create/i);
    expect(body).toMatch(/do \*\*not\*\* hand off to a writing-plans skill/i);

    // No sub-project decomposition into separate spec/plan/impl cycles.
    expect(body).toMatch(/do \*\*not\*\* decompose\s+the request yourself into separate sub-projects/i);
    expect(body).not.toMatch(/each sub-project gets its own spec/i);

    // No design-doc write, no spec self-review, no written-spec review gate.
    expect(body).toMatch(/write \*\*no\*\* design doc/i);
    expect(body).toMatch(/no\*?\*? spec self-review/i);
    expect(body).toMatch(/no\*?\*? separate written-spec review/i);
    expect(body).not.toContain('docs/superpowers/specs/');
  });

  it('exposes a command template sharing the same brainstorm body', () => {
    const command = getRctBrainstormCommandTemplate();

    expect(command.name).toBeTruthy();
    expect(command.category).toBe('Workflow');
    expect(command.tags).toEqual(['workflow', 'brainstorm', 'experimental']);
    // Same shared body as the skill (defined once).
    expect(command.content).toBe(getBrainstormSkillTemplate().instructions);
  });

  it('renders the routing hand-off into every registered tool command', () => {
    // The command is the genuinely per-tool surface: the shared body is
    // formatted into each registered tool's command file via its adapter. Render
    // it through every adapter and assert the gated routing hand-off survives
    // each tool's formatting (frontmatter/path differ; body must not).
    const cmd = getRctBrainstormCommandTemplate();
    const content: CommandContent = {
      id: 'rct-brainstorm',
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
      // Both routing doors survive. Some adapters rewrite the `:` in
      // `/rct:propose` to `-`, so match either form. Use a word boundary so
      // `/rct[:-]propose` does not also match `/rct[:-]propose-batch`.
      expect(fileContent, `tool: ${adapter.toolId}`).toMatch(/\/rct[:-]propose\b/);
      expect(fileContent, `tool: ${adapter.toolId}`).toMatch(/\/rct[:-]propose-batch\b/);
      // The route is an explicit gate, never automatic.
      expect(fileContent, `tool: ${adapter.toolId}`).toMatch(/explicit gate, never automatic/i);
    }
  });
});
