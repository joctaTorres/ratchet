/**
 * Eval skill + command templates.
 *
 * `/rct:eval` runs the engine-backed eval, presents the report, and guides
 * authoring bindings for unjudged cases. Judging belongs to the engine
 * (`ratchet eval run`), NOT to the driving agent reading the live repository.
 * The body is authored once as tool-agnostic shared content and rendered per
 * agent by the skill-generation wiring.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';

const EVAL_BODY = `Run the engine-backed eval suite, surface regressions, and close coverage gaps — without judging by reading the live repository yourself.

**Input**: Optionally pass a scope (\`--changes\`, \`--change <name>\`, or \`--path <dir-or-file>\`). If omitted, the default scope is the permanent feature store.

**The verdict comes from the engine, not from you.** Eval cases are judged against a pre-determined fixture codebase by the bundled batch engine (a \`deterministic\` check or an \`llm-judge\` spawned judge). You orchestrate \`ratchet eval run\` and present the result; you do NOT form verdicts by reading the working tree.

**Steps**

1. **Enumerate the set**
   \`\`\`bash
   ratchet eval set --json
   \`\`\`
   Each case is one Scenario, with a binding status of \`deterministic\`, \`llm-judge\`, or \`unbound\`. Note which cases are \`unbound\` — those are coverage gaps.

2. **Run the eval through the engine**
   \`\`\`bash
   ratchet eval run --json
   \`\`\`
   This snapshots the in-scope set, judges every BOUND case through the engine against its fixture, and persists a run. Use \`--judge deterministic\` for deterministic checks only, or \`--judge llm-judge\` to force the spawned-agent judge. Capture the reported run id.

3. **Present the report**
   \`\`\`bash
   ratchet eval report --run "<run-id>" --json
   \`\`\`
   Show the scorecard (pass / fail / unjudged) and the baseline diff.

   **Surface regressions first.** A regression is a case that PASSED in the baseline and FAILS now. If the report flags any, report them and their failing-case evidence as the HEADLINE before anything else. Then list other failing cases, then new and retired cases (new/retired are not regressions). A run with any \`unjudged\` case is incomplete.

4. **Help author bindings for unjudged cases**
   For each \`unbound\` / \`unjudged\` case, guide authoring an eval-spec binding under \`.ratchet/evals/specs/\` that names a fixture under \`.ratchet/evals/fixtures/<name>/\` and a judging check:
   - **Prefer a \`deterministic\` binding**: a bash command run against the fixture working copy with a pass condition (\`exit-zero\`, \`contains:<text>\`, or \`regex:<pattern>\`). Deterministic checks are reproducible and need no agent.
   - **Fall back to an \`llm-judge\` binding** only when no deterministic check fits: provide the \`success\` criteria the spawned judge must satisfy, and optionally a \`jury: { votes, quorum }\` block (default 1 vote, majority quorum) to cast repeat votes under majority or unanimous agreement. The llm-judge fails closed on missing evidence, and a sub-quorum vote records \`unjudged\` rather than a false failure.
   - If a fixture needs bootstrapping, declare a one-time \`setup\` command; it runs once into a cached working copy reused across cases.

   Use a structured-question tool such as AskUserQuestion if your agent has one when you need the user to choose a fixture or check; otherwise ask in plain prose.

5. **Promote a baseline only when clean**
   \`\`\`bash
   ratchet eval baseline "<run-id>"
   \`\`\`
   **NEVER promote a run to baseline while a regression exists.** Promote only a clean, complete run so a scenario that once passed can never silently regress.

**Guardrails**
- Judging is the engine's job against fixtures — never read the live working tree to decide a verdict.
- Report regressions and their evidence first.
- Do not promote a baseline while any regression exists.`;

export function getEvalSkillTemplate(): SkillTemplate {
  return {
    name: 'ratchet-eval',
    description:
      'Run the engine-backed eval suite, surface regressions against the baseline first, and guide authoring eval-spec bindings for unjudged cases. Use when the user wants to score .feature scenarios as a reproducible regression suite.',
    instructions: EVAL_BODY,
    license: 'MIT',
    compatibility: 'Requires the ratchet CLI; eval cases are judged by the bundled engine against fixtures.',
    metadata: { author: 'ratchet', version: '1.0' },
  };
}

export function getRctEvalCommandTemplate(): CommandTemplate {
  return {
    name: 'RCT: Eval',
    description: 'Run the engine-backed eval and close coverage gaps (Experimental)',
    category: 'Workflow',
    tags: ['workflow', 'eval', 'experimental'],
    content: EVAL_BODY,
  };
}
