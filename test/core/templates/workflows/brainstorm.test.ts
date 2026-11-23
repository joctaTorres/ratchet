import { describe, it, expect } from 'vitest';
import {
  getBrainstormSkillTemplate,
  getRctBrainstormCommandTemplate,
} from '../../../../src/core/templates/workflows/brainstorm.js';
import { CommandAdapterRegistry } from '../../../../src/core/command-generation/registry.js';
import { generateCommand } from '../../../../src/core/command-generation/generator.js';
import type { CommandContent } from '../../../../src/core/command-generation/types.js';

describe('brainstorm workflow templates', () => {
  it('exposes a skill template that guides triage -> dialogue -> design -> route', () => {
    const skill = getBrainstormSkillTemplate();

    expect(skill.name).toBe('ratchet-brainstorm');
    expect(skill.description).toBeTruthy();

    const body = skill.instructions;

    // Triage: a complete request routes straight to /rct:propose.
    expect(body).toMatch(/triage/i);
    expect(body).toMatch(/complete request/i);
    expect(body).toMatch(/straight to\s+`\/rct:propose`/i);

    // Look before asking: explore project context first, first-message echo.
    expect(body).toMatch(/look before asking/i);
    expect(body).toMatch(/files,?\s+docs,?\s+and recent\s+commits/i);
    expect(body).toMatch(/first message/i);
    expect(body).toMatch(/echo/i);

    // Why-first open questions before any options; then named options with a
    // recommended pick.
    expect(body).toMatch(/why-first/i);
    expect(body).toMatch(/purpose, constraints, and success\s+criteria/i);
    expect(body).toMatch(/before\s+presenting\s+any\s+set\s+of\s+options/i);
    expect(body).toMatch(/named options/i);
    expect(body).toMatch(/recommended pick/i);

    // Ask only when the answer changes what gets built; otherwise a default
    // said aloud as a correctable proposal.
    expect(body).toMatch(/ask only when the answer changes what gets built/i);
    expect(body).toMatch(/default[^.]{0,60}aloud/i);
    expect(body).toMatch(/correctable proposal/i);

    // The pre-change mechanics v7 replaced are gone from the body.
    expect(body).not.toMatch(/one question per message/i);
    expect(body).not.toMatch(/one at a time/i);
    expect(body).not.toMatch(/multiple-choice/i);
    expect(body).not.toMatch(/two to three/i);
    expect(body).not.toMatch(/2-3 approaches/i);

    // Approaches in their own message; one sensible way allowed; leading
    // recommendation when real alternatives exist; YAGNI.
    expect(body).toMatch(/approaches[^.]{0,80}own message/i);
    expect(body).toMatch(/one sensible way/i);
    expect(body).toMatch(/invent extra approaches/i);
    expect(body).toMatch(/lead with your\s+recommended\s+approach/i);
    expect(body).toContain('YAGNI');

    // Compact playback labelling agent-filled proposals.
    expect(body).toMatch(/200-300-word/i);
    expect(body).toMatch(/agent-filled/i);

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

  it('restates the skill description metadata to the v7 flow', () => {
    const { description } = getBrainstormSkillTemplate();

    // The description no longer describes the pre-change mechanics.
    expect(description).not.toMatch(/one at a time/i);
    expect(description).not.toMatch(/2-3 approaches/i);

    // It describes the v7 flow instead.
    expect(description).toMatch(/triage/i);
    expect(description).toMatch(/why-first/i);
    expect(description).toMatch(/200-300-word/i);
    expect(description).toMatch(/skip-ahead/i);
    expect(description).toMatch(/steps? up a size/i);
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

    // Single cohesive change -> propose; big split effort -> step up a size to
    // propose-batch.
    expect(body).toContain('/rct:propose');
    expect(body).toContain('/rct:propose-batch');
    expect(body).toMatch(/single, cohesive change/i);
    expect(body).toMatch(/split into (multiple changes|phases)/i);
    expect(body).toMatch(/step up a size/i);

    // Skip-ahead opt-out routes to propose at any point.
    expect(body).toMatch(/skip[- ]ahead/i);
    expect(body).toMatch(/never locked into finishing every step/i);

    // Explicit gate, never automatic; chains in only on approval.
    expect(body).toMatch(/explicit gate, never automatic/i);
    expect(body).toMatch(/never chain in automatically/i);
    expect(body).toMatch(/on approval/i);
  });

  it('hands off the why, the approaches considered, and the non-goals', () => {
    const body = getBrainstormSkillTemplate().instructions;

    // The handoff names the dialogue's decisions and the plan sections they
    // land in.
    expect(body).toMatch(/hand ?off/i);
    expect(body).toMatch(/approaches considered/i);
    expect(body).toMatch(/non-goals/i);
    expect(body).toContain('## Why');
    expect(body).toContain('### Approaches considered');
    expect(body).toContain('## Non-goals');
  });

  it('omits the removed source behaviors (negative scenarios)', () => {
    const body = getBrainstormSkillTemplate().instructions;

    // No writing-plans / implementation-skill handoff.
    expect(body).toMatch(/no skill other than/i);
    expect(body).not.toMatch(/writing-plans skill is the next step|invoke the writing-plans skill to create/i);
    expect(body).toMatch(/do \*\*not\*\* hand off to a writing-plans skill/i);

    // No sub-project decomposition into separate spec/plan/impl cycles.
    expect(body).toMatch(/do\s+\*\*not\*\*\s+decompose\s+the request yourself into separate sub-projects/i);
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
