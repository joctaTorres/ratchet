/**
 * Apply-batch orchestrator skill + command templates.
 *
 * `/rct:apply-batch` is a continuous, autonomous batch orchestrator. It loops
 * `ratchet batch apply <name>` until the batch is done, surfacing halts
 * (blocked / awaiting-approval) and proof-of-work failures to the user and
 * recording their answers/approvals via `ratchet batch report`. It is the
 * interface between the ratchet CLI and the user.
 *
 * Architecture invariant: `ratchet batch apply` stays SINGLE-STEP — the bundled
 * engine advances exactly one transition per invocation. The LOOP lives here, in
 * the skill, NOT in the CLI/engine. Do not "fix" the engine to loop.
 *
 * The orchestrating session does NO coding itself: it only runs `ratchet` CLI
 * commands and talks to the user. The actual coding happens inside
 * `ratchet batch apply`, which spawns the coding agent via the engine.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';

const APPLY_BATCH_BODY = `Drive a Ratchet batch to completion as an autonomous orchestrator.

**Input**: Optionally specify a batch name (e.g., \`/rct:apply-batch q3-auth\`). If omitted, infer from context or, if a single batch exists, use it. If ambiguous, run \`ratchet batch list --json\` and ask which batch to drive.

**Your role: orchestrator, not coder.** You are the interface between the ratchet CLI and the user. You drive the batch by running \`ratchet\` CLI commands and relaying state to the user. You do **no coding work yourself**:

- You **never** write or edit source code.
- You **never** hand-edit \`.ratchet\` artifacts (manifests, changes, state).
- Your only actions are \`ratchet\` CLI commands (status, apply, report, list, view, config) and messages to the user.
- The actual coding happens **inside** \`ratchet batch apply\`, which spawns the coding agent via the bundled engine. You drive that loop; you do not do its work.

**The loop lives here, not in the CLI.** \`ratchet batch apply\` is **single-step**: each invocation advances exactly ONE transition (propose -> apply -> verify for one DAG step) via the bundled engine, then returns. That is by design and is unchanged — do not try to make the CLI or engine loop. The continuous loop is **your** job, in this skill: you call \`ratchet batch apply\` repeatedly until the batch is done.

**Steps**

1. **Select the batch**
   - If a name is given, use it. Otherwise infer from context or auto-select the sole batch.
   - If more than one batch exists and none is named, run \`ratchet batch list --json\` and ask the user which batch to drive.
   - Announce: "Driving batch: <name>" and how to override (\`/rct:apply-batch <other>\`).

2. **First-run note (permissions posture)**
   The **first** \`ratchet batch apply\` in a project may trigger the agent-permissions **first-run posture prompt** (interactive — it asks how much autonomy to grant the coding agent). Let that prompt complete; surface it to the user if it needs their input, then continue the loop. After the first run it will not prompt again.

3. **Loop until the batch is done**
   Repeat the following until \`ratchet batch status "<name>" --json\` reports the batch is complete. Do **not** ask the user for permission between steps — you are autonomous between halts.

   a. **Read status** (translate, don't dump):
      \`\`\`bash
      ratchet batch status "<name>" --json
      \`\`\`
      Parse the phases, change statuses, \`after\` edges, the \`next\` step, and any parked state. Translate this machine-readable state into a brief human-readable update — you are the interface between the CLI's JSON APIs and the user.

   b. **Advance one transition**:
      \`\`\`bash
      ratchet batch apply "<name>"
      \`\`\`
      This picks the next ready, ungated step from the DAG and runs the bundled engine in-process for exactly one transition. The engine ships inside ratchet — there is no separate install or activation.

   c. **Interpret the outcome**:
      - **Advanced** -> translate the result into a brief progress update for the user (what step ran, what is next), then continue the loop. Do not stop, do not ask permission.
      - **Blocked / awaiting-input (halt)** -> **STOP looping.** Surface to the user exactly what input or decision is required. Do **not** cross the halt without recorded input. When the user answers, record it and resume:
        \`\`\`bash
        ratchet batch report "<name>" --change "<change>" --answer "<the user's answer>"
        \`\`\`
        Then resume the loop by invoking \`ratchet batch apply "<name>"\` again.
      - **Awaiting-approval (gate halt)** -> **STOP looping.** Present the gate result to the user for approval. Resume **only after** the user approves; record the approval via the report channel, then continue.
      - **Failed / proof-of-work hard-gate failure** -> **STOP.** Surface the failure clearly to the user. Do **not** paper over it or retry blindly. The engine gates; you surface the gate result.

4. **Stop conditions**
   - **Batch complete** -> summarize the finished batch for the user (phases, changes, what landed) and celebrate. Then point the user at the **terminal step**: archive the batch to close its lifecycle and clear it from the active list, by running \`ratchet batch archive "<name>"\` (or the \`/rct:archive-batch <name>\` workflow). That cascades the change-archive flow over every member change and moves the batch under the archive.
   - **Halt needing the user** -> surfaced as above; resume after recorded input/approval.
   - **Hard failure** -> surfaced clearly; stop and hand control back to the user.

**Guardrails**
- The loop is yours (the skill's); \`ratchet batch apply\` stays single-step — never make the CLI/engine loop.
- You never write/edit code and never hand-edit \`.ratchet\` artifacts — only \`ratchet\` CLI commands and user communication.
- Autonomous between halts; always surface halts (blocked / awaiting-approval) and hard failures to the user.
- Never cross a halt without recorded input/approval.
- The engine is bundled, so \`apply\` runs in-process with no separate install or activation.`;

export function getApplyBatchSkillTemplate(): SkillTemplate {
  return {
    name: 'ratchet-apply-batch',
    description:
      'Drive a Ratchet batch to completion as an autonomous orchestrator. Use when the user wants the batch applied end-to-end: it loops `ratchet batch apply` (single-step engine) until the batch is done, surfaces halts/approvals and proof-of-work failures to the user, records answers, and resumes — acting as the interface between the ratchet CLI and the user, doing no coding itself.',
    instructions: APPLY_BATCH_BODY,
    license: 'MIT',
    compatibility: 'Requires the ratchet CLI; the batch engine is bundled in-process.',
    metadata: { author: 'ratchet', version: '1.0' },
  };
}

export function getRctApplyBatchCommandTemplate(): CommandTemplate {
  return {
    name: 'RCT: Apply Batch',
    description: 'Drive a Ratchet batch to completion as an autonomous orchestrator (Experimental)',
    category: 'Workflow',
    tags: ['workflow', 'apply-batch', 'experimental'],
    content: APPLY_BATCH_BODY,
  };
}
