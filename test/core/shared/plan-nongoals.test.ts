import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getSkillTemplates,
  getCommandContents,
  generateSkillContent,
} from '../../../src/core/shared/skill-generation.js';
import { AI_TOOLS } from '../../../src/core/config.js';
import { CommandAdapterRegistry } from '../../../src/core/command-generation/registry.js';
import { generateCommand } from '../../../src/core/command-generation/generator.js';

/**
 * Plan Non-goals and Approaches considered: every plan records what the change
 * deliberately will not do and which approaches were weighed.
 *
 * The plan template (schemas/ratchet/templates/plan.md) carries a default
 * `## Non-goals` section between `## What Changes` and `## Design` — each entry
 * traced to a decision the user, an originating issue, or a brainstorm made,
 * never an omission the agent approved on its own, with an explicit one-liner
 * when nothing was ruled out — and a `### Approaches considered` subsection
 * inside `## Design`, before `## Tasks`, with "one sensible way" allowed when
 * there is genuinely one sensible approach.
 *
 * The schema's plan instruction (schemas/ratchet/schema.yaml) carries the same
 * contract as imperative section bullets: a `**## Non-goals**` bullet between
 * the `**## What Changes**` and `**## Design**` bullets, and the
 * `**## Design**` bullet extended to require the `**### Approaches
 * considered**` subsection.
 *
 * The shared propose body directs the author to keep both sections when
 * authoring a `plan` artifact, and its plan.md listing names `## Non-goals`
 * between `## What Changes` and `## Design`; the rendered skill and command
 * carry that guidance for every registered agent.
 *
 * The shared verify body (src/core/templates/workflows/verify-change.ts)
 * reads plan.md's `## Non-goals` section when the plan carries one and flags
 * each listed Non-goal the implementation implements as a WARNING issue
 * naming the entry, with the remove-or-re-decide recommendation; a plan
 * without the section, or with the explicit nothing-ruled-out one-liner,
 * skips the check and is never failed for the absence. The rendered verify
 * skill and command carry that guidance for every registered agent.
 *
 * Mirrors features/plan-nongoals/template-and-propose-guidance.feature
 * and features/plan-nongoals/verify-implemented-nongoal-flag.feature
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

/**
 * Template predicate over the plan template text. Returns a list of violation
 * descriptions; an empty list means the template carries the default
 * `## Non-goals` section (in the right position, with the traceability
 * guidance) and the `### Approaches considered` subsection inside `## Design`.
 */
function findTemplateViolations(template: string): string[] {
  const violations: string[] = [];

  // 1. Section presence and ordering: `## Non-goals` sits between
  //    `## What Changes` and `## Design`.
  const whatChangesIdx = template.indexOf('## What Changes');
  const nongoalsIdx = template.indexOf('## Non-goals');
  const designIdx = template.indexOf('## Design');
  if (nongoalsIdx === -1) {
    violations.push('the template has no "## Non-goals" section');
  } else if (
    whatChangesIdx === -1 ||
    designIdx === -1 ||
    !(whatChangesIdx < nongoalsIdx && nongoalsIdx < designIdx)
  ) {
    violations.push(
      '"## Non-goals" does not sit between "## What Changes" and "## Design"',
    );
  }

  // 2. Subsection presence and ordering: `### Approaches considered` sits
  //    inside `## Design`, before `## Tasks`.
  const approachesIdx = template.indexOf('### Approaches considered');
  const tasksIdx = template.indexOf('## Tasks');
  if (approachesIdx === -1) {
    violations.push('the template has no "### Approaches considered" subsection');
  } else if (
    designIdx === -1 ||
    tasksIdx === -1 ||
    !(designIdx < approachesIdx && approachesIdx < tasksIdx)
  ) {
    violations.push(
      '"### Approaches considered" does not sit inside "## Design" before "## Tasks"',
    );
  }

  // 3. Guidance wording pins (the template wraps lines, so collapse
  //    whitespace before matching).
  const flat = template.replace(/\s+/g, ' ');
  if (!/What this change deliberately will NOT do\./.test(flat)) {
    violations.push(
      'the "## Non-goals" guidance does not record what the change deliberately will NOT do',
    );
  }
  if (
    !/traces to a decision the user, an originating issue, or a brainstorm made/.test(
      flat,
    )
  ) {
    violations.push(
      'the "## Non-goals" guidance does not trace each entry to a user, issue, or brainstorm decision',
    );
  }
  if (!/never an omission the agent approved on its own/.test(flat)) {
    violations.push(
      'the "## Non-goals" guidance does not forbid an agent self-approved omission',
    );
  }
  if (!/When nothing was ruled out, say so explicitly in one line\./.test(flat)) {
    violations.push(
      'the "## Non-goals" guidance does not direct an explicit nothing-ruled-out one-liner',
    );
  }
  if (
    !/The approaches weighed before settling on the design above, and why each was kept or dropped\./.test(
      flat,
    )
  ) {
    violations.push(
      'the "### Approaches considered" guidance does not name the weighed approaches and their keep/drop rationale',
    );
  }
  if (
    !/"One sensible way" is allowed when there is genuinely one sensible approach/.test(
      flat,
    )
  ) {
    violations.push(
      'the "### Approaches considered" guidance does not allow "one sensible way"',
    );
  }

  return violations;
}

/**
 * Instructions-payload predicate over the schema text (whitespace-collapsed:
 * the YAML literal block wraps lines). Returns a list of violation
 * descriptions; an empty list means the plan instruction carries the
 * `**## Non-goals**` bullet between `**## What Changes**` and `**## Design**`
 * and the `**## Design**` bullet requires the `**### Approaches considered**`
 * subsection with "one sensible way" allowed.
 */
function findInstructionViolations(schemaFlat: string): string[] {
  const violations: string[] = [];

  // 1. Bullet ordering: `**## Non-goals**` between `**## What Changes**` and
  //    `**## Design**`.
  const whatChangesIdx = schemaFlat.indexOf('**## What Changes**');
  const nongoalsIdx = schemaFlat.indexOf('**## Non-goals**');
  const designIdx = schemaFlat.indexOf('**## Design**');
  if (nongoalsIdx === -1) {
    violations.push('the plan instruction has no "**## Non-goals**" bullet');
  } else if (
    whatChangesIdx === -1 ||
    designIdx === -1 ||
    !(whatChangesIdx < nongoalsIdx && nongoalsIdx < designIdx)
  ) {
    violations.push(
      'the "**## Non-goals**" bullet does not sit between "**## What Changes**" and "**## Design**"',
    );
  }

  // 2. The Non-goals bullet carries the traceability rule and the one-liner.
  if (!/\*\*## Non-goals\*\*: What this change deliberately will NOT do\./.test(schemaFlat)) {
    violations.push(
      'the "**## Non-goals**" bullet does not record what the change deliberately will NOT do',
    );
  }
  if (
    !/Each entry traces to a decision the user, an originating issue, or a brainstorm made - never an omission the agent approved on its own\./.test(
      schemaFlat,
    )
  ) {
    violations.push(
      'the "**## Non-goals**" bullet does not carry the traced-decision rule and the self-approved-omission prohibition',
    );
  }
  if (!/When nothing was ruled out, say so explicitly in one line\./.test(schemaFlat)) {
    violations.push(
      'the "**## Non-goals**" bullet does not direct an explicit nothing-ruled-out one-liner',
    );
  }

  // 3. The `**## Design**` bullet requires the `**### Approaches considered**`
  //    subsection (before the `**## Tasks**` bullet) with "one sensible way"
  //    allowed.
  const approachesIdx = schemaFlat.indexOf('**### Approaches considered**');
  const tasksIdx = schemaFlat.indexOf('**## Tasks**');
  if (approachesIdx === -1) {
    violations.push(
      'the plan instruction does not require a "**### Approaches considered**" subsection',
    );
  } else if (
    designIdx === -1 ||
    tasksIdx === -1 ||
    !(designIdx < approachesIdx && approachesIdx < tasksIdx)
  ) {
    violations.push(
      'the "**### Approaches considered**" subsection is not described inside "**## Design**"',
    );
  }
  if (
    !/"one sensible way" is allowed when there is genuinely one sensible approach\./.test(
      schemaFlat,
    )
  ) {
    violations.push(
      'the plan instruction does not allow "one sensible way" when there is genuinely one sensible approach',
    );
  }

  return violations;
}

/**
 * Propose-body predicate over a rendered propose body. Returns a list of
 * violation descriptions; an empty list means the body names `## Non-goals` in
 * its plan.md listing and directs keeping the template's `## Non-goals`
 * section and `### Approaches considered` subsection when authoring a `plan`
 * artifact.
 */
function findPlanNongoalsViolations(body: string): string[] {
  const violations: string[] = [];
  const flat = body.replace(/\s+/g, ' ');

  // 1. The plan.md listing names `## Non-goals` between `## What Changes` and
  //    `## Design`.
  if (
    !/plan\.md \(## Why, ## What Changes, ## Non-goals, ## Design, ## Tasks\)/.test(
      flat,
    )
  ) {
    violations.push(
      'the plan.md listing does not name "## Non-goals" between "## What Changes" and "## Design"',
    );
  }

  // 2. The keep-the-section direction, with its position.
  if (
    !/keep the template's `## Non-goals` section between `## What Changes` and `## Design`/.test(
      flat,
    )
  ) {
    violations.push(
      'the body does not direct keeping the plan\'s "## Non-goals" section between "## What Changes" and "## Design"',
    );
  }

  // 3. The traced-decision rule.
  if (
    !/each entry traced to a decision the user, an originating issue, or a brainstorm made/.test(
      flat,
    )
  ) {
    violations.push(
      'the body does not trace each Non-goal entry to a user, issue, or brainstorm decision',
    );
  }

  // 4. The never-self-approved-omission prohibition.
  if (!/never an omission you approved on your own/.test(flat)) {
    violations.push(
      'the body does not forbid an omission the agent approved on its own',
    );
  }

  // 5. The explicit nothing-ruled-out one-liner.
  if (!/with an explicit one-liner when nothing was ruled out/.test(flat)) {
    violations.push(
      'the body does not direct an explicit one-liner when nothing was ruled out',
    );
  }

  // 6. The `### Approaches considered` subsection inside `## Design`.
  if (!/its `### Approaches considered` subsection inside `## Design`/.test(flat)) {
    violations.push(
      'the body does not direct keeping the "### Approaches considered" subsection inside "## Design"',
    );
  }

  // 7. The "one sensible way" allowance.
  if (
    !/"one sensible way" allowed when there is genuinely one sensible approach/.test(
      flat,
    )
  ) {
    violations.push(
      'the body does not allow "one sensible way" when there is genuinely one sensible approach',
    );
  }

  return violations;
}

/**
 * A sample plan template in the pre-change shape: no `## Non-goals` section
 * and no `### Approaches considered` subsection.
 */
const PRE_CHANGE_TEMPLATE = `# [Change name]

## Why

[1-3 sentences on the problem or opportunity.]

## What Changes

- [Specific change, new capability, modification, or removal]

## Design

[Key technical decisions and approach.]

## Tasks

- [ ] 1.1 [First trackable task]
`;

/**
 * A sample schema plan instruction in the pre-change shape: no `**## Non-goals**`
 * bullet and a `**## Design**` bullet with no Approaches-considered requirement
 * (whitespace-collapsed, as the payload assertions consume it).
 */
const PRE_CHANGE_INSTRUCTION_FLAT =
  '- **## Why**: 1-3 sentences on the problem or opportunity. ' +
  '- **## What Changes**: Bullet list of changes. ' +
  '- **## Design**: Key technical decisions and approach - architecture, data model, dependencies, trade-offs, and any migration concerns. ' +
  '- **## Tasks**: A checklist that breaks the work into trackable items.';

/**
 * A sample propose body in the pre-change shape: the four-section plan listing
 * and no plan-section authoring bullet.
 */
const PRE_CHANGE_BODY = `Propose a new change - create the change and generate all artifacts in one step.

I'll create a change with two artifacts:
- features/<capability>/*.feature (executable Gherkin: Feature / Scenario / Given-When-Then)
- plan.md (## Why, ## What Changes, ## Design, ## Tasks)

5. **Create artifacts in sequence until apply-ready**

   a. **For each artifact that is \`ready\` (dependencies satisfied)**:
      - Create the artifact file using \`template\` as the structure and write it to \`resolvedOutputPath\`
`;

/**
 * A well-formed propose body fragment: the five-section listing and the
 * plan-section authoring bullet.
 */
const WELL_FORMED_BODY = `I'll create a change with two artifacts:
- features/<capability>/*.feature (executable Gherkin: Feature / Scenario / Given-When-Then)
- plan.md (## Why, ## What Changes, ## Non-goals, ## Design, ## Tasks)

      - For a \`plan\` artifact, keep the template's \`## Non-goals\` section
        between \`## What Changes\` and \`## Design\` (each entry traced to a
        decision the user, an originating issue, or a brainstorm made — never an
        omission you approved on your own — with an explicit one-liner when
        nothing was ruled out) and its \`### Approaches considered\` subsection
        inside \`## Design\` ("one sensible way" allowed when there is genuinely
        one sensible approach).
`;

/**
 * Verify-body predicate over a rendered verify body (whitespace-collapsed:
 * the body wraps lines). Returns a list of violation descriptions; an empty
 * list means the body directs reading plan.md's `## Non-goals` section when
 * the plan carries one, checking each listed Non-goal against the
 * implementation, flagging each implemented Non-goal as a WARNING issue
 * naming the entry with the remove-or-re-decide recommendation, skipping the
 * check when the section is absent or records that nothing was ruled out
 * (never failing a plan for lacking the section), and listing "Non-goals the
 * implementation implements" in the WARNING report category.
 */
function findVerifyNongoalViolations(body: string): string[] {
  const violations: string[] = [];
  const flat = body.replace(/\s+/g, ' ');

  // 1. The read-the-section direction.
  if (
    !/Read the `## Non-goals` section of plan\.md when the plan carries one/.test(
      flat,
    )
  ) {
    violations.push(
      'the body does not direct reading plan.md\'s "## Non-goals" section when the plan carries one',
    );
  }

  // 2. The per-entry implementation check.
  if (
    !/For each listed Non-goal, check whether the implementation implements it anyway/.test(
      flat,
    )
  ) {
    violations.push(
      'the body does not direct checking each listed Non-goal against the implementation',
    );
  }

  // 3. The WARNING flag naming the entry.
  if (!/Add WARNING: "Non-goal implemented: <entry>"/.test(flat)) {
    violations.push(
      'the body does not direct flagging an implemented Non-goal as a WARNING issue naming the entry',
    );
  }

  // 4. The specific remove-or-re-decide recommendation.
  if (
    !/Remove the out-of-scope implementation, or confirm the reversed decision with the user and update plan\.md ## Non-goals/.test(
      flat,
    )
  ) {
    violations.push(
      'the body does not carry the remove-or-re-decide recommendation for an implemented Non-goal',
    );
  }

  // 5. The skip-when-absent rule (never failing a plan for lacking the
  //    section).
  if (
    !/When the plan has no `## Non-goals` section/.test(flat) ||
    !/skip this check/.test(flat) ||
    !/never fail a plan for lacking the section/.test(flat)
  ) {
    violations.push(
      'the body does not direct skipping the check when the plan has no "## Non-goals" section, nor promise a plan is never failed for lacking it',
    );
  }

  // 6. The nothing-ruled-out one-liner rule.
  if (
    !/the section states explicitly that nothing was ruled out, there is nothing to check/.test(
      flat,
    )
  ) {
    violations.push(
      'the body does not treat the explicit nothing-ruled-out one-liner as a section with no entries to check',
    );
  }

  // 7. The WARNING report-category entry.
  if (!/Non-goals the implementation implements/.test(flat)) {
    violations.push(
      'the WARNING report category does not list "Non-goals the implementation implements"',
    );
  }

  return violations;
}

/**
 * A sample verify body in the pre-change shape: step 8 carries only Design
 * Adherence and Code Pattern Consistency (no Non-goals check), and the
 * WARNING report category lists no Non-goals entry.
 */
const PRE_CHANGE_VERIFY_BODY = `8. **Verify Coherence**

   **Design Adherence**:
   - Read the \`## Design\` section of plan.md
   - Verify the implementation follows those decisions
   - If a contradiction is detected:
     - Add WARNING: "Design decision not followed: <decision>"
     - Recommendation: "Update implementation or revise plan.md ## Design to match reality"

   **Code Pattern Consistency**:
   - Review new code for consistency with project patterns (naming, structure, style)

    2. **WARNING** (Should fix):
       - Scenarios where divergence is suspected (implemented but may not hold)
       - Design divergences
       - Each with specific recommendation
`;

/**
 * A well-formed verify body fragment: the Non-goals Adherence block beside
 * Design Adherence and the WARNING report-category entry.
 */
const WELL_FORMED_VERIFY_BODY = `8. **Verify Coherence**

   **Design Adherence**:
   - Read the \`## Design\` section of plan.md
   - Verify the implementation follows those decisions

   **Non-goals Adherence**:
   - Read the \`## Non-goals\` section of plan.md when the plan carries one
   - For each listed Non-goal, check whether the implementation implements it anyway
   - If a listed Non-goal is implemented:
     - Add WARNING: "Non-goal implemented: <entry>"
     - Recommendation: "Remove the out-of-scope implementation, or confirm the reversed decision with the user and update plan.md ## Non-goals"
   - When the plan has no \`## Non-goals\` section, or the section states explicitly that nothing was ruled out, there is nothing to check: skip this check, and never fail a plan for lacking the section

    2. **WARNING** (Should fix):
       - Scenarios where divergence is suspected (implemented but may not hold)
       - Design divergences
       - Non-goals the implementation implements
       - Each with specific recommendation
`;

describe('plan Non-goals and Approaches considered (template)', () => {
  // The shipped template is the subject of these assertions, so this block
  // intentionally reads the real repository file rather than a tmpdir fixture.
  const template = readFileSync(
    path.join(REPO_ROOT, 'schemas/ratchet/templates/plan.md'),
    'utf-8',
  );

  it('carries a default "## Non-goals" section between "## What Changes" and "## Design"', () => {
    expect(template).toContain('## Non-goals');
    const whatChangesIdx = template.indexOf('## What Changes');
    const nongoalsIdx = template.indexOf('## Non-goals');
    const designIdx = template.indexOf('## Design');
    expect(whatChangesIdx).toBeGreaterThanOrEqual(0);
    expect(designIdx).toBeGreaterThanOrEqual(0);
    expect(whatChangesIdx).toBeLessThan(nongoalsIdx);
    expect(nongoalsIdx).toBeLessThan(designIdx);
  });

  it('carries a "### Approaches considered" subsection inside "## Design", before "## Tasks"', () => {
    expect(template).toContain('### Approaches considered');
    const designIdx = template.indexOf('## Design');
    const approachesIdx = template.indexOf('### Approaches considered');
    const tasksIdx = template.indexOf('## Tasks');
    expect(designIdx).toBeGreaterThanOrEqual(0);
    expect(tasksIdx).toBeGreaterThanOrEqual(0);
    expect(designIdx).toBeLessThan(approachesIdx);
    expect(approachesIdx).toBeLessThan(tasksIdx);
  });

  it('pins the Non-goals guidance: traced entries, no self-approved omission, the nothing-ruled-out one-liner', () => {
    expect(findTemplateViolations(template)).toEqual([]);
  });

  it('rejects a pre-change template shape (no Non-goals, no Approaches considered)', () => {
    expect(findTemplateViolations(PRE_CHANGE_TEMPLATE)).not.toEqual([]);
  });
});

describe('plan Non-goals and Approaches considered (schema plan instruction)', () => {
  // The shipped schema is the subject of these assertions, read directly from
  // the repository as above. The YAML literal block wraps lines, so the
  // instruction text is matched whitespace-collapsed.
  const schemaFlat = readFileSync(
    path.join(REPO_ROOT, 'schemas/ratchet/schema.yaml'),
    'utf-8',
  ).replace(/\s+/g, ' ');

  it('describes the "## Non-goals" section with the traceability rule and the one-liner', () => {
    expect(schemaFlat).toContain(
      '**## Non-goals**: What this change deliberately will NOT do.',
    );
    expect(schemaFlat).toContain(
      'Each entry traces to a decision the user, an originating issue, or a brainstorm made - never an omission the agent approved on its own.',
    );
    expect(schemaFlat).toContain(
      'When nothing was ruled out, say so explicitly in one line.',
    );
  });

  it('orders the "**## Non-goals**" bullet between "**## What Changes**" and "**## Design**"', () => {
    const whatChangesIdx = schemaFlat.indexOf('**## What Changes**');
    const nongoalsIdx = schemaFlat.indexOf('**## Non-goals**');
    const designIdx = schemaFlat.indexOf('**## Design**');
    expect(whatChangesIdx).toBeGreaterThanOrEqual(0);
    expect(nongoalsIdx).toBeGreaterThanOrEqual(0);
    expect(designIdx).toBeGreaterThanOrEqual(0);
    expect(whatChangesIdx).toBeLessThan(nongoalsIdx);
    expect(nongoalsIdx).toBeLessThan(designIdx);
  });

  it('describes "### Approaches considered" inside "## Design" with "one sensible way" allowed', () => {
    const designIdx = schemaFlat.indexOf('**## Design**');
    const approachesIdx = schemaFlat.indexOf('**### Approaches considered**');
    const tasksIdx = schemaFlat.indexOf('**## Tasks**');
    expect(designIdx).toBeGreaterThanOrEqual(0);
    expect(approachesIdx).toBeGreaterThanOrEqual(0);
    expect(tasksIdx).toBeGreaterThanOrEqual(0);
    expect(designIdx).toBeLessThan(approachesIdx);
    expect(approachesIdx).toBeLessThan(tasksIdx);
    expect(schemaFlat).toContain(
      '"one sensible way" is allowed when there is genuinely one sensible approach.',
    );
  });

  it('holds of the shipped plan instruction and rejects the pre-change instruction shape', () => {
    expect(findInstructionViolations(schemaFlat)).toEqual([]);
    expect(findInstructionViolations(PRE_CHANGE_INSTRUCTION_FLAT)).not.toEqual([]);
  });
});

describe('plan Non-goals and Approaches considered (propose body)', () => {
  describe('the plan-nongoals predicate', () => {
    it('rejects the pre-change body shape (four-section listing, no plan-section bullet) on every dimension', () => {
      const violations = findPlanNongoalsViolations(PRE_CHANGE_BODY);
      expect(violations).toContain(
        'the plan.md listing does not name "## Non-goals" between "## What Changes" and "## Design"',
      );
      expect(violations).toContain(
        'the body does not direct keeping the plan\'s "## Non-goals" section between "## What Changes" and "## Design"',
      );
      expect(violations).toContain(
        'the body does not trace each Non-goal entry to a user, issue, or brainstorm decision',
      );
      expect(violations).toContain(
        'the body does not forbid an omission the agent approved on its own',
      );
      expect(violations).toContain(
        'the body does not direct an explicit one-liner when nothing was ruled out',
      );
      expect(violations).toContain(
        'the body does not direct keeping the "### Approaches considered" subsection inside "## Design"',
      );
      expect(violations).toContain(
        'the body does not allow "one sensible way" when there is genuinely one sensible approach',
      );
      expect(violations).toHaveLength(7);
    });

    it('accepts a well-formed body', () => {
      expect(findPlanNongoalsViolations(WELL_FORMED_BODY)).toEqual([]);
    });
  });

  describe('render loop over the supported-tools registry', () => {
    it('renders the propose skill template for every registered agent with the Non-goals and Approaches guidance', () => {
      const agents = AI_TOOLS.filter((t) => t.skillsDir);
      const skillTemplates = getSkillTemplates(['propose']);
      // The checked set must be non-empty and cover every registered agent: a
      // registry entry silently skipped by this loop fails here.
      expect(agents.length).toBeGreaterThan(0);
      expect(agents.length).toBe(AI_TOOLS.length);
      expect(skillTemplates.length).toBeGreaterThan(0);

      for (const tool of agents) {
        for (const { template, dirName } of skillTemplates) {
          const content = generateSkillContent(template, '0.0.0-test');
          expect(
            findPlanNongoalsViolations(content),
            `propose skill ${dirName} rendered for agent ${tool.value}`,
          ).toEqual([]);
        }
      }
    });

    it('renders the propose command template through every registered adapter with the Non-goals and Approaches guidance', () => {
      const adapters = CommandAdapterRegistry.getAll();
      const commandContents = getCommandContents(['propose']);
      // Non-empty checked set covering every registered agent, as above.
      expect(adapters.length).toBeGreaterThan(0);
      expect(adapters.length).toBe(AI_TOOLS.length);
      expect(commandContents.length).toBeGreaterThan(0);

      for (const adapter of adapters) {
        for (const content of commandContents) {
          const { fileContent } = generateCommand(content, adapter);
          expect(
            findPlanNongoalsViolations(fileContent),
            `propose command ${content.id} rendered for agent ${adapter.toolId}`,
          ).toEqual([]);
        }
      }
    });
  });
});

describe('verify flags an implemented Non-goal (verify body)', () => {
  describe('the verify-nongoal predicate', () => {
    it('rejects the pre-change body shape (no Non-goals check) on every dimension', () => {
      const violations = findVerifyNongoalViolations(PRE_CHANGE_VERIFY_BODY);
      expect(violations).toContain(
        'the body does not direct reading plan.md\'s "## Non-goals" section when the plan carries one',
      );
      expect(violations).toContain(
        'the body does not direct checking each listed Non-goal against the implementation',
      );
      expect(violations).toContain(
        'the body does not direct flagging an implemented Non-goal as a WARNING issue naming the entry',
      );
      expect(violations).toContain(
        'the body does not carry the remove-or-re-decide recommendation for an implemented Non-goal',
      );
      expect(violations).toContain(
        'the body does not direct skipping the check when the plan has no "## Non-goals" section, nor promise a plan is never failed for lacking it',
      );
      expect(violations).toContain(
        'the body does not treat the explicit nothing-ruled-out one-liner as a section with no entries to check',
      );
      expect(violations).toContain(
        'the WARNING report category does not list "Non-goals the implementation implements"',
      );
      expect(violations).toHaveLength(7);
    });

    it('accepts a well-formed body', () => {
      expect(findVerifyNongoalViolations(WELL_FORMED_VERIFY_BODY)).toEqual([]);
    });
  });

  describe('render loop over the supported-tools registry', () => {
    it('renders the verify skill template for every registered agent with the Non-goals Adherence check', () => {
      const agents = AI_TOOLS.filter((t) => t.skillsDir);
      const skillTemplates = getSkillTemplates(['verify']);
      // The checked set must be non-empty and cover every registered agent: a
      // registry entry silently skipped by this loop fails here.
      expect(agents.length).toBeGreaterThan(0);
      expect(agents.length).toBe(AI_TOOLS.length);
      expect(skillTemplates.length).toBeGreaterThan(0);

      for (const tool of agents) {
        for (const { template, dirName } of skillTemplates) {
          const content = generateSkillContent(template, '0.0.0-test');
          expect(
            findVerifyNongoalViolations(content),
            `verify skill ${dirName} rendered for agent ${tool.value}`,
          ).toEqual([]);
        }
      }
    });

    it('renders the verify command template through every registered adapter with the Non-goals Adherence check', () => {
      const adapters = CommandAdapterRegistry.getAll();
      const commandContents = getCommandContents(['verify']);
      // Non-empty checked set covering every registered agent, as above.
      expect(adapters.length).toBeGreaterThan(0);
      expect(adapters.length).toBe(AI_TOOLS.length);
      expect(commandContents.length).toBeGreaterThan(0);

      for (const adapter of adapters) {
        for (const content of commandContents) {
          const { fileContent } = generateCommand(content, adapter);
          expect(
            findVerifyNongoalViolations(fileContent),
            `verify command ${content.id} rendered for agent ${adapter.toolId}`,
          ).toEqual([]);
        }
      }
    });
  });
});
