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
import {
  getApplyChangeSkillTemplate,
  getRctApplyCommandTemplate,
} from '../../../src/core/templates/workflows/apply-change.js';
import {
  getRctProposeSkillTemplate,
  getRctProposeCommandTemplate,
} from '../../../src/core/templates/workflows/propose.js';
import {
  getOpenPrSkillTemplate,
  getRctOpenPrCommandTemplate,
} from '../../../src/core/templates/workflows/open-pr.js';

/**
 * Lifecycle honesty: the rendered verify, apply, propose, and open-pr skill
 * and command bodies, for every registered agent, can no longer claim more
 * than they proved.
 *
 * Verify: an uncovered scenario is CRITICAL, an unrun check is "Not verified"
 * and blocks "Ready for archive", test evidence means a fresh run of the
 * project's own discovered test command, and reasonable inference is not test
 * evidence.
 *
 * Apply: one shared APPLY_BODY authors the skill and the command, scope
 * narrowing is a stop-name-ask event (never silent), a task is ticked [x]
 * only with concrete evidence the specified behavior is fully implemented,
 * completion suggests /rct:verify before any archive, and the runtime apply
 * payload (schema apply instruction + instructions command strings) defers
 * to those rules in minimal wording.
 *
 * Propose: the shared body states and enforces a hard planning boundary — it
 * authors the change artifacts and its work ends there; it never implements
 * the plan's tasks in the same response (not partially, not one task, not a
 * head start, not even when asked), ends the turn after the final status,
 * and hands implementation to /rct:apply; neither closing prompt invites
 * same-response implementation.
 *
 * Open-pr: one shared OPEN_PR_BODY authors the skill and the command, and it
 * pushes only a freshly tested tree — the project's own discovered test
 * command runs fresh on the committed tree (the exact commit that will be
 * pushed) between the commit step and the push step; a red, unrun, or
 * undiscoverable test result stops the flow with no push and no pull request;
 * the push never force-pushes and a rejected push is stopped and reported,
 * never retried; the output summary cites the exact test command and its
 * fresh green result.
 *
 * Mirrors:
 * - features/verify-report-honesty/honest-verdicts.feature
 * - features/lifecycle-honesty/verify-rendered-output.feature
 * - features/apply-scope-honesty/honest-scope.feature
 * - features/lifecycle-honesty/apply-rendered-output.feature
 * - features/propose-planning-boundary/planning-only.feature
 * - features/lifecycle-honesty/propose-rendered-output.feature
 * - features/open-pr-tested-push/tested-push.feature
 * - features/lifecycle-honesty/open-pr-rendered-output.feature
 */

/**
 * Honesty predicate over a rendered verify body. Returns a list of violation
 * descriptions; an empty list means the body carries every honesty guardrail.
 */
function findHonestyViolations(body: string): string[] {
  const violations: string[] = [];
  const flat = body.replace(/\s+/g, ' ');

  // 1. A scenario with no implementation and no test is a CRITICAL issue,
  //    and the pre-change WARNING form is gone.
  if (!/CRITICAL issue:\s*"Scenario not covered:/.test(flat)) {
    violations.push(
      'an uncovered scenario (no implementation and no test) is not a CRITICAL issue',
    );
  }
  if (/WARNING:\s*"Scenario not covered:/.test(flat)) {
    violations.push(
      'an uncovered scenario is still classified as a WARNING (pre-change shape)',
    );
  }

  // 2. "Not verified" reporting: any check that could not run is reported
  //    "Not verified" with the reason, is never scored as passing, and gates
  //    the "Ready for archive" assessment.
  if (!/"Not verified"/.test(flat)) {
    violations.push('no "Not verified" reporting');
  }
  if (!/never scored as passing/i.test(flat)) {
    violations.push('"Not verified" is not stated as never scored as passing');
  }
  if (!/every "Not verified" check blocks "Ready for archive"/.test(flat)) {
    violations.push('"Not verified" does not block "Ready for archive"');
  }
  if (
    !/"Ready for archive"[^.]*appears only when every applicable check ran/.test(
      flat,
    )
  ) {
    violations.push(
      '"Ready for archive" is not gated on every applicable check having run',
    );
  }
  if (
    !/name every "Not verified" check and its reason instead of claiming readiness/.test(
      flat,
    )
  ) {
    violations.push(
      'the final assessment does not name every "Not verified" check and its reason',
    );
  }

  // 3. Fresh test evidence: discover the project's own test command from the
  //    project (no new ratchet configuration), run it fresh, cite the exact
  //    command and fresh result; undiscoverable/unrunnable is "Not verified",
  //    a failing run is CRITICAL.
  if (!/Discover the project's own test command from the project itself/.test(flat)) {
    violations.push('no discovery of the project\'s own test command');
  }
  if (!/Do NOT add new ratchet configuration/.test(flat)) {
    violations.push('test-command discovery is not config-free');
  }
  if (!/run the command fresh/.test(flat)) {
    violations.push('the discovered test command is not run fresh');
  }
  if (!/cite the exact command and the fresh result/.test(flat)) {
    violations.push('the fresh test-command result is not cited in the report');
  }
  if (!/Not verified \(no test command discovered\)/.test(flat)) {
    violations.push(
      'an undiscoverable test command is not reported "Not verified"',
    );
  }
  if (!/CRITICAL issue "Test command fails:/.test(flat)) {
    violations.push('a failing fresh test run is not a CRITICAL issue');
  }

  // 4. Reasonable inference no longer counts as test evidence.
  if (
    !/Reasonable inference no longer counts as test evidence/.test(flat)
  ) {
    violations.push(
      'the body does not state that reasonable inference no longer counts as test evidence',
    );
  }
  if (!/test evidence means a fresh run of the project's own test command/.test(flat)) {
    violations.push(
      'test evidence is not defined as a fresh run of the project\'s own test command',
    );
  }

  // 5. @holdout handling is unchanged: exactly one non-blocking WARNING
  //    naming only the held-out scenario count, no guessing or recovering of
  //    held-out names or steps, and absence is not a coverage gap.
  if (
    !/exactly one non-blocking WARNING/.test(flat) ||
    !/`heldOutCount` @holdout scenario\(s\) are excluded from this view/.test(flat)
  ) {
    violations.push('the @holdout warning is missing or no longer non-blocking');
  }
  if (
    !/Do NOT attempt to guess or recover the names or steps of held-out scenarios/.test(
      flat,
    )
  ) {
    violations.push('the @holdout no-guessing rule is missing');
  }
  if (!/Do NOT treat the gap as a coverage deficiency/.test(flat)) {
    violations.push('the @holdout absence-is-not-a-coverage-gap rule is missing');
  }

  return violations;
}

/**
 * A sample verify body in the pre-change shape: an uncovered scenario is only
 * a WARNING, reasonable inference counts as evidence, and unrun checks are
 * silently scored as passing.
 */
const PRE_CHANGE_BODY = `Verify that an implementation matches the change artifacts.

7. **Verify Correctness (Scenario by Scenario)**

   - If no implementation or test covers the scenario:
     - Add WARNING: "Scenario not covered: <scenario name>"
     - Recommendation: "Add test or implementation for: <Given/When/Then>"

**Final Assessment**:
- If CRITICAL issues: "X critical issue(s) found. Fix before archiving."
- If only warnings: "No critical issues. Y warning(s) to consider. Ready for archive (with noted improvements)."
- If all clear: "All scenarios satisfied and all tasks checked. Ready for archive."

**Verification Heuristics**

- **Correctness**: Map each Given/When/Then to code and tests; use reasonable inference, don't require perfect certainty
`;

describe('lifecycle honesty (verify)', () => {
  describe('the honesty predicate', () => {
    it('rejects the pre-change body shape (uncovered scenario as WARNING, inference as evidence, unrun checks silent)', () => {
      expect(findHonestyViolations(PRE_CHANGE_BODY)).not.toEqual([]);
    });

    it('rejects a body that keeps the "Scenario not covered" WARNING form', () => {
      const body = `${PRE_CHANGE_BODY}\n- Add CRITICAL issue: "Scenario not covered: <name>"`;
      expect(findHonestyViolations(body)).not.toEqual([]);
    });

    it('rejects a body that reports "Not verified" without gating readiness on it', () => {
      const body = `Any check that could not run is "Not verified" and is never scored as passing.
- If all clear: "All scenarios satisfied and all tasks checked. Ready for archive."`;
      expect(findHonestyViolations(body)).not.toEqual([]);
    });

    it('rejects a body that cites a test command without running it fresh', () => {
      const body = `Discover the project's own test command from the project itself and cite the exact command and the fresh result. Do NOT add new ratchet configuration.
- If all clear: "Ready for archive."`;
      expect(findHonestyViolations(body)).not.toEqual([]);
    });
  });

  describe('render loop over the supported-tools registry', () => {
    it('renders the verify skill template for every registered agent with the honesty guardrails', () => {
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
            findHonestyViolations(content),
            `verify skill ${dirName} rendered for agent ${tool.value}`,
          ).toEqual([]);
        }
      }
    });

    it('renders the verify command template through every registered adapter with the honesty guardrails', () => {
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
            findHonestyViolations(fileContent),
            `verify command ${content.id} rendered for agent ${adapter.toolId}`,
          ).toEqual([]);
        }
      }
    });
  });
});

/**
 * Scope-honesty predicate over a rendered apply body. Returns a list of
 * violation descriptions; an empty list means the body carries every
 * scope-honesty guardrail.
 *
 * Command adapters for hyphen-syntax agents rewrite `/rct:` to `/rct-`, so
 * cross-workflow references are matched as `/rct[:-]…`.
 */
function findApplyHonestyViolations(body: string): string[] {
  const violations: string[] = [];
  const flat = body.replace(/\s+/g, ' ');

  // 1. Scope narrowing is a stop-name-ask event, never silent, and stated
  //    as consistent with scope reconciliation's omission principle.
  if (!/No silent scope narrowing/.test(flat)) {
    violations.push('no "No silent scope narrowing" rule');
  }
  if (!/STOP\. Name the scope you would have to narrow, and ask the user/.test(flat)) {
    violations.push('scope narrowing is not a stop-name-ask event');
  }
  if (
    !/Never silently implement a narrower behavior than the scenario or task specifies/.test(
      flat,
    )
  ) {
    violations.push('silent scope narrowing is not forbidden');
  }
  if (!/unwritten intention is an omission/.test(flat)) {
    violations.push('the scope rule does not cite the omission principle');
  }
  if (!/omissions are the user's decision, never the agent's/.test(flat)) {
    violations.push('the scope rule does not assign omissions to the user');
  }

  // 2. A task is ticked [x] only with concrete evidence the specified
  //    behavior is fully implemented; partial work stays unticked and is
  //    reported as partial.
  if (
    !/only with concrete evidence the specified behavior[^.]*is fully implemented/.test(
      flat,
    )
  ) {
    violations.push(
      'ticking [x] is not gated on concrete evidence of the fully implemented specified behavior',
    );
  }
  if (!/Never tick `\[x\]` on partial, inferred, or intended work/.test(flat)) {
    violations.push('ticking [x] on partial, inferred, or intended work is not forbidden');
  }
  if (!/stays unticked and is reported as partial/.test(flat)) {
    violations.push('the partial-work corollary (unticked and reported) is missing');
  }

  // 3. Completion suggests /rct:verify before any archive; the archive-first
  //    completion wording is gone.
  if (!/suggest running `\/rct[:-]verify`/.test(flat)) {
    violations.push('/rct:verify is not suggested when all tasks are done');
  }
  if (!/All tasks complete! Run `\/rct[:-]verify`/.test(flat)) {
    violations.push('the completion output does not suggest /rct:verify');
  }
  if (/If all done: suggest archive/.test(flat)) {
    violations.push('the status step still suggests archive on completion (pre-change shape)');
  }
  if (/You can archive this change with|Ready to archive this change/.test(flat)) {
    violations.push(
      'the completion output still presents archive as the next step (pre-change shape)',
    );
  }

  return violations;
}

/**
 * A sample apply body in the pre-change shape: no scope-narrowing rule,
 * tasks ticked without evidence, and archive suggested on completion.
 */
const PRE_CHANGE_APPLY_BODY = `Implement tasks from a Ratchet change.

6. **Implement tasks (loop until done or blocked)**

   For each pending task:
   - Implement so each related Scenario's Given/When/Then holds true
   - Mark task complete in \`plan.md\` under \`## Tasks\`: \`- [ ]\` → \`- [x]\`

7. **On completion or pause, show status**

   Display:
   - If all done: suggest archive

All tasks complete! You can archive this change with \`/rct:archive\`.
`;

describe('lifecycle honesty (apply)', () => {
  describe('the scope-honesty predicate', () => {
    it('rejects the pre-change body shape (silent narrowing allowed, ticking without evidence, archive on completion)', () => {
      expect(findApplyHonestyViolations(PRE_CHANGE_APPLY_BODY)).not.toEqual([]);
    });

    it('rejects a body that ticks [x] without the evidence bar', () => {
      const body = `No silent scope narrowing. If the specified behavior cannot be implemented as written, STOP. Name the scope you would have to narrow, and ask the user. Never silently implement a narrower behavior than the scenario or task specifies: an unwritten intention is an omission, and omissions are the user's decision, never the agent's.
- Mark task complete in \`plan.md\`: \`- [ ]\` → \`- [x]\`
- If all done: suggest running \`/rct:verify\`
All tasks complete! Run \`/rct:verify\` to check the completion claims before any archive.`;
      expect(findApplyHonestyViolations(body)).not.toEqual([]);
    });

    it('rejects a body that keeps the archive-first completion wording', () => {
      const body = `${PRE_CHANGE_APPLY_BODY}
No silent scope narrowing. STOP. Name the scope you would have to narrow, and ask the user. Never silently implement a narrower behavior than the scenario or task specifies: an unwritten intention is an omission, and omissions are the user's decision, never the agent's.
- Mark the task complete only with concrete evidence the specified behavior is fully implemented. Never tick \`[x]\` on partial, inferred, or intended work — a partially implemented task stays unticked and is reported as partial.`;
      expect(findApplyHonestyViolations(body)).not.toEqual([]);
    });

    it('rejects a body with a scope rule that is not a stop-name-ask event', () => {
      const body = `Implement the widest reasonable interpretation of each task.
- Mark the task complete only with concrete evidence the specified behavior is fully implemented. Never tick \`[x]\` on partial, inferred, or intended work — a partially implemented task stays unticked and is reported as partial.
- If all done: suggest running \`/rct:verify\`
All tasks complete! Run \`/rct:verify\` to check the completion claims before any archive.`;
      expect(findApplyHonestyViolations(body)).not.toEqual([]);
    });
  });

  describe('the shared APPLY_BODY collapse', () => {
    // The subject of these assertions is the shipped template module itself,
    // so this block intentionally reads the real repository file rather than
    // a tmpdir fixture.
    const sourcePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../src/core/templates/workflows/apply-change.ts',
    );
    const source = readFileSync(sourcePath, 'utf-8');

    it('names one shared APPLY_BODY constant consumed by both getters', () => {
      expect(source).toMatch(/const APPLY_BODY = `/);
      expect(source).toMatch(/instructions:\s*APPLY_BODY/);
      expect(source).toMatch(/content:\s*APPLY_BODY/);
    });

    it('renders byte-identical bodies from the skill getter and the command getter', () => {
      expect(getApplyChangeSkillTemplate().instructions).toBe(
        getRctApplyCommandTemplate().content,
      );
    });
  });

  describe('the runtime apply payload alignment', () => {
    // The shipped schema and instructions sources are the subjects, read
    // directly from the repository as above.
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const schemaFlat = readFileSync(
      path.join(repoRoot, 'schemas/ratchet/schema.yaml'),
      'utf-8',
    ).replace(/\s+/g, ' ');
    const instructionsFlat = readFileSync(
      path.join(repoRoot, 'src/commands/workflow/instructions.ts'),
      'utf-8',
    ).replace(/\s+/g, ' ');

    it('the shipped schema apply instruction ticks a task only with evidence, deferring to the apply workflow', () => {
      expect(schemaFlat).toContain(
        'ticking a task only once its specified behavior is fully implemented with evidence, as the apply workflow requires',
      );
    });

    it('the all_done instruction suggests /rct:verify before any archive', () => {
      expect(instructionsFlat).toContain(
        'Run /rct:verify to check the completion claims before any archive',
      );
    });

    it('the ready-state fallback carries the same evidence wording', () => {
      expect(instructionsFlat).toContain(
        'ticking a task only once its specified behavior is fully implemented with evidence',
      );
    });

    it('the payload does not restate the stop-name-ask scope rule', () => {
      expect(schemaFlat).not.toMatch(/name the scope/i);
      expect(instructionsFlat).not.toMatch(/name the scope/i);
    });

    it('the old payload phrases are gone', () => {
      expect(schemaFlat).not.toContain('marking them complete as you go');
      expect(instructionsFlat).not.toContain('mark complete as you go');
      expect(instructionsFlat).not.toContain('ready to be archived');
    });
  });

  describe('render loop over the supported-tools registry', () => {
    it('renders the apply skill template for every registered agent with the scope-honesty guardrails', () => {
      const agents = AI_TOOLS.filter((t) => t.skillsDir);
      const skillTemplates = getSkillTemplates(['apply']);
      // The checked set must be non-empty and cover every registered agent: a
      // registry entry silently skipped by this loop fails here.
      expect(agents.length).toBeGreaterThan(0);
      expect(agents.length).toBe(AI_TOOLS.length);
      expect(skillTemplates.length).toBeGreaterThan(0);

      for (const tool of agents) {
        for (const { template, dirName } of skillTemplates) {
          const content = generateSkillContent(template, '0.0.0-test');
          expect(
            findApplyHonestyViolations(content),
            `apply skill ${dirName} rendered for agent ${tool.value}`,
          ).toEqual([]);
        }
      }
    });

    it('renders the apply command template through every registered adapter with the scope-honesty guardrails', () => {
      const adapters = CommandAdapterRegistry.getAll();
      const commandContents = getCommandContents(['apply']);
      // Non-empty checked set covering every registered agent, as above.
      expect(adapters.length).toBeGreaterThan(0);
      expect(adapters.length).toBe(AI_TOOLS.length);
      expect(commandContents.length).toBeGreaterThan(0);

      for (const adapter of adapters) {
        for (const content of commandContents) {
          const { fileContent } = generateCommand(content, adapter);
          expect(
            findApplyHonestyViolations(fileContent),
            `apply command ${content.id} rendered for agent ${adapter.toolId}`,
          ).toEqual([]);
        }
      }
    });
  });
});

/**
 * Planning-boundary predicate over a rendered propose body. Returns a list of
 * violation descriptions; an empty list means the body states and enforces the
 * planning boundary.
 *
 * Command adapters for hyphen-syntax agents rewrite `/rct:` to `/rct-`, so
 * cross-workflow references are matched as `/rct[:-]…`.
 */
function findProposeBoundaryViolations(body: string): string[] {
  const violations: string[] = [];
  const flat = body.replace(/\s+/g, ' ');

  // 1. The boundary is stated: the workflow's job is to author the change
  //    artifacts and its work ends there, named explicitly as a planning
  //    boundary.
  if (!/workflow's job is to author the change artifacts/.test(flat)) {
    violations.push(
      "the body does not state that the workflow's job is to author the change artifacts",
    );
  }
  if (!/its work ends there/.test(flat)) {
    violations.push('the body does not state that the workflow\'s work ends at authoring');
  }
  if (!/planning boundary/i.test(flat)) {
    violations.push('the boundary is not named explicitly as a planning boundary');
  }

  // 2. The boundary is enforced: no same-response implementation of the
  //    plan's tasks — not partially, not one task, not a head start, not even
  //    when asked — and the turn ends after the final status, handing
  //    implementation to /rct:apply as a separate step.
  if (!/Never implement any of the plan's tasks in this same response/.test(flat)) {
    violations.push('implementing the plan\'s tasks in the same response is not forbidden');
  }
  if (!/not partially, not one task, not a head start/.test(flat)) {
    violations.push('the partial-implementation corollary (not one task, not a head start) is missing');
  }
  if (!/not even when the user asks in the same breath/.test(flat)) {
    violations.push('the asked-in-the-same-breath corollary is missing');
  }
  if (!/end the turn after authoring, reconciliation, and the final status/i.test(flat)) {
    violations.push('the body does not direct the agent to end the turn after the final status');
  }
  if (!/hand implementation to `\/rct[:-]apply` as a separate step/.test(flat)) {
    violations.push('implementation is not handed to /rct:apply as a separate step');
  }

  // 3. Boundary-safe closing prompt: routes to /rct:apply to start
  //    implementing and never invites same-response implementation.
  if (!/Run `\/rct[:-]apply` to start implementing/.test(flat)) {
    violations.push('the closing prompt does not route to /rct:apply to start implementing');
  }
  if (/ask me to implement/i.test(flat)) {
    violations.push(
      'the closing prompt still invites same-response implementation (pre-change shape)',
    );
  }

  return violations;
}

/**
 * A sample propose body in the pre-change shape: no planning boundary, and a
 * closing prompt that invites the agent to implement in the same response.
 */
const PRE_CHANGE_PROPOSE_BODY = `Propose a new change - create the change and generate all artifacts in one step.

I'll create a change with two artifacts:
- features/<capability>/*.feature (executable Gherkin: Feature / Scenario / Given-When-Then)
- plan.md (## Why, ## What Changes, ## Design, ## Tasks)

When ready to implement, run /rct:apply

7. **Show final status**
   \`\`\`bash
   ratchet status --change "<name>"
   \`\`\`

- Prompt: "Run \`/rct:apply\` or ask me to implement to start working on the tasks."
`;

describe('lifecycle honesty (propose)', () => {
  describe('the planning-boundary predicate', () => {
    it('rejects the pre-change body shape (no planning boundary, closing prompt invites same-response implementation)', () => {
      expect(findProposeBoundaryViolations(PRE_CHANGE_PROPOSE_BODY)).not.toEqual([]);
    });

    it('rejects a body that states the boundary without enforcing it', () => {
      const body = `**Planning boundary**: this workflow's job is to author the change artifacts and its work ends there.
- Prompt: "Run \`/rct:apply\` to start implementing."`;
      expect(findProposeBoundaryViolations(body)).not.toEqual([]);
    });

    it('rejects a body that enforces the boundary without stating it', () => {
      const body = `Never implement any of the plan's tasks in this same response — not partially, not one task, not a head start, and not even when the user asks in the same breath. End the turn after authoring, reconciliation, and the final status, and hand implementation to \`/rct:apply\` as a separate step.
- Prompt: "Run \`/rct:apply\` to start implementing."`;
      expect(findProposeBoundaryViolations(body)).not.toEqual([]);
    });

    it('rejects a body whose closing prompt still invites same-response implementation', () => {
      const body = `**Planning boundary**: this workflow's job is to author the change artifacts and its work ends there.
Never implement any of the plan's tasks in this same response — not partially, not one task, not a head start, and not even when the user asks in the same breath. End the turn after authoring, reconciliation, and the final status, and hand implementation to \`/rct:apply\` as a separate step.
- Prompt: "Run \`/rct:apply\` or ask me to implement to start working on the tasks."`;
      expect(findProposeBoundaryViolations(body)).not.toEqual([]);
    });

    it('rejects a body whose enforcement omits the asked-in-the-same-breath corollary', () => {
      const body = `**Planning boundary**: this workflow's job is to author the change artifacts and its work ends there.
Never implement any of the plan's tasks in this same response — not partially, not one task, not a head start. End the turn after authoring, reconciliation, and the final status, and hand implementation to \`/rct:apply\` as a separate step.
- Prompt: "Run \`/rct:apply\` to start implementing."`;
      expect(findProposeBoundaryViolations(body)).not.toEqual([]);
    });
  });

  describe('the shared propose body builder', () => {
    // The subject of these assertions is the shipped template module itself,
    // so this block intentionally reads the real repository file rather than
    // a tmpdir fixture.
    const sourcePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../src/core/templates/workflows/propose.ts',
    );
    const source = readFileSync(sourcePath, 'utf-8');

    it('keeps one shared body builder consumed by both getters', () => {
      expect(source).toMatch(/function buildProposeBody\(/);
      expect(source).toMatch(/instructions:\s*buildProposeBody\(/);
      expect(source).toMatch(/content:\s*buildProposeBody\(/);
    });

    it('renders the planning-boundary text from both the skill getter and the command getter', () => {
      expect(findProposeBoundaryViolations(getRctProposeSkillTemplate().instructions)).toEqual([]);
      expect(findProposeBoundaryViolations(getRctProposeCommandTemplate().content)).toEqual([]);
    });
  });

  describe('render loop over the supported-tools registry', () => {
    it('renders the propose skill template for every registered agent with the planning-boundary guardrails', () => {
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
            findProposeBoundaryViolations(content),
            `propose skill ${dirName} rendered for agent ${tool.value}`,
          ).toEqual([]);
        }
      }
    });

    it('renders the propose command template through every registered adapter with the planning-boundary guardrails', () => {
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
            findProposeBoundaryViolations(fileContent),
            `propose command ${content.id} rendered for agent ${adapter.toolId}`,
          ).toEqual([]);
        }
      }
    });
  });
});

/**
 * Tested-push predicate over a rendered open-pr body. Returns a list of
 * violation descriptions; an empty list means the body carries every
 * tested-push guardrail.
 */
function findOpenPrHonestyViolations(body: string): string[] {
  const violations: string[] = [];
  const flat = body.replace(/\s+/g, ' ');

  // 1. Discovery: the project's own test command from the project itself —
  //    manifest test script, Makefile test target, CI configuration — with no
  //    new ratchet configuration and no assumed toolchain.
  if (!/Discover the project's own test command from the project itself/.test(flat)) {
    violations.push('no discovery of the project\'s own test command');
  }
  if (!/package manifest test script, a Makefile test target, CI configuration/.test(flat)) {
    violations.push('the discovery sources (manifest, Makefile, CI) are not named');
  }
  if (!/Do NOT add new ratchet configuration/.test(flat)) {
    violations.push('test-command discovery is not config-free');
  }
  if (!/do NOT assume a toolchain/.test(flat)) {
    violations.push('test-command discovery is not toolchain-agnostic');
  }

  // 2. The fresh run happens on the committed tree — the exact commit that
  //    will be pushed — before any push, and the test step sits between the
  //    commit step and the push step.
  if (!/Run the discovered command fresh on the committed tree/.test(flat)) {
    violations.push('the discovered test command is not run fresh on the committed tree');
  }
  if (!/the exact commit you are about to push — before any push/.test(flat)) {
    violations.push(
      'the tested tree is not pinned to the exact commit being pushed, before any push',
    );
  }
  const commitIdx = flat.indexOf('Commit the accumulated uncommitted work');
  const testIdx = flat.indexOf(
    "Run the project's own test command fresh on the committed tree",
  );
  const pushIdx = flat.indexOf('Push the work branch to its remote');
  if (
    !(
      commitIdx !== -1 &&
      testIdx !== -1 &&
      pushIdx !== -1 &&
      commitIdx < testIdx &&
      testIdx < pushIdx
    )
  ) {
    violations.push('the test step does not sit between the commit step and the push step');
  }

  // 3. Red or unrun stops the flow: STOP and report the exact command and its
  //    failing result; never push a red tree; never open the pull request on a
  //    red or unrun test result; undiscoverable or unrunnable is a STOP, and
  //    the PR is opened only on a fresh green run.
  if (!/STOP and report the exact command and its failing result/.test(flat)) {
    violations.push('a failing fresh run is not a stop-and-report event');
  }
  if (!/[Nn]ever push a red tree/.test(flat)) {
    violations.push('pushing a red tree is not forbidden');
  }
  if (!/never open the pull request on a red or unrun test result/.test(flat)) {
    violations.push('opening the PR on a red or unrun test result is not forbidden');
  }
  if (
    !/no test command can be discovered, or the run cannot complete: STOP and report the reason/.test(
      flat,
    )
  ) {
    violations.push(
      'an undiscoverable or unrunnable test command is not a stop-and-report event',
    );
  }
  if (
    !/The pull request is opened only on a fresh green run of the project's own test command/.test(
      flat,
    )
  ) {
    violations.push('the PR is not gated on a fresh green run');
  }

  // 4. Never force-push; a rejected push stops the step and is reported, never
  //    retried or forced.
  if (!/NEVER force-push under any circumstances/.test(flat)) {
    violations.push('force-pushing is not forbidden under any circumstances');
  }
  if (!/git push --force/.test(flat) || !/--force-with-lease/.test(flat)) {
    violations.push('the force-push ban does not name --force and --force-with-lease');
  }
  if (
    !/If the remote rejects the push, STOP and report the rejection, naming what the remote said/.test(
      flat,
    )
  ) {
    violations.push('a rejected push is not a stop-and-report event');
  }
  if (!/do NOT retry the push and do NOT force it/.test(flat)) {
    violations.push('retrying or forcing a rejected push is not forbidden');
  }

  // 5. The output summary cites the exact test command discovered and run and
  //    its fresh green result.
  if (!/The exact test command you discovered and ran, and its fresh green result/.test(flat)) {
    violations.push(
      'the output summary does not cite the exact test command and its fresh green result',
    );
  }

  return violations;
}

/**
 * A sample open-pr body in the pre-change shape: commits, pushes, and opens
 * the pull request with no test run, no force-push rule, and no rejected-push
 * rule.
 */
const PRE_CHANGE_OPEN_PR_BODY = `Open the single pull request for the work on this branch.

**Steps**

1. **Derive the repository's commit-message style from \`git log\`**

2. **Commit the accumulated uncommitted work**

   Stage and commit the accumulated uncommitted work of the prior stage agents on
   the work branch.

3. **Push the work branch to its remote**

   Push the work branch to its remote (setting the upstream if it is not yet
   tracked) so the forge can open a pull request from it.

4. **Open exactly one pull request to the supplied base branch**

**Output**

After opening the PR, summarize:
- The commit you authored on the work branch.
- The work branch you pushed and its remote.
- The single pull request you opened.

**Guardrails**
- Open EXACTLY ONE pull request — never more than one.
`;

describe('lifecycle honesty (open-pr)', () => {
  describe('the tested-push predicate', () => {
    it('rejects the pre-change body shape (no test run, no force-push rule, no rejected-push rule)', () => {
      expect(findOpenPrHonestyViolations(PRE_CHANGE_OPEN_PR_BODY)).not.toEqual([]);
    });

    it('rejects a body that runs tests without pinning the tested tree to the pushed commit', () => {
      const body = `2. **Commit the accumulated uncommitted work**
3. **Run the project's own test command fresh on the committed tree**
   Discover the project's own test command from the project itself — its package manifest test script, a Makefile test target, CI configuration. Do NOT add new ratchet configuration and do NOT assume a toolchain. Run the discovered command fresh on the committed tree.
   - If the fresh run FAILS: STOP and report the exact command and its failing result. Never push a red tree, and never open the pull request on a red or unrun test result.
   - If no test command can be discovered, or the run cannot complete: STOP and report the reason. The pull request is opened only on a fresh green run of the project's own test command.
4. **Push the work branch to its remote**
   NEVER force-push under any circumstances — no \`git push --force\`, no \`--force-with-lease\`. If the remote rejects the push, STOP and report the rejection, naming what the remote said — do NOT retry the push and do NOT force it.
- The exact test command you discovered and ran, and its fresh green result.`;
      expect(findOpenPrHonestyViolations(body)).not.toEqual([]);
    });

    it('rejects a body without the force-push ban', () => {
      const body = `2. **Commit the accumulated uncommitted work**
3. **Run the project's own test command fresh on the committed tree**
   Discover the project's own test command from the project itself — its package manifest test script, a Makefile test target, CI configuration. Do NOT add new ratchet configuration and do NOT assume a toolchain. Run the discovered command fresh on the committed tree — the exact commit you are about to push — before any push.
   - If the fresh run FAILS: STOP and report the exact command and its failing result. Never push a red tree, and never open the pull request on a red or unrun test result.
   - If no test command can be discovered, or the run cannot complete: STOP and report the reason. The pull request is opened only on a fresh green run of the project's own test command.
4. **Push the work branch to its remote**
   If the remote rejects the push, STOP and report the rejection, naming what the remote said — do NOT retry the push and do NOT force it.
- The exact test command you discovered and ran, and its fresh green result.`;
      expect(findOpenPrHonestyViolations(body)).not.toEqual([]);
    });

    it('rejects a body whose test step runs after the push step', () => {
      const body = `2. **Commit the accumulated uncommitted work**
3. **Push the work branch to its remote**
   NEVER force-push under any circumstances — no \`git push --force\`, no \`--force-with-lease\`. If the remote rejects the push, STOP and report the rejection, naming what the remote said — do NOT retry the push and do NOT force it.
4. **Run the project's own test command fresh on the committed tree**
   Discover the project's own test command from the project itself — its package manifest test script, a Makefile test target, CI configuration. Do NOT add new ratchet configuration and do NOT assume a toolchain. Run the discovered command fresh on the committed tree — the exact commit you are about to push — before any push.
   - If the fresh run FAILS: STOP and report the exact command and its failing result. Never push a red tree, and never open the pull request on a red or unrun test result.
   - If no test command can be discovered, or the run cannot complete: STOP and report the reason. The pull request is opened only on a fresh green run of the project's own test command.
- The exact test command you discovered and ran, and its fresh green result.`;
      expect(findOpenPrHonestyViolations(body)).not.toEqual([]);
    });

    it('rejects a body whose output summary omits the fresh test evidence', () => {
      const body = `2. **Commit the accumulated uncommitted work**
3. **Run the project's own test command fresh on the committed tree**
   Discover the project's own test command from the project itself — its package manifest test script, a Makefile test target, CI configuration. Do NOT add new ratchet configuration and do NOT assume a toolchain. Run the discovered command fresh on the committed tree — the exact commit you are about to push — before any push.
   - If the fresh run FAILS: STOP and report the exact command and its failing result. Never push a red tree, and never open the pull request on a red or unrun test result.
   - If no test command can be discovered, or the run cannot complete: STOP and report the reason. The pull request is opened only on a fresh green run of the project's own test command.
4. **Push the work branch to its remote**
   NEVER force-push under any circumstances — no \`git push --force\`, no \`--force-with-lease\`. If the remote rejects the push, STOP and report the rejection, naming what the remote said — do NOT retry the push and do NOT force it.
- The commit you authored on the work branch.`;
      expect(findOpenPrHonestyViolations(body)).not.toEqual([]);
    });
  });

  describe('the shared OPEN_PR_BODY single author', () => {
    // The subject of these assertions is the shipped template module itself,
    // so this block intentionally reads the real repository file rather than
    // a tmpdir fixture.
    const sourcePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../src/core/templates/workflows/open-pr.ts',
    );
    const source = readFileSync(sourcePath, 'utf-8');

    it('names one shared OPEN_PR_BODY constant consumed by both getters', () => {
      expect(source).toMatch(/const OPEN_PR_BODY = `/);
      expect(source).toMatch(/instructions:\s*OPEN_PR_BODY/);
      expect(source).toMatch(/content:\s*OPEN_PR_BODY/);
    });

    it('renders byte-identical bodies from the skill getter and the command getter', () => {
      expect(getOpenPrSkillTemplate().instructions).toBe(
        getRctOpenPrCommandTemplate().content,
      );
    });

    it('renders the tested-push guardrails from both getters', () => {
      expect(findOpenPrHonestyViolations(getOpenPrSkillTemplate().instructions)).toEqual([]);
      expect(findOpenPrHonestyViolations(getRctOpenPrCommandTemplate().content)).toEqual([]);
    });
  });

  describe('render loop over the supported-tools registry', () => {
    it('renders the open-pr skill template for every registered agent with the tested-push guardrails', () => {
      const agents = AI_TOOLS.filter((t) => t.skillsDir);
      const skillTemplates = getSkillTemplates(['open-pr']);
      // The checked set must be non-empty and cover every registered agent: a
      // registry entry silently skipped by this loop fails here.
      expect(agents.length).toBeGreaterThan(0);
      expect(agents.length).toBe(AI_TOOLS.length);
      expect(skillTemplates.length).toBeGreaterThan(0);

      for (const tool of agents) {
        for (const { template, dirName } of skillTemplates) {
          const content = generateSkillContent(template, '0.0.0-test');
          expect(
            findOpenPrHonestyViolations(content),
            `open-pr skill ${dirName} rendered for agent ${tool.value}`,
          ).toEqual([]);
        }
      }
    });

    it('renders the open-pr command template through every registered adapter with the tested-push guardrails', () => {
      const adapters = CommandAdapterRegistry.getAll();
      const commandContents = getCommandContents(['open-pr']);
      // Non-empty checked set covering every registered agent, as above.
      expect(adapters.length).toBeGreaterThan(0);
      expect(adapters.length).toBe(AI_TOOLS.length);
      expect(commandContents.length).toBeGreaterThan(0);

      for (const adapter of adapters) {
        for (const content of commandContents) {
          const { fileContent } = generateCommand(content, adapter);
          expect(
            findOpenPrHonestyViolations(fileContent),
            `open-pr command ${content.id} rendered for agent ${adapter.toolId}`,
          ).toEqual([]);
        }
      }
    });
  });
});
