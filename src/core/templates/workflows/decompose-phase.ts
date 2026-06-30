/**
 * Decompose-phase guided workflow skill + command templates.
 *
 * `/rct:decompose-phase <phase>` authors ONE named phase's concrete change
 * intents into an EXISTING batch manifest, lazily, at apply time — using the
 * prior phase(s)' real shipped results as the basis. It is the apply-time other
 * half of `propose-batch`'s deliberate "shallow-but-wide" plan: `propose-batch`
 * decomposes only phase one up front and leaves later phases as goal+proof; this
 * workflow fills in a later phase's `changes` once the work it builds on exists.
 *
 * It writes ONLY the phase's `changes` list in `.ratchet/batches/<name>/batch.yaml`
 * — never change directories, never a new manifest. Changes authored here are
 * created lazily by `ratchet batch apply` exactly like phase one's.
 *
 * Like the other batch templates, the skill and the command share one body
 * constant, and the lazy-decomposition guidance is the SAME guidance
 * `propose-batch` owns (one author of decomposition semantics).
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';

const DECOMPOSE_PHASE_BODY = `Decompose ONE phase of an EXISTING batch — author that phase's concrete change
intents into its \`changes\` list in \`.ratchet/batches/<name>/batch.yaml\`, lazily,
from the prior phase(s)' real shipped results.

This is the apply-time other half of \`propose-batch\`'s shallow-but-wide plan:
\`propose-batch\` decomposes only phase one up front and leaves later phases as
goal+proof so they can be reshaped with real outcomes in hand. You are now
filling in ONE such later phase, because the work it builds on has shipped.

The output of this flow is an EDIT to the existing manifest's \`changes\` list for
the named phase — never change directories, never a new manifest. The change
intents you author are created lazily later by \`ratchet batch apply\`, exactly
like phase one's were.

---

**Input**: The phase to decompose (the argument to this invocation) within the
batch identified by the surrounding instructions. The surrounding instructions
also inject the phase's \`goal\`, \`success\`, and proof-of-work, plus the prior
phase(s)' shipped change intents and their definitions of done — that injected
context is the basis for decomposition; do not invent requirements beyond it.

**Steps**

1. **Ground in the prior phase's shipped results**

   Read the injected prior-phase results: which change intents shipped and what
   each one's \`done\` criterion was. The new phase builds on that shipped slice —
   decompose toward this phase's \`goal\` using what now actually exists, not a
   guess made before the prior phase ran.

2. **Slice the phase into concrete change intents**

   Author one or more concrete change intents that, taken together, achieve this
   phase's \`goal\` and satisfy its \`success\` criterion. Each intent is a
   thin, self-contained unit of work. Order them with \`after\` edges that form a
   DAG within the phase (a change lists the names it depends on).

3. **Write the intents into the manifest's \`changes\` list (edit in place)**

   Edit \`.ratchet/batches/<name>/batch.yaml\` and replace the named phase's empty
   \`changes: []\` with the authored intents. Use the manifest shape the existing
   parser already accepts — introduce **no** new schema:

   - Each change intent: \`{ name, after: [<names>], done }\`.
   - **Per-change done (required)**: every intent MUST carry a short, clear
     \`done\` criterion stating what "done" means for that change specifically
     (distinct from the phase \`success\`). Keep it to one line. It is **required**
     and must be non-empty — a change intent without a \`done\` fails validation.
   - Do **not** touch any other phase, the \`settings\` block, or the phase's
     \`goal\`/\`success\`/\`proofOfWork\`. Edit only this phase's \`changes\` list.

   Write **only** the manifest edit. Do **NOT** create any change directories
   under \`.ratchet/changes/\`, and do not produce any per-change planning
   artifacts — those are created lazily by \`ratchet batch apply\`.

**Output**

After editing, summarize:
- The phase you decomposed and the batch it belongs to.
- The change intents you authored, each with its \`after\` edges and its \`done\`.
- A reminder that the changes are not yet created on disk — \`ratchet batch apply\`
  creates them lazily.

**Guardrails**
- Decompose ONLY the named phase; never another phase, never a new manifest.
- Author the intents from the prior phase's real shipped results, not a fresh
  guess.
- Every authored change intent has a non-empty \`done\`, or the manifest fails
  validation.
- The only artifact is the manifest edit — never change directories.`;

export function getDecomposePhaseSkillTemplate(): SkillTemplate {
  return {
    name: 'ratchet-decompose-phase',
    description:
      "Decompose one phase of an existing batch: author that phase's concrete change intents into the manifest's changes list from the prior phase's shipped results (not change directories). Used at apply time to lazily fill in a later phase.",
    instructions: DECOMPOSE_PHASE_BODY,
    license: 'MIT',
    compatibility: 'Requires the ratchet CLI; pairs with the batch workflow.',
    metadata: { author: 'ratchet', version: '1.0' },
  };
}

export function getRctDecomposePhaseCommandTemplate(): CommandTemplate {
  return {
    name: 'RCT: Decompose Phase',
    description:
      "Decompose one phase of an existing batch — author its change intents into the manifest from the prior phase's shipped results (Experimental)",
    category: 'Workflow',
    tags: ['workflow', 'batch', 'experimental'],
    content: DECOMPOSE_PHASE_BODY,
  };
}
