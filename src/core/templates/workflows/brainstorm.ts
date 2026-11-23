/**
 * Brainstorm guided workflow skill + command templates.
 *
 * `/rct:brainstorm` is the collaborative front door to ratchet. It triages the
 * request — a complete request routes straight to `/rct:propose` — and turns a
 * rough idea into a validated design through dialogue: look at the project and
 * echo what was found before asking anything, ask why-first open questions and
 * only when the answer changes what gets built, present approaches in their own
 * message, play the design back in a compact summary that labels agent-filled
 * proposals, then present the design section-by-section with per-section
 * approval. Its terminal step is to RECOMMEND and (on an explicit gate) chain
 * into `/rct:propose` (a single, cohesive change) or `/rct:propose-batch` (a
 * big effort that should be split into phases). It does no implementation
 * itself and invokes no skill other than propose / propose-batch.
 *
 * Adapted from the superpowers `brainstorming` skill; the absorbed upstream
 * baseline is superpowers 7.0.2. Behaviors v7 REPLACED from the fork-point
 * adaptation: the one-question-per-message rule, the multiple-choice-first
 * preference, and the forced two-to-three approaches — now why-first open
 * questions, then named options with a recommended pick. Source behaviors
 * still REMOVED: the post-approval design-doc write, the spec self-review and
 * builder-check spec reviewer subagent, the written-spec review gate, the
 * writing-plans / implementation-skill handoff, the decompose-into-sub-projects
 * step, and the bundled browser companion server — the visual aid stays an
 * agent-neutral, capability-gated, server-less reframe.
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

**Skip-ahead opt-out.** At any point — before or during the dialogue — the user
may ask to **skip ahead**: stop the dialogue and route what is known to
\`/rct:propose\`. The user is never locked into finishing every step first.

---

**Steps** — do these in order:

1. **Triage the request first**

   Before anything else, decide whether the request needs a dialogue at all. If
   the request already names the behavior, who does what, and what should
   happen, it is a **complete request**: route it **straight to
   \`/rct:propose\`** and do **not** run the clarifying dialogue on an
   already-complete request.

2. **Look before asking — echo what you found**

   Before asking any question or proposing any approach, ground yourself in the
   actual project: check relevant files, docs, and recent commits to understand
   the current structure and patterns. Do this **first**, every time. Your
   **first message** to the user **echoes** what you found and what you
   understand of the idea.

   If the idea modifies an existing codebase, explore the current structure and
   patterns before forming any design, and fold in only targeted improvements
   that serve the goal — do **not** propose unrelated refactoring.

3. **Ask why-first — open questions, then named options with a pick**

   Refine the idea with the user by opening with **open questions about why** —
   **purpose, constraints, and success criteria** — asked **before presenting
   any set of options**. Once you understand the why, a decision point with
   enumerable options gets those options presented as **named options**, with
   your **recommended pick** named among them and the reasoning behind it.

   **Ask only when the answer changes what gets built.** When the answer would
   not change what gets built, do **not** ask the question — proceed on a
   default instead. Say the default **aloud** so the user can hear it, and
   present it as a **correctable proposal**: the user may override the default.

   Use a structured-question tool such as AskUserQuestion **if your agent has
   one**, otherwise ask in **plain prose**. The flow proceeds identically either
   way.

4. **Offer an optional visual aid — just-in-time, never upfront**

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

5. **Present approaches in their own message — one sensible way is enough**

   Once you understand the purpose and constraints, present how to build the
   idea in a message of its own: the approaches go in **their own message**,
   containing **only** the approaches — no clarifying questions or other
   content.

   When there is genuinely **one sensible way** to build the idea, present that
   single approach with its reasoning — do **not** invent extra approaches just
   to reach a count. When more than one genuinely sensible approach exists,
   present the real alternatives with their trade-offs, **lead with your
   recommended approach and explain the reasoning**, and apply **YAGNI** —
   remove unnecessary features from each approach.

**Spikes — payload-conditional, never config-read.** Run
\`ratchet instructions brainstorm --json\` and read \`spikes.enabled\` from the
payload as data — **never** read \`.ratchet/config.yaml\` directly. Only when
the value is \`true\`, and an approach question is genuinely uncertain, you
**may** offer a spike: name what the spike would prove, and begin **no** spike
work before the user's **explicit approval**. A spike is **throwaway**: build
it **outside the tracked tree** in a scratch location and discard it once it
has answered its question. Keeping anything from a spike routes as a new
\`/rct:propose\` request — spike output is never merged into the project
directly. When the value is \`false\` or the payload is unavailable, **never
mention spikes**.

6. **Play the design back — a compact summary that labels agent-filled parts**

   Once an approach is chosen, play the design back to the user in a **compact
   200-300-word summary**. **Label each part you filled in as a default as
   agent-filled**, so the user knows which parts to check rather than having to
   re-derive the whole design.

7. **Present the design section by section, with approval gates**

   After the playback, present the design **section by section**. Scale each
   section to its complexity (a few sentences if straightforward, more if
   nuanced). **Ask for approval after each section before moving on.** If the
   user does not approve a section, **go back and revise it**, and stay flexible
   to clarify when something does not make sense.

   **Design for isolation and clarity:** favor small, well-bounded units with
   clear interfaces, each of which can be understood and tested independently.

8. **Recommend a route, then route there (the terminal step)**

   Once the user has approved the design, your terminal step is to **recommend a
   route and route there** — you do no implementation yourself. Decide which
   ratchet door fits:

   - **A single, cohesive change** → recommend **\`/rct:propose\`**, and explain
     why a single change is the right fit.
   - **A big effort that should be split into multiple changes** → **step up a
     size** to **\`/rct:propose-batch\`**, and explain why the effort should be
     split into phases. \`/rct:propose-batch\` does the phase slicing — do
     **not** decompose the request yourself into separate sub-projects each with
     its own spec, plan, and implementation cycle.

   Routing is an **explicit gate, never automatic.** Present the recommendation
   and **ask before chaining in**. Never chain in automatically. **On approval,
   chain into the chosen command** (\`/rct:propose\` or \`/rct:propose-batch\`) in
   this session.

   **The handoff carries the dialogue's decisions.** When you chain in, hand off
   the **why** — the purpose and constraints the dialogue established — the
   **approaches considered**, including the pick, and the **non-goals** the user
   ruled out along the way, so they land in the proposer's plan under
   \`## Why\`, \`### Approaches considered\`, and \`## Non-goals\`.

**Guardrails**
- Triage first: a complete request goes straight to \`/rct:propose\` — no
  clarifying dialogue on an already-complete request.
- Look before asking: explore the project context **before** any question or
  approach, and send a first-message echo of what you found and understood.
- Ask why-first open questions before presenting named options with a
  recommended pick; ask only when the answer changes what gets built, otherwise
  proceed on a default said aloud as a correctable proposal.
- Structured-question tooling is optional with a plain-prose fallback.
- The skip-ahead opt-out routes what is known to \`/rct:propose\` at any point —
  the user is never locked into finishing every step.
- The visual aid is offered just-in-time and never upfront, is capability-gated,
  and never depends on any companion server or file — text-only always works.
- Approaches go in their own message; one sensible way is enough — never invent
  extra approaches to reach a count; lead with the recommendation when real
  alternatives exist; YAGNI ruthlessly.
- Play the design back in a compact 200-300-word summary that labels agent-filled
  proposals, then present it section by section and get approval after each
  section; revise when a section is not approved.
- The terminal step is recommend-and-route: a single change → \`/rct:propose\`, a
  big split effort → step up a size to \`/rct:propose-batch\`. The route is
  always a gate, never automatic.
- The handoff carries the why, the approaches considered, and the non-goals into
  the chosen proposer's plan sections (\`## Why\`, \`### Approaches considered\`,
  \`## Non-goals\`).
- Spikes are payload-conditional: read \`spikes.enabled\` from the
  \`ratchet instructions brainstorm --json\` payload, never
  \`.ratchet/config.yaml\` directly; only when the value is \`true\` may you
  offer a spike — named by what it would prove, begun only on the user's
  explicit approval, throwaway, and built outside the tracked tree — and
  keeping anything from a spike routes as a new \`/rct:propose\` request. When
  the value is \`false\` or the payload is unavailable, never mention spikes.
- You invoke **no skill other than** \`/rct:propose\` or \`/rct:propose-batch\`.
  You do **not** hand off to a writing-plans skill or any implementation skill,
  you write **no** design doc, you run **no** spec self-review, and you gate
  **no** separate written-spec review.`;

export function getBrainstormSkillTemplate(): SkillTemplate {
  return {
    name: 'ratchet-brainstorm',
    description:
      'Brainstorm a rough idea into a validated design through collaborative dialogue, then recommend and (on approval) route into the right ratchet proposer. Triages a complete request straight to `/rct:propose`; explores project context and echoes findings before asking; asks why-first open questions, only when the answer changes what gets built (otherwise proceeds on defaults said aloud as correctable proposals); presents approaches in their own message (one sensible way allowed); plays the design back in a compact 200-300-word summary labelling agent-filled proposals; presents the design section-by-section with per-section approval; offers a skip-ahead opt-out to `/rct:propose` at any point; steps up a size to `/rct:propose-batch` for a big effort; and hands off the why, approaches considered, and non-goals. Does no implementation itself.',
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
