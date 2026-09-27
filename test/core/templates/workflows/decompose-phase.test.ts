import { describe, it, expect } from 'vitest';
import {
  getDecomposePhaseSkillTemplate,
  getRctDecomposePhaseCommandTemplate,
} from '../../../../src/core/templates/workflows/decompose-phase.js';
import {
  ISSUE_REQUIREMENT_ENUMERATION,
  CLOSE_CLAIM_RULES,
  STOP_AND_SURFACE_GUARDRAIL,
} from '../../../../src/core/templates/workflows/scope-reconciliation.js';
import { CommandAdapterRegistry } from '../../../../src/core/command-generation/registry.js';
import { generateCommand } from '../../../../src/core/command-generation/generator.js';
import type { CommandContent } from '../../../../src/core/command-generation/types.js';

describe('decompose-phase workflow templates', () => {
  it('shares one body between the skill and the command surfaces', () => {
    const skill = getDecomposePhaseSkillTemplate();
    const command = getRctDecomposePhaseCommandTemplate();

    expect(skill.name).toBe('ratchet-decompose-phase');
    expect(command.category).toBe('Workflow');
    expect(command.tags).toEqual(['workflow', 'batch', 'experimental']);
    expect(command.content).toBe(skill.instructions);
  });

  describe('prior-plan deferral sweep (issue #100 criterion 3)', () => {
    const body = getDecomposePhaseSkillTemplate().instructions;

    it('requires reading each prior phase plan, not only the injected done criteria', () => {
      expect(body).toMatch(
        /read each prior phase's shipped change `plan\.md`, not only the injected\s+`done` criteria/i
      );
      expect(body).toMatch(/open the prior phases'\s+shipped change directories and read their `plan\.md` files directly/i);
    });

    it('explains that the injected criteria are a paraphrase hiding plan-prose deferrals', () => {
      expect(body).toMatch(/the injected criteria are a \*\*paraphrase\*\*/i);
      expect(body).toMatch(/never appears in that paraphrase/i);
      expect(body).toMatch(/makes those deferrals \*\*invisible\*\*/i);
    });

    it('requires extracting every out-of-scope, deferred, or revisit item', () => {
      expect(body).toMatch(/extract every deferred item recorded in those plans/i);
      expect(body).toContain('`## Out of scope`');
      expect(body).toMatch(/"deferred", "revisit", "later\s+phase", "follow-up", or equivalent item/i);
      // Not only under a heading that happens to be named "Out of scope".
      expect(body).toMatch(/wherever it appears/i);
    });

    it('mandates the carry-forward / tracked / explicit-drop trichotomy', () => {
      expect(body).toMatch(/resolve EACH extracted item as exactly one of three outcomes/i);
      expect(body).toMatch(/\*\*\(a\) carried forward\*\*/);
      expect(body).toMatch(/\*\*\(b\) tracked\*\*/);
      expect(body).toMatch(/\*\*\(c\) explicitly dropped\*\*/);
      expect(body).toMatch(/matched to an existing OPEN tracking issue/i);
    });

    it('holds a security-relevant "tracked" item to the stop-and-surface guardrail bar', () => {
      // One definition of tracked: outcome (b) defers to the guardrail below for
      // security-, permission-, or integrity-relevant items instead of setting a
      // lower bar of its own.
      expect(body).toMatch(
        /For a security-, permission-, or\s+integrity-relevant item, the tracking issue must meet the bar the\s+stop-and-surface guardrail below sets/i
      );
      expect(STOP_AND_SURFACE_GUARDRAIL).toMatch(/named owner/i);
      expect(STOP_AND_SURFACE_GUARDRAIL).toMatch(/linked\s+from the change plan/i);
      expect(body).toMatch(/does not track the item, and the item is\s+surfaced to the user instead/i);
      // The bar it points at is the guardrail's own text, embedded once.
      expect(body).toContain(STOP_AND_SURFACE_GUARDRAIL);
    });

    it('states that silently ignoring an extracted item is not an outcome', () => {
      expect(body).toMatch(/\*\*Silently ignoring an extracted item is not an available outcome\.\*\*/);
    });

    it('reports the resolved sweep in its output summary', () => {
      expect(body).toMatch(/the deferred items you extracted from the prior phases' plans, each with its\s+resolution/i);
    });
  });

  describe('earned-close verification (issue #100 criterion 4)', () => {
    const body = getDecomposePhaseSkillTemplate().instructions;

    it('verifies prior close-claims in their own numbered step, after grounding and before slicing', () => {
      const groundAt = body.indexOf("1. **Ground in the prior phase's shipped results**");
      const verifyAt = body.indexOf('2. **Verify each prior close-claim was earned**');
      const sliceAt = body.indexOf('3. **Slice the phase into concrete change intents**');

      expect(groundAt).toBeGreaterThan(-1);
      expect(verifyAt).toBeGreaterThan(groundAt);
      expect(sliceAt).toBeGreaterThan(verifyAt);
      expect(body).toMatch(/do not inherit that claim as fact/i);
    });

    it('embeds the shared fetch-and-enumerate procedure verbatim, exactly once', () => {
      expect(body).toContain(ISSUE_REQUIREMENT_ENUMERATION);
      expect(body.split(ISSUE_REQUIREMENT_ENUMERATION).length - 1).toBe(1);
      // The step carries the enumeration inside the verify step, not elsewhere.
      const verifyAt = body.indexOf('2. **Verify each prior close-claim was earned**');
      const sliceAt = body.indexOf('3. **Slice the phase into concrete change intents**');
      const enumAt = body.indexOf(ISSUE_REQUIREMENT_ENUMERATION);
      expect(enumAt).toBeGreaterThan(verifyAt);
      expect(enumAt).toBeLessThan(sliceAt);
    });

    it('carries the hedged-wording rule at the phase boundary', () => {
      expect(body).toMatch(/hedged source wording does not lower the bar/i);
      expect(body).toContain('"Consider"');
      expect(body).toMatch(/security-,\s+permission-, or integrity-relevant, severity governs/i);
    });

    it('carries no hand-written restatement of the fetch-and-enumerate procedure', () => {
      expect(body).not.toMatch(/enumerate its material requirements from both its explicit fix items/i);
      expect(body.split('gh issue view <n>').length - 1).toBe(1);
    });

    it('compares the issue requirements against what the prior done and plan describe', () => {
      expect(body).toMatch(/explicit fix items/i);
      expect(body).toMatch(/problems named in its narrative/i);
      expect(body).toMatch(
        /compare the enumerated requirements against what that phase's `done` and\s+`plan\.md` describe as actually implemented/i
      );
    });

    it('surfaces an unearned claim and carries the remaining scope forward', () => {
      expect(body).toMatch(/the close-claim was\s+\*\*unearned\*\*/i);
      expect(body).toMatch(/surface the unearned\s+claim to the user explicitly/i);
      expect(body).toMatch(/carry\s+the remaining scope forward into this\s+phase's change intents/i);
      expect(body).toMatch(/the claim is\s+never inherited as fact/i);
    });

    it('stays tracker-neutral when fetching the issue', () => {
      expect(body).toContain('gh issue view <n>');
      expect(body).toMatch(/on github, for example/i);
      expect(body).toMatch(/other trackers have\s+their own client/i);
      expect(body).toMatch(/ask the user to paste the issue\s+text/i);
    });
  });

  describe('shared guardrails (issue #100 criterion 5)', () => {
    const body = getDecomposePhaseSkillTemplate().instructions;

    it('embeds the close-claim rule verbatim', () => {
      expect(body).toContain(CLOSE_CLAIM_RULES);
    });

    it('embeds the stop-and-surface guardrail verbatim', () => {
      expect(body).toContain(STOP_AND_SURFACE_GUARDRAIL);
    });

    it('carries the sweep as a guardrail as well as a step', () => {
      expect(body).toMatch(/never silently ignored/i);
    });

    it('stays agent-neutral (multi-agent-support)', () => {
      expect(body.toLowerCase()).toContain('your agent');
      expect(body).not.toMatch(/\bClaude\b/);
    });
  });

  it('renders the decomposition rules into every registered tool command', () => {
    const cmd = getRctDecomposePhaseCommandTemplate();
    const content: CommandContent = {
      id: 'rct-decompose-phase',
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
      const label = `tool: ${adapter.toolId}`;
      // The prior-plan deferral sweep survives every adapter's formatting.
      expect(fileContent, label).toMatch(/extract every deferred item recorded in those plans/i);
      expect(fileContent, label).toMatch(/Silently ignoring an extracted item is not an available outcome/i);
      // …and so does the earned-close verification.
      expect(fileContent, label).toMatch(/Verify each prior close-claim was earned/i);
      expect(fileContent, label).toContain(ISSUE_REQUIREMENT_ENUMERATION);
      expect(fileContent, label).toMatch(/stop-and-surface event/i);
      expect(fileContent, label).toContain('"partially addresses #N"');
    }
  });
});
