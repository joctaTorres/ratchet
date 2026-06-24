/**
 * Propose-batch guided workflow skill + command templates.
 *
 * `/rct:propose-batch` guides authoring a batch manifest: it explores the
 * objective, slices it into ordered vertical-slice phases, requires a success
 * criterion and an executable proof-of-work per phase, scaffolds the manifest
 * via `ratchet new batch <name>` with a shallow DAG (only phase one decomposed
 * into change intents), and then asks whether to chain into propose-change on
 * phase one now. Its only artifact is the manifest at
 * `.ratchet/batches/<name>/batch.yaml` — never change directories.
 *
 * Like `batch.ts`, both the skill and the command share a single body constant.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';

const PROPOSE_BATCH_BODY = `Propose a batch — a phased, anti-waterfall unit of work — by guiding the
author to a batch manifest at \`.ratchet/batches/<name>/batch.yaml\`.

The output of this flow is a **manifest of intent**, never change directories.
There is no new ratchet schema: you write what the existing batch manifest
parser already accepts. Changes are decomposed lazily later by
\`ratchet batch apply\`.

---

**Why this shape (the four waterfall traps → this skill's behavior)**

This flow deliberately avoids a frozen up-front change list. Each trap maps to a
hard rule below:

- **Inflexibility to change** → commit to phase **contracts** (goal + success +
  proof-of-work), not a frozen change list. Only phase one is decomposed into
  concrete change intents; later phases stay goal+proof so they can be reshaped
  with real outcomes in hand. The manifest is editable intent the user can
  revise before applying.
- **Late error detection** → every phase carries an executable proof-of-work
  that runs at its boundary. Refuse to scaffold any phase that lacks one.
- **No early customer feedback** → every phase must be a **vertical slice** that
  ships runnable software a user can exercise end to end. Reject horizontal /
  infra-only phases and counter-propose a thin end-to-end slice.
- **Planning fallacy** → do not demand complete up-front knowledge. Plan
  **shallow-but-wide**: all phases captured now as goal+proof; change-level
  detail deferred. Phase N is decomposed at apply time with phase N-1's real
  results.

---

**Input**: The user's request should include a batch objective (what they want
to ship) and optionally a batch name (kebab-case). If a name is not given,
derive one from the objective.

**Steps**

1. **Explore the objective first**

   If the request does not clearly describe the batch objective, ask the user to
   clarify before doing anything else — use a structured-question tool such as
   AskUserQuestion (open-ended, no preset options) if your agent has one,
   otherwise ask in plain prose:
   > "What is the overall objective of this batch? What working software should
   > exist when it's done, and who exercises it?"

   Ask follow-ups until you understand the objective well enough to slice it.
   **Do NOT scaffold a manifest until the objective is understood.**

2. **Slice into ordered vertical-slice phases**

   Propose an **ordered** list of phases. Each phase must be **functional,
   runnable software a user can exercise end to end** — not a horizontal layer.
   Order the phases so each later phase builds on the prior phase's shipped
   slice.

   **Reject horizontal / infra-only phases.** If the user proposes something
   like "set up the database" or "build all the models" — a phase that ships
   nothing a user can run — reject it, explain that it produces nothing runnable,
   and counter-propose a **thin end-to-end slice** that exercises only the models
   or infrastructure needed to ship **one** runnable behavior. Accept a phase
   only when it ships a feature a user can exercise end to end.

3. **Require success criteria + a proof-of-work per phase (hard gate)**

   For **every** phase you must have, before scaffolding:
   - a **success criterion** (what "done" means for the phase), and
   - a **proof-of-work** whose \`kind\` is one of \`integration\`, \`blackbox\`,
     or \`llm-judge\`.

   **Refuse to scaffold** a phase missing either. If success criteria are
   missing, grill the user for them. If a proof-of-work is missing, require the
   user to declare its kind from the three allowed values.

   - **Phase one** is being built first, so its proof-of-work must be
     **concrete**: a runnable command (\`run\`) and a concrete pass condition
     (\`pass\`). Do not let phase one's proof remain merely described.
   - **Later phases** describe software that does not exist yet, so they may
     carry a **described** proof-of-work: its kind and intent now, with the note
     that the exact runnable command is **refined at phase entry**. Do not demand
     an exact command for software that does not yet exist.

4. **Scaffold the manifest via existing machinery (shallow DAG)**

   Once you have valid phases with proofs-of-work and a batch name:
   \`\`\`bash
   ratchet new batch <name>
   \`\`\`
   This stamps the manifest template at \`.ratchet/batches/<name>/batch.yaml\`.
   Then edit that manifest to write the phases and DAG. Use the manifest shape
   the existing parser accepts — introduce **no** new schema:

   - Each phase: \`name\`, \`goal\`, \`success\`, and \`proofOfWork: { kind, run, pass }\`.
   - **Shallow DAG**: phase one's \`changes\` carries concrete change intents,
     each \`{ name, after: [<names>] }\`, where \`after\` edges form a DAG. **Later
     phases' \`changes\` are left empty** — a change intent with no change
     directory is a valid \`pending\`, which is what lets changes be created
     lazily. Do not decompose later phases up front.
   - **Per-change success (optional)**: each phase-one change intent MAY also
     carry a short, clear \`success\` criterion stating what "done" means for that
     change specifically (distinct from the phase \`success\`). Keep it to one
     line. It is **optional** — omit it and existing manifests stay valid; the
     schema only requires it to be non-empty when present.
   - **Settings**: if the user wants a setting that differs from the project
     defaults, record it under the manifest \`settings\` block. Only these keys are
     accepted (the schema is strict — any other key fails validation): \`gate\`,
     \`strategy\`, \`proofOfWork\`, \`agent\`. **Omit the \`settings\` block entirely**
     when the project defaults are acceptable.

   The **only** artifact written for the batch is this manifest file. Do **NOT**
   generate any change directories under \`.ratchet/changes/\`, and do not produce
   any per-change planning artifacts at proposal time.

5. **Ask whether to propose phase-one changes now (gated chain-in)**

   After the manifest is written, present an **explicit gate** — never an
   automatic action — asking whether to run the propose-change flow on phase
   one's first change or changes now. Use a structured-question tool such as
   AskUserQuestion if your agent has one, otherwise ask in plain prose:
   > "The batch manifest is written. Want me to propose phase one's first
   > change(s) now (run /rct:propose on them), or defer that to \`ratchet batch
   > apply\`?"

   - **If the user accepts**: chain into the propose-change flow (\`/rct:propose\`)
     for phase one's first change or changes, so those changes are spec'd and
     ready before this skill ends.
   - **If the user declines**: stop **without creating any change directories**,
     and explain that changes are created lazily during \`ratchet batch apply\`.

**Output**

After scaffolding, summarize:
- Batch name and manifest location (\`.ratchet/batches/<name>/batch.yaml\`).
- The ordered phases, each with its goal, success criterion, and proof-of-work
  kind (noting phase one's concrete command vs. later phases' refine-at-entry
  proofs).
- Which phase-one change intents were written and their \`after\` edges.
- Whether phase-one changes were proposed now or deferred to \`ratchet batch
  apply\`.

**Guardrails**
- The objective must be understood before scaffolding.
- Every phase is a vertical slice; reject horizontal / infra-only phases.
- Every phase has a success criterion and a proof-of-work, or it is not
  scaffolded. Phase one's proof is concrete; later phases' may be described.
- Only phase one is decomposed into change intents; later phases stay goal+proof.
- The only artifact is the manifest — never change directories at proposal time.
- The chain-in is always gated: ask, never auto-create changes.
- \`propose-batch\` is only useful alongside the \`batch\` workflow; pair them.`;

export function getProposeBatchSkillTemplate(): SkillTemplate {
  return {
    name: 'ratchet-propose-batch',
    description:
      'Propose a batch: a guided, anti-waterfall flow that slices an objective into ordered vertical-slice phases with per-phase proofs-of-work and writes a batch manifest (not change directories). Use when the user wants to plan a phased multi-change effort.',
    instructions: PROPOSE_BATCH_BODY,
    license: 'MIT',
    compatibility: 'Requires the ratchet CLI; pairs with the batch workflow.',
    metadata: { author: 'ratchet', version: '1.0' },
  };
}

export function getRctProposeBatchCommandTemplate(): CommandTemplate {
  return {
    name: 'RCT: Propose Batch',
    description: 'Propose a batch — slice an objective into vertical-slice phases and write a manifest (Experimental)',
    category: 'Workflow',
    tags: ['workflow', 'batch', 'experimental'],
    content: PROPOSE_BATCH_BODY,
  };
}
