/**
 * Batch single-step apply skill + command templates.
 *
 * `/rct:batch` drives the same single-step apply as `ratchet batch apply`: pick
 * the next ready DAG step, advance exactly one transition via the engine, render
 * the result, and stop. No internal loop.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';

const BATCH_BODY = `Advance a Ratchet batch by exactly one step.

**Input**: Optionally specify a batch name (e.g., \`/rct:batch q3-auth\`). If omitted, infer from context or, if a single batch exists, use it. If ambiguous, run \`ratchet batch list --json\` and ask which batch.

**This is a single-step action.** It advances one transition for one change and then stops — keeping natural inspection points and fresh agent context between steps. It does NOT loop.

**Steps**

1. **Select the batch**
   - If a name is given, use it. Otherwise infer or auto-select the sole batch.
   - Announce: "Using batch: <name>" and how to override (\`/rct:batch <other>\`).

2. **Inspect status (no engine needed)**
   \`\`\`bash
   ratchet batch status "<name>" --json
   \`\`\`
   Parse the phases, change statuses, after edges, and the \`next\` step. If a step is parked (blocked or awaiting-approval), surface what input is required before doing anything else.

3. **Advance one step**
   \`\`\`bash
   ratchet batch apply "<name>"
   \`\`\`
   This picks the next ready, ungated step from the DAG and runs the bundled engine in-process for exactly one transition (propose -> apply -> verify). The engine ships inside ratchet — there is no separate install or activation.

   **Handle states:**
   - **Advanced**: report the transition that ran and the next actionable step.
   - **Blocked / awaiting-approval**: report what input is required; do not cross the halt.

4. **Report from inside a step (when you are the step's agent)**
   Use the report channel rather than any interactive prompt:
   \`\`\`bash
   ratchet batch report "<name>" --change "<change>" --status "drafted 2 of 4"
   ratchet batch report "<name>" --change "<change>" --blocker "cookie or header sessions?"
   \`\`\`

5. **Render the result**
   Show the step that ran, its outcome, and the next step. Stop — do not continue to the next step automatically.

**Guardrails**
- One step per invocation; never loop.
- Never cross a halt (blocked / awaiting-approval) without recorded input.
- The engine is bundled, so \`apply\` runs in-process with no separate install or activation.`;

export function getBatchSkillTemplate(): SkillTemplate {
  return {
    name: 'ratchet-batch',
    description:
      'Advance a Ratchet batch by one step. Use when the user wants to drive a batch forward one transition (propose/apply/verify) via the bundled engine, keeping inspection points between steps.',
    instructions: BATCH_BODY,
    license: 'MIT',
    compatibility: 'Requires the ratchet CLI; the batch engine is bundled in-process.',
    metadata: { author: 'ratchet', version: '1.0' },
  };
}

export function getRctBatchCommandTemplate(): CommandTemplate {
  return {
    name: 'RCT: Batch',
    description: 'Advance a Ratchet batch by one step (Experimental)',
    category: 'Workflow',
    tags: ['workflow', 'batch', 'experimental'],
    content: BATCH_BODY,
  };
}
