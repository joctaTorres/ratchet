import { describe, it, expect } from 'vitest';
import {
  getProposeBatchSkillTemplate,
  getRctProposeBatchCommandTemplate,
} from '../../../../src/core/templates/workflows/propose-batch.js';
import {
  ISSUE_RECONCILIATION_STEP,
  CLOSE_CLAIM_RULES,
  STOP_AND_SURFACE_GUARDRAIL,
} from '../../../../src/core/templates/workflows/scope-reconciliation.js';
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

    // The two allowed proof-of-work kinds. `llm-judge` is NOT offered (it is not
    // yet supported by `batch apply`); the body names it only to warn against it.
    expect(body).toContain('integration');
    expect(body).toContain('blackbox');
    expect(body).toMatch(/llm-judge\` is NOT yet supported|do not use it/i);

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

  describe('originating-issue reconciliation (issue #100 criterion 1)', () => {
    const body = getProposeBatchSkillTemplate().instructions;

    it('carries the shared reconciliation step verbatim', () => {
      expect(body).toContain(ISSUE_RECONCILIATION_STEP);
    });

    it('reconciles before the manifest is scaffolded', () => {
      const reconcileAt = body.indexOf(
        '4. **Reconcile the manifest against every originating issue (before scaffolding)**'
      );
      const scaffoldAt = body.indexOf('5. **Scaffold the manifest via existing machinery (shallow DAG)**');

      expect(reconcileAt).toBeGreaterThan(-1);
      expect(scaffoldAt).toBeGreaterThan(reconcileAt);
      expect(body).toMatch(/BEFORE `ratchet new batch` is run/);
      expect(body).toMatch(/surface every requirement the\s+manifest leaves uncovered to the user BEFORE the manifest is scaffolded/i);
    });

    it('fetches every issue the objective or a phase originates from', () => {
      expect(body).toMatch(/identify every originating issue/i);
      expect(body).toMatch(/fetch each originating issue through the project's issue tracker/i);
      expect(body).toMatch(/when the objective, a phase, or a change intent originates from a tracked\s+issue/i);
    });

    it('reconciles each phase goal, success criterion, and change-level done', () => {
      expect(body).toMatch(/each phase `goal`, each phase `success` criterion, and each change-level\s+`done`/i);
      expect(body).toMatch(/map each enumerated requirement onto the phase `goal`, phase `success`, or\s+change-level `done`/i);
    });

    it('forbids self-approving an omission in plan prose', () => {
      expect(body).toMatch(/MUST NOT self-approve an omission by writing it into plan prose/i);
    });
  });

  describe('no premature close-claims (issue #100 criterion 2)', () => {
    const body = getProposeBatchSkillTemplate().instructions;

    it('forbids hard-coding a close-claim in a goal, a success criterion, or a done', () => {
      expect(body).toMatch(/no premature close-claims in the manifest/i);
      expect(body).toMatch(
        /MUST NOT hard-code\s+`Closes #N` or `Fixes #N` in a phase `goal`, in a phase `success`\s+criterion, or in a change-level `done` for work that has not yet been scoped\s+and verified/i
      );
    });

    it('requires "targets #N" / "addresses #N" phrasing for phase contracts', () => {
      expect(body).toContain('**"targets #N"**');
      expect(body).toContain('**"addresses #N"**');
      expect(body).toMatch(/never as a closing claim/i);
    });

    it('requires partial coverage to say "partially addresses #N"', () => {
      expect(body).toContain('**"partially addresses #N"**');
      expect(body).toMatch(/MUST NOT say `Fixes #N` or `Closes #N`/);
    });

    it('earns the closing linkage at pull-request-authoring time', () => {
      expect(body).toMatch(
        /`Closes #N` linkage is earned at pull-request-authoring time, only\s+after the issue's material requirements are confirmed implemented/i
      );
    });

    it('repeats the phrasing rule where the manifest fields are written', () => {
      expect(body).toMatch(/\*\*Issue references\*\*/);
      expect(body).toMatch(/Never write `Closes #N` or\s+`Fixes #N` into the manifest/i);
    });

    it('embeds the shared close-claim and stop-and-surface guardrails verbatim', () => {
      expect(body).toContain(CLOSE_CLAIM_RULES);
      expect(body).toContain(STOP_AND_SURFACE_GUARDRAIL);
    });
  });

  it('renders the reconciliation and close-claim rules into every registered tool command', () => {
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
      const label = `tool: ${adapter.toolId}`;
      expect(fileContent, label).toMatch(/fetch each originating issue through the project's issue tracker/i);
      expect(fileContent, label).toMatch(/MUST NOT self-approve an omission by writing it into plan prose/i);
      expect(fileContent, label).toMatch(/no premature close-claims in the manifest/i);
      expect(fileContent, label).toContain('"partially addresses #N"');
      expect(fileContent, label).toMatch(/stop-and-surface event/i);
    }
  });
});
