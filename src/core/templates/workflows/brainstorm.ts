/**
 * Brainstorm guided workflow skill + command templates.
 *
 * `/rct:brainstorm` is the collaborative front door to ratchet. It turns a rough
 * idea into a validated design through dialogue — explore project context, ask
 * clarifying questions one at a time, propose 2-3 approaches, then present the
 * design section-by-section with per-section approval. Its terminal step is to
 * RECOMMEND and (on an explicit gate) chain into `/rct:propose` (a single,
 * cohesive change) or `/rct:propose-batch` (a big effort that should be split
 * into phases). It does no implementation itself and invokes no skill other than
 * propose / propose-batch.
 *
 * Adapted from the superpowers `brainstorming` skill, with these source
 * behaviors REMOVED: the writing-plans / implementation-skill terminal, the
 * decompose-into-sub-projects step, and the post-approval design-doc write,
 * spec self-review, and written-spec review gate. The browser companion server
 * is reframed as an agent-neutral, capability-gated, server-less visual aid.
 *
 * Like `propose-batch.ts` / `apply-batch.ts`, both the skill and the command
 * share a single body constant.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';

const BRAINSTORM_BODY = `Brainstorm a rough idea into a validated design, then route it to the right
ratchet proposer. This is a collaborative front door: turn the user's idea into
a fully formed design through natural dialogue, and end by recommending and
(on approval) chaining into \`/rct:propose\` or \`/rct:propose-batch\`.

You do **no implementation** here — no code, no scaffolding, no artifacts. The
terminal step is design approval followed by routing. The only skills you may
invoke are \`/rct:propose\` and \`/rct:propose-batch\`.

Refer to "the coding agent" / "your agent" throughout — this flow works the same
in any agent. Any tool-specific step is optional with a plain-prose fallback.

---

**Steps** — do these in order:

1. **Explore the project context first**

   Before asking any clarifying question or proposing any approach, ground
   yourself in the actual project: check relevant files, docs, and recent
   commits to understand the current structure and patterns. Do this **first**,
   every time. If the idea modifies an existing codebase, explore the current
   structure and patterns before forming any design, and fold in only targeted
   improvements that serve the goal — do **not** propose unrelated refactoring.

2. **Ask clarifying questions — one at a time**

   Refine the idea with the user by asking clarifying questions **one at a
   time** — at most **one question per message**. Do not overwhelm the user with
   multiple questions at once; if a topic needs more exploration, break it into
   several single questions. Focus on **purpose, constraints, and success
   criteria**.

   **Prefer multiple-choice** when the options are enumerable (it is easier to
   answer); fall back to an **open-ended** question when multiple choice does not
   fit.

   Use a structured-question tool such as AskUserQuestion **if your agent has
   one**, otherwise ask in **plain prose**. The flow proceeds identically either
   way.

3. **Offer an optional visual aid — just-in-time, never upfront**

   Do **NOT** offer any visual companion upfront. Ratchet bundles **no** browser
   companion server, and this flow never depends on any such server or file —
   plain-prose / text-only always works.

   The **first** time a question would genuinely be clearer **shown than told**
   (a real mockup, layout, diagram, or side-by-side comparison — not merely a UI
   *topic*), **and** your agent or environment can actually show visuals, offer
   the optional visual aid just-in-time. The offer **MUST be its own message**
   containing **only** the offer — no clarifying question or other content — and
   you **wait for the user's response** before continuing. If no genuinely visual
   question ever arises, never offer it.

   If your agent or environment **cannot** show visuals, continue **text-only**
   in plain prose without offering anything.

   Once the user has accepted, decide **per question** whether a visual or text
   form is clearer: use a visual for genuinely visual questions (wireframe,
   layout, diagram choice); use **text** for conceptual, tradeoff, or scope
   questions. A question *about* a UI topic is not automatically a visual
   question.

4. **Propose 2-3 approaches with a leading recommendation**

   Once you understand the purpose and constraints, explore how to build the
   idea by proposing **two to three** different approaches with their
   trade-offs. **Lead with your recommended approach and explain the reasoning.**
   Even when you have an obvious first idea, still present alternatives rather
   than a single option. Apply **YAGNI** — remove unnecessary features from each
   approach.

5. **Present the design section by section, with approval gates**

   Once an approach is chosen, present the design **section by section**. Scale
   each section to its complexity (a few sentences if straightforward, more if
   nuanced). **Ask for approval after each section before moving on.** If the
   user does not approve a section, **go back and revise it**, and stay flexible
   to clarify when something does not make sense.

   **Design for isolation and clarity:** favor small, well-bounded units with
   clear interfaces, each of which can be understood and tested independently.

6. **Recommend a route, then route there (the terminal step)**

   Once the user has approved the design, your terminal step is to **recommend a
   route and route there** — you do no implementation yourself. Decide which
   ratchet door fits:

   - **A single, cohesive change** → recommend **\`/rct:propose\`**, and explain
     why a single change is the right fit.
   - **A big effort that should be split into multiple changes** → recommend
     **\`/rct:propose-batch\`**, and explain why the effort should be split into
     phases. \`/rct:propose-batch\` does the phase slicing — do **not** decompose
     the request yourself into separate sub-projects each with its own spec,
     plan, and implementation cycle.

   Routing is an **explicit gate, never automatic.** Present the recommendation
   and **ask before chaining in**. Never chain in automatically. **On approval,
   chain into the chosen command** (\`/rct:propose\` or \`/rct:propose-batch\`) in
   this session.

**Guardrails**
- Explore the project context **before** asking questions or proposing
  approaches.
- One clarifying question per message; prefer multiple choice, fall back to
  open-ended; structured-question tooling is optional with a plain-prose
  fallback.
- The visual aid is offered just-in-time and never upfront, is capability-gated,
  and never depends on any companion server or file — text-only always works.
- Always present 2-3 approaches with a leading recommendation; YAGNI ruthlessly.
- Present the design section by section and get approval after each section;
  revise when a section is not approved.
- The terminal step is recommend-and-route: a single change → \`/rct:propose\`, a
  big split effort → \`/rct:propose-batch\`. The route is always a gate, never
  automatic.
- You invoke **no skill other than** \`/rct:propose\` or \`/rct:propose-batch\`.
  You do **not** hand off to a writing-plans skill or any implementation skill,
  you write **no** design doc, you run **no** spec self-review, and you gate
  **no** separate written-spec review.`;

export function getBrainstormSkillTemplate(): SkillTemplate {
  return {
    name: 'ratchet-brainstorm',
    description:
      'Brainstorm a rough idea into a validated design through collaborative dialogue, then recommend and (on approval) route into the right ratchet proposer. Explores project context, asks clarifying questions one at a time, proposes 2-3 approaches, presents the design section-by-section with per-section approval, then chains into `/rct:propose` (single change) or `/rct:propose-batch` (big effort to split into phases). Does no implementation itself.',
    instructions: BRAINSTORM_BODY,
    license: 'MIT',
    compatibility: 'Requires the ratchet CLI; routes into the propose / propose-batch workflows.',
    metadata: { author: 'ratchet', version: '1.0' },
  };
}

export function getRctBrainstormCommandTemplate(): CommandTemplate {
  return {
    name: 'RCT: Brainstorm',
    description: 'Brainstorm an idea into a validated design, then route it to propose or propose-batch (Experimental)',
    category: 'Workflow',
    tags: ['workflow', 'brainstorm', 'experimental'],
    content: BRAINSTORM_BODY,
  };
}
