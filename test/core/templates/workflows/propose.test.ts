import { describe, it, expect } from 'vitest';
import {
  getRctProposeSkillTemplate,
  getRctProposeCommandTemplate,
} from '../../../../src/core/templates/workflows/propose.js';
import {
  ISSUE_RECONCILIATION_PRE_AUTHORING,
  ISSUE_RECONCILIATION_POST_AUTHORING,
} from '../../../../src/core/templates/workflows/scope-reconciliation.js';
import { CommandAdapterRegistry } from '../../../../src/core/command-generation/registry.js';
import { generateCommand } from '../../../../src/core/command-generation/generator.js';
import type { CommandContent } from '../../../../src/core/command-generation/types.js';

/** The only two lines that may differ between the skill and command surfaces. */
const SKILL_INPUT_LINE =
  "**Input**: The user's request should include a change name (kebab-case) OR a description of what they want to build.";
const COMMAND_INPUT_LINE =
  '**Input**: The argument after `/rct:propose` is the change name (kebab-case), OR a description of what the user wants to build.';
const SKILL_PROMPT_LINE =
  '- Prompt: "Run `/rct:apply` or ask me to implement to start working on the tasks."';
const COMMAND_PROMPT_LINE = '- Prompt: "Run `/rct:apply` to start implementing."';

describe('propose workflow templates', () => {
  describe('one shared body, two surfaces', () => {
    it('renders the skill and command bodies identically apart from the two known deltas', () => {
      // One builder parameterized by exactly these two lines — this test is
      // what keeps a third divergence from creeping in.
      const skillLines = getRctProposeSkillTemplate().instructions.split('\n');
      const commandLines = getRctProposeCommandTemplate().content.split('\n');

      expect(commandLines.length).toBe(skillLines.length);

      const differing = skillLines
        .map((line, i) => ({ line, other: commandLines[i], i }))
        .filter(({ line, other }) => line !== other);

      expect(differing.map(({ line }) => line)).toEqual([SKILL_INPUT_LINE, SKILL_PROMPT_LINE]);
      expect(differing.map(({ other }) => other)).toEqual([COMMAND_INPUT_LINE, COMMAND_PROMPT_LINE]);
    });

    it('exposes the expected skill and command metadata', () => {
      const skill = getRctProposeSkillTemplate();
      expect(skill.name).toBe('ratchet-propose');
      expect(skill.description).toBeTruthy();

      const command = getRctProposeCommandTemplate();
      expect(command.category).toBe('Workflow');
      expect(command.tags).toEqual(['workflow', 'artifacts', 'experimental']);
    });
  });

  describe('originating-issue reconciliation', () => {
    const body = getRctProposeSkillTemplate().instructions;

    it('carries both shared reconciliation halves verbatim', () => {
      expect(body).toContain(ISSUE_RECONCILIATION_PRE_AUTHORING);
      expect(body).toContain(ISSUE_RECONCILIATION_POST_AUTHORING);
    });

    it('enumerates before the change directory is created', () => {
      const enumerateAt = body.indexOf('2. **Enumerate the requirements of every originating issue**');
      const preAt = body.indexOf(ISSUE_RECONCILIATION_PRE_AUTHORING);
      const createAt = body.indexOf('3. **Create the change directory**');

      expect(enumerateAt).toBeGreaterThan(-1);
      expect(preAt).toBeGreaterThan(enumerateAt);
      expect(createAt).toBeGreaterThan(preAt);
    });

    it('maps and surfaces only after the artifact loop, before the final status', () => {
      const authorAt = body.indexOf('5. **Create artifacts in sequence until apply-ready**');
      const reconcileAt = body.indexOf('6. **Reconcile the authored artifacts against every originating issue**');
      const postAt = body.indexOf(ISSUE_RECONCILIATION_POST_AUTHORING);
      const statusAt = body.indexOf('7. **Show final status**');

      expect(authorAt).toBeGreaterThan(-1);
      expect(reconcileAt).toBeGreaterThan(authorAt);
      expect(postAt).toBeGreaterThan(reconcileAt);
      expect(statusAt).toBeGreaterThan(postAt);
    });

    it('names feature scenarios and plan tasks as the mapping targets', () => {
      expect(body).toMatch(/covered by a feature scenario or a plan task/i);
    });

    it('requires fetching every originating issue before any artifact is written', () => {
      expect(body).toMatch(/identify every originating issue/i);
      expect(body).toMatch(/fetch each issue through the project's issue tracker/i);
      expect(body).toMatch(/BEFORE any artifact is written/);
    });

    it('forbids self-approving an omission in plan prose', () => {
      expect(body).toContain('"issue asks X, this proposal does not include');
      expect(body).toMatch(/MUST NOT self-approve an omission by writing it into plan prose/i);
    });

    it('carries no hand-written restatement of the mapping rule', () => {
      expect(body).not.toMatch(/complete the reconciliation map/i);
      // The mapping instruction appears once: inside the shared constant.
      expect(body.split('Map every enumerated requirement').length - 1).toBe(1);
    });
  });

  describe('neutrality', () => {
    const body = getRctProposeSkillTemplate().instructions;

    it('stays agent-neutral (multi-agent-support)', () => {
      expect(body.toLowerCase()).toContain('your agent');
      expect(body).toContain('AskUserQuestion');
      expect(body).toMatch(/if your agent has one, otherwise ask in plain prose/i);
      // No agent is named in shared template content.
      expect(body).not.toMatch(/\bClaude\b/);
    });

    it('stays tracker-neutral (generalizable-defaults)', () => {
      expect(body).toMatch(/on github, for example/i);
      expect(body).toMatch(/other trackers have their own client/i);
      expect(body).toMatch(/ask the user to paste\s+the issue text/i);
    });
  });

  it('renders the reconciliation rules into every registered tool command', () => {
    // The command is the genuinely per-tool surface: the shared body is formatted
    // into each registered tool's command file via its adapter. Assert the
    // reconciliation text survives every adapter's formatting.
    const cmd = getRctProposeCommandTemplate();
    const content: CommandContent = {
      id: 'rct-propose',
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
      expect(fileContent, label).toContain(ISSUE_RECONCILIATION_PRE_AUTHORING);
      expect(fileContent, label).toContain(ISSUE_RECONCILIATION_POST_AUTHORING);
      // No adapter's rendering drops the prohibition on self-approved omissions.
      expect(fileContent, label).toMatch(/MUST NOT self-approve an omission by writing it into plan prose/i);
      expect(fileContent, label).toMatch(/stop-and-surface event/i);
      expect(fileContent, label).toContain('"partially addresses #N"');
    }
  });
});
