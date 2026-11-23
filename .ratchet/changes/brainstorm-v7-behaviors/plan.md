# brainstorm-v7-behaviors

## Why

Ratchet's brainstorm body is a restatement of the superpowers `brainstorming`
skill as adapted at the v6 fork point; superpowers 7.0.2 has since reshaped
that skill (triage, why-first questioning, ask-only-when-it-changes-the-build,
playback, skip-ahead). The batch's approved design absorbs v7 restated in
ratchet terms, and this change authors that restatement into the single shared
brainstorm body so every registered agent renders the v7 behavior.

## What Changes

- Restate the shared `BRAINSTORM_BODY` constant in
  `src/core/templates/workflows/brainstorm.ts` to superpowers v7 in ratchet
  terms: (1) triage routing a complete request straight to `/rct:propose`;
  (2) why-first open questions, then named options with a recommended pick;
  (3) asking only when the answer changes what gets built — otherwise
  proceeding on a correctable proposal with defaults said aloud; (4) look
  before asking, with a first-message echo of what was found and understood;
  (5) approaches in their own message, with "one sensible way" allowed;
  (6) a compact 200-300-word playback that labels agent-filled proposals, with
  per-section approval kept; (7) a skip-ahead opt-out routing to
  `/rct:propose` at any point; (8) step-up-a-size to `/rct:propose-batch` when
  the effort is bigger than one change; (9) a handoff carrying the why, the
  approaches considered, and the non-goals into the chosen proposer. The
  pre-change mechanics v7 replaces (the one-question-per-message rule, the
  multiple-choice-first preference, the forced two-to-three approaches) are
  removed; the ratchet-specific reframes v7 does not touch (just-in-time
  capability-gated visual aid, no writing-plans/implementation-skill handoff,
  no sub-project decomposition, no design doc / spec self-review /
  written-spec gate, existing-codebase targeted improvements, agent-neutral
  capability-plus-fallback phrasing, recommend-then-gate routing after design
  approval) are kept.
- Restate the `ratchet-brainstorm` skill `description` metadata in the same
  file so it describes the v7 flow instead of "asks clarifying questions one
  at a time, proposes 2-3 approaches".
- Record the absorbed baseline in the template file's provenance header: the
  doc comment names the exact string `superpowers 7.0.2` as the absorbed
  upstream baseline, alongside the existing fork-adaptation notes.
- Add `test/core/shared/brainstorm-v7-rendered-output.test.ts`: a v7-behavior
  predicate over the rendered body, asserted on the skill and command rendered
  for every registered agent (iterating the supported-tools registry and the
  command adapter registry), plus unit cases rejecting the pre-change body
  shape, plus the provenance-header assertion on the exact string.
- Restate `test/core/templates/workflows/brainstorm.test.ts` to the v7 body
  shape: its current assertions pin the pre-change mechanics (one question
  per message, multiple-choice preference, two-to-three approaches) and would
  fail against the restated body; the kept behaviors (visual aid, routing
  gate, removed-source-behavior negatives, shared body constant, per-adapter
  rendering) stay pinned.
- Implements `features/brainstorm/explore-and-clarify.feature`,
  `features/brainstorm/approaches-and-design.feature`,
  `features/brainstorm/route-to-propose-or-batch.feature`, and
  `features/brainstorm/v7-rendered-output.feature`.

## Non-goals

- No spike guidance, spike mechanics, or any mention of spikes in the
  brainstorm body — decided at phase decomposition: that is the
  `brainstorm-spike-guidance` change, which consumes the
  `brainstorm-instructions-payload` payload after this change lands.
- No README credits edit recording the absorbed upstream baselines — decided
  at phase decomposition: that is the `upstream-baseline-credits` change. This
  change records the baseline only in the template's provenance header.
- No change to the `ratchet instructions brainstorm --json` payload or the
  `brainstorm.spikes` config key — already shipped by
  `brainstorm-instructions-payload`; this change consumes nothing from it.
- No removal of the just-in-time visual-aid reframe — the batch non-goals
  exclude the superpowers companion server and design-doc machinery, and the
  capability-gated, server-less visual aid is ratchet's own reframe, kept
  as-is.
- No verbatim port of the upstream skill text — the batch header requires
  v7 restated in ratchet terms (Gherkin features, `/rct:` doors, ratchet
  guardrails), never ported verbatim.
- No new workflow, command id, or per-agent output path: the skill
  (`ratchet-brainstorm`) and command (`brainstorm`) render exactly where they
  render today.

## Design

- **One author, one constant (delegated-lifecycle).** The restatement edits
  the existing `BRAINSTORM_BODY` in place; the skill template and command
  template keep consuming that single constant, so the v7 behavior is authored
  exactly once and rendered per agent by the existing adapter layer. No engine,
  CLI, or per-agent copy of the brainstorm flow is introduced.
- **Agent-neutral by construction (multi-agent-support).** The body keeps the
  capability-plus-fallback form for the one agent-specific capability it names
  (a structured-question tool such as AskUserQuestion, "if your agent has
  one", with a plain-prose fallback), references other workflows only by
  canonical `/rct:propose` / `/rct:propose-batch` names, and never branches on
  which agent is running. Per-agent outputs (unchanged paths, content
  restated): for every agent in the supported-tools registry — Claude Code
  (`.claude`), Codex (`.codex`), Cursor (`.cursor`), Gemini (`.gemini`),
  GitHub Copilot (`.github`), OpenCode (`.opencode`) — the skill renders under
  `<skillsDir>/skills/ratchet-brainstorm/` and the command renders at that
  agent's `rct` command path for command id `brainstorm`. The new shared test
  iterates the registry rather than naming one agent, and fails if the
  checked agent set ever stops covering the registry.
- **No config in the body (instruction-fed-config).** The restated body reads
  no config and mentions no config-driven behavior; the spike opt-in arrives
  in the sibling change as `ratchet instructions brainstorm --json` payload
  data, and only then does the body gain payload-conditional spike prose.
- **The v7 restatement is ratchet-shaped, not upstream-shaped.** Each v7
  behavior is expressed in ratchet terms: triage and skip-ahead route to
  `/rct:propose`; step-up-a-size routes to `/rct:propose-batch` (never a
  hand-rolled sub-project split); the playback's labelled agent-filled
  proposals are the same "defaults said aloud" the questioning rule states;
  the handoff carries the why, approaches, and non-goals so the propose
  artifacts (plan `## Why`, `### Approaches considered`, `## Non-goals`)
  inherit the dialogue's decisions.
- **Testing at the right layers (testing standard).** Unit:
  `test/core/shared/brainstorm-v7-rendered-output.test.ts` pins a
  `findBrainstormV7Violations(body)`-style predicate — one violation per
  missing v7 behavior — with unit cases proving the predicate rejects a
  sample pre-change body (no triage, multiple-choice-first, forced 2-3
  approaches, no playback, no skip-ahead) and accepts the well-formed v7
  body; render loops assert the predicate on the skill and command rendered
  for every registered agent, with the non-empty/full-coverage guard; a
  source-level assertion greps the template file's provenance header for the
  exact string `superpowers 7.0.2`. The header mirrors
  `features/brainstorm/v7-rendered-output.feature`.
  `test/core/templates/workflows/brainstorm.test.ts` is restated to the v7
  shape in the same change. Full suite (`pnpm test`) and the coverage gate
  (`pnpm test:coverage`) stay green.
- **Verification.** `pnpm vitest run
  test/core/shared/brainstorm-v7-rendered-output.test.ts
  test/core/templates/workflows/brainstorm.test.ts` is green,
  `grep -q 'superpowers 7.0.2' src/core/templates/workflows/brainstorm.ts`
  passes, and the phase proof-of-work's e2e half (`pnpm vitest run
  test/cli-e2e`) stays green — this change touches no CLI surface.

### Approaches considered

- **Restate the single shared constant in place (chosen).** One body edit,
  consumed by both the skill and the command, pinned by a rendered-output
  test over the whole registry. This is the smallest change that proves the
  phase goal end to end: every registered agent's rendered brainstorm surface
  carries each v7 behavior, and the pre-change shape is actively rejected.
- **Append a v7 section alongside the v6 mechanics.** Dropped: the two models
  contradict inside one body (ask-one-question-per-message vs.
  ask-only-when-the-answer-changes-the-build; multiple-choice-first vs.
  why-first open questions) — a body carrying both teaches neither.
- **Keep the v6 body and add only a triage preamble.** Dropped: the approved
  definition of done restates the full dialogue (questioning, defaults,
  echo, approaches, playback, opt-outs, handoff), not just the front door, so
  a preamble-only change cannot satisfy it.

## Tasks

- [x] 1.1 Restate `BRAINSTORM_BODY` in `src/core/templates/workflows/brainstorm.ts`
  to the v7 behavior set (triage to `/rct:propose`; why-first open questions
  then named options with a pick; ask only when the answer changes what gets
  built, else a correctable proposal with defaults said aloud; look before
  asking with a first-message echo; approaches in their own message with "one
  sensible way" allowed; 200-300-word playback labelling agent-filled
  proposals with per-section approval kept; skip-ahead opt-out to
  `/rct:propose`; step-up-a-size to `/rct:propose-batch`; handoff carrying the
  why, approaches, and non-goals), removing the pre-change mechanics v7
  replaces and keeping the ratchet reframes v7 does not touch, and restate
  the skill `description` metadata to match. The handoff text must name the
  why, the approaches considered, and the non-goals explicitly so they land
  in the propose plan's `## Why`, `### Approaches considered`, and
  `## Non-goals` sections (features:
  `brainstorm/explore-and-clarify.feature`,
  `brainstorm/approaches-and-design.feature`,
  `brainstorm/route-to-propose-or-batch.feature`)
- [x] 1.2 Update the provenance header doc comment in
  `src/core/templates/workflows/brainstorm.ts`: restate its summary line so it
  no longer says the flow asks one question at a time or proposes 2-3
  approaches (it now describes the v7 flow); update the adapted/removed list —
  replaced by v7: the one-question-per-message rule, the multiple-choice-first
  preference, and the forced 2-3 approaches (now why-first open questions,
  then named options with a pick); still removed: the design-doc write, the
  spec self-review or builder-check spec reviewer subagent, the written-spec
  gate, the writing-plans or implementation handoff, the sub-project
  decomposition, and the bundled companion server (the visual aid stays
  capability-gated and server-less); and record the exact string
  `superpowers 7.0.2` as the absorbed upstream baseline (features:
  `brainstorm/v7-rendered-output.feature`)
- [x] 2.1 Add `test/core/shared/brainstorm-v7-rendered-output.test.ts` (header
  mirrors `features/brainstorm/v7-rendered-output.feature`): a
  v7-behavior violation predicate with unit cases rejecting the pre-change
  body shape and accepting the well-formed body, render loops asserting the
  predicate on the skill and command rendered for every registered agent
  (supported-tools registry + command adapter registry, with
  non-empty/full-coverage guards), and the provenance-header assertion on the
  exact string `superpowers 7.0.2`. For every registered agent's rendered
  skill AND command body, also assert the removed behaviors stay removed (no
  design-doc write, no spec reviewer or builder check, no writing-plans
  handoff, no companion server dependency, routing only to `/rct:propose` or
  `/rct:propose-batch` behind an explicit gate) and that the
  prefer-multiple-choice and one-question-per-message wording is gone. Do NOT
  assert absence of spike wording (the sibling change appends to this test) —
  the body simply never mentions spikes (features:
  `brainstorm/v7-rendered-output.feature`)
- [x] 2.2 Restate `test/core/templates/workflows/brainstorm.test.ts` to the v7
  body shape: replace the pre-change mechanics assertions (one question per
  message, multiple-choice preference, two-to-three approaches) with v7
  assertions, keep the pins on the behaviors this change preserves (visual
  aid, routing gate, removed-source-behavior negatives, shared body constant,
  per-adapter rendering) (features: `brainstorm/explore-and-clarify.feature`,
  `brainstorm/approaches-and-design.feature`,
  `brainstorm/route-to-propose-or-batch.feature`)
- [x] 2.3 Run `pnpm build`, the focused tests (`pnpm vitest run
  test/core/shared/brainstorm-v7-rendered-output.test.ts
  test/core/templates/workflows/brainstorm.test.ts
  test/core/shared/agent-neutral-rendered-output.test.ts test/cli-e2e` — the
  agent-neutral rendered-output test runs explicitly), then per the testing
  standard the full suite (`pnpm test`) and the coverage gate
  (`pnpm test:coverage`); confirm `grep -q 'superpowers 7.0.2'
  src/core/templates/workflows/brainstorm.ts`; all must be green. Stay inside
  the repository — no shell access to /tmp or external directories
- [x] 3.1 Documentation (per the `documentation` standard): update `README.md`
  so its brainstorm descriptions (the "From fuzzy idea to spec" bullet and the
  workflows table row) describe the v7 behavior instead of "clarifies one
  question at a time, weighs 2–3 approaches", and verify
  `docs/configuration/generated-artifacts.md`'s brainstorm entry (skill
  directory / command id table) remains accurate against the restated
  surface. No new Mermaid diagram: this is a text restatement of an existing
  generated artifact whose structure and flow are unchanged
