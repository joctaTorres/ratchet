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
 *
 * The close-claim and stop-and-surface guardrails are interpolated from
 * `./scope-reconciliation.js`, the single author of those rules across
 * `propose`, `propose-batch`, and `decompose-phase` — never restated here. This
 * workflow is where a deferral either survives a phase boundary or evaporates,
 * so its grounding step also carries the prior-plan sweep and the earned-close
 * verification.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';
import {
  CLOSE_CLAIM_RULES,
  STOP_AND_SURFACE_GUARDRAIL,
} from './scope-reconciliation.js';

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

   a. **Read each prior phase's shipped change \`plan.md\`, not only the injected
      \`done\` criteria.** The injected criteria are a **paraphrase** of what each
      change set out to do. A deferral recorded as plan prose — an
      \`## Out of scope\` section, a "deferred", "revisit in the next phase", or
      "not doing this yet" bullet — never appears in that paraphrase, so grounding
      only in the injected \`done\` makes those deferrals **invisible** at exactly
      the moment they were supposed to be picked up. Open the prior phases'
      shipped change directories and read their \`plan.md\` files directly.

   b. **Extract every deferred item recorded in those plans.** Sweep each plan for
      every \`## Out of scope\` entry and every "deferred", "revisit", "later
      phase", "follow-up", or equivalent item, wherever it appears — including
      inside \`## Why\`, \`## What Changes\`, and \`## Design\` prose, not only under a
      heading that happens to be named "Out of scope". List what you extracted.

   c. **Resolve EACH extracted item as exactly one of three outcomes.** For every
      item on that list, choose and record one:
      - **(a) carried forward** — authored as a change intent in the phase you are
        decomposing;
      - **(b) tracked** — matched to an existing OPEN tracking issue, reported to
        the user with that issue's number; or
      - **(c) explicitly dropped** — surfaced to the user as a drop decision and
        answered by them.

      **Silently ignoring an extracted item is not an available outcome.** Every
      item leaves this step with (a), (b), or (c) written next to it. Report the
      resolved list before you author intents. For a security-, permission-, or
      integrity-relevant item, outcome (c) is a stop-and-surface event under the
      guardrails below, and outcome (b) requires the tracking issue to actually
      exist and to be open — an issue you intend to file is not a tracked item
      until it is filed.

   d. **Verify a prior phase's close-claim was earned before treating an issue as
      shipped.** When a prior phase's \`done\` criterion or plan claims
      \`Fixes #N\` / \`Closes #N\`, do not inherit that claim as fact. Fetch the
      issue (on GitHub, for example, \`gh issue view <n>\`; other trackers have
      their own client; if your agent has none, ask the user to paste the issue
      text), enumerate its material requirements from both its explicit fix items
      and the problems named in its narrative, and compare them against what that
      phase's \`done\` and \`plan.md\` describe as actually implemented.

      A requirement the prior phase did not implement means the close-claim was
      **unearned**. Surface the unearned claim to the user explicitly, and carry
      the remaining scope forward into this phase's change intents — the claim is
      never inherited as fact, and the issue is not treated as shipped.

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
- The deferred items you extracted from the prior phases' plans, each with its
  resolution: carried forward, tracked (with the issue number), or explicitly
  dropped by the user.
- Any prior-phase close-claim you found unearned, and where its remaining scope
  went.
- A reminder that the changes are not yet created on disk — \`ratchet batch apply\`
  creates them lazily.

**Guardrails**
- Decompose ONLY the named phase; never another phase, never a new manifest.
- Author the intents from the prior phase's real shipped results, not a fresh
  guess.
- Every authored change intent has a non-empty \`done\`, or the manifest fails
  validation.
- The only artifact is the manifest edit — never change directories.
- Ground in the prior phases' \`plan.md\` files, not only the injected \`done\`
  criteria; every extracted deferral is carried forward, tracked, or explicitly
  dropped by the user — never silently ignored.
${CLOSE_CLAIM_RULES}
${STOP_AND_SURFACE_GUARDRAIL}`;

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
