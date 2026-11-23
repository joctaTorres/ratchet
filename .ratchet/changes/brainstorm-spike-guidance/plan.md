# brainstorm-spike-guidance

## Why

The batch phase's two sibling changes landed the spike opt-in seam
(`ratchet instructions brainstorm --json` reporting `spikes.enabled`) and the
superpowers-v7 restatement of the brainstorm body — but the body still says
nothing about spikes, so the opt-in reaches no behavior. This change authors
the missing half: payload-conditional spike guidance in the shared brainstorm
body, so an agent offers a throwaway spike only when the payload enables it
and never mentions spikes otherwise.

## What Changes

- Add one payload-conditional spike-guidance block to the shared
  `BRAINSTORM_BODY` in `src/core/templates/workflows/brainstorm.ts` (placed
  after the approaches step, where a spike would inform an uncertain approach
  question, plus one guardrail bullet): the agent reads `spikes.enabled` from
  the `ratchet instructions brainstorm --json` payload and never reads
  `.ratchet/config.yaml` directly; only when the value is `true` the agent may
  offer a spike — naming what the spike would prove, gated on the user's
  explicit approval before any spike work begins; a spike is throwaway, built
  outside the tracked tree in a scratch location, and discarded once it has
  answered its question; keeping anything from a spike routes as a new
  `/rct:propose` request; when the value is `false` or the payload is
  unavailable, spikes are never mentioned.
- Append spike-guidance assertions to
  `test/core/shared/brainstorm-v7-rendered-output.test.ts`: a
  `findSpikeGuidanceViolations(body)` predicate asserted on the skill and the
  command rendered for every registered agent, unit cases proving the
  predicate rejects unconditional spike wording and config-direct reads (and
  each missing rule) while accepting the shipped body, a documentation
  assertion on `docs/configuration/generated-artifacts.md`, and a header
  comment update (the file currently states spike wording is deliberately not
  asserted because this change appends it).
- Document the payload-conditional spike guidance in
  `docs/configuration/generated-artifacts.md` per the documentation standard.
- Implements `features/brainstorm/spike-guidance.feature`.

## Non-goals

- No change to the `ratchet instructions brainstorm --json` payload, the
  `brainstorm.spikes` config key, or the CLI special case — decided at phase
  decomposition: shipped by `brainstorm-instructions-payload`, which this
  change only consumes.
- No v7 restatement of the brainstorm body — shipped by
  `brainstorm-v7-behaviors`; this change appends one conditional block and
  keeps every v7 and removed-behavior assertion green untouched.
- No README credits/provenance edit recording upstream baselines — that is the
  `upstream-baseline-credits` change.
- No spike mechanics beyond the four rules in the definition of done
  (user-approved, throwaway, outside the tracked tree, keeping routed as a new
  `/rct:propose` request): no spike storage convention, no spike template, no
  named scratch path or tooling default — the guidance stays tool- and
  ecosystem-neutral, naming no concrete command or path.
- No new workflow, command id, or per-agent output path: the skill
  (`ratchet-brainstorm`) and command (`brainstorm`) render exactly where they
  render today.
- No unconditional spike advocacy and no config read inside skill prose: the
  body teaches silence when the payload is false or unavailable, and the only
  sanctioned source of the value is the payload (instruction-fed-config).

## Design

- **One author, one constant (delegated-lifecycle).** The guidance edits the
  existing `BRAINSTORM_BODY` in place; the skill template and command template
  keep consuming that single constant, so the behavior is authored exactly
  once and rendered per agent by the existing adapter layer. No engine, CLI,
  or per-agent copy of the guidance is introduced.
- **The payload is the only seam (instruction-fed-config).** The body
  instructs the agent to run `ratchet instructions brainstorm --json` and read
  the resolved `spikes.enabled` value as data, and states explicitly that the
  agent never reads `.ratchet/config.yaml` itself. Conditioning behavior on
  the resolved payload value is the standard's own model — the skill acts on
  payload data; what is forbidden (an inline config read, config-branching
  template prose) is named as forbidden in the body and pinned by the
  predicate. The payload's exit-zero-always contract (shipped by the sibling
  change) is what makes "unavailable ⇒ never mention spikes" a safe rule.
- **Agent-neutral by construction (multi-agent-support).** The block is static
  body text rendered identically for every agent; it names no agent, uses no
  agent-specific capability, and references only the canonical `/rct:propose`
  route. Per-agent outputs (paths unchanged, content gains the block) — the
  exact rendered skill and command file paths for every registered agent, as
  the Tool paths table in `docs/configuration/generated-artifacts.md` lists
  them, with skill directory `ratchet-brainstorm` and command id `brainstorm`:
  Claude Code (`claude`): skill `.claude/skills/ratchet-brainstorm/SKILL.md`,
  command `.claude/commands/rct/brainstorm.md`; Codex (`codex`): skill
  `.codex/skills/ratchet-brainstorm/SKILL.md`, command
  `~/.codex/prompts/rct-brainstorm.md` (global; respects `CODEX_HOME`); Cursor
  (`cursor`): skill `.cursor/skills/ratchet-brainstorm/SKILL.md`, command
  `.cursor/commands/rct-brainstorm.md`; Gemini (`gemini`): skill
  `.gemini/skills/ratchet-brainstorm/SKILL.md`, command
  `.gemini/commands/rct-brainstorm.md`; GitHub Copilot (`github-copilot`):
  skill `.github/skills/ratchet-brainstorm/SKILL.md`, command
  `.github/prompts/rct-brainstorm.prompt.md`; OpenCode (`opencode`): skill
  `.opencode/skills/ratchet-brainstorm/SKILL.md`, command
  `.opencode/commands/rct-brainstorm.md`. The appended assertions iterate the
  registry rather than naming one agent.
- **Placement: one block, not woven through steps.** The block lands after the
  approaches step (a spike answers a genuinely uncertain approach question
  before the design is played back) with one guardrail bullet, so the v7 step
  text is untouched and the existing predicates keep passing: the block routes
  only to `/rct:propose`, adds no forbidden pre-change wording, and keeps the
  removed-behavior negatives intact.
- **Predicate design (testing standard).** `findSpikeGuidanceViolations(body)`
  returns one violation per missing rule: (a) the payload read
  (`ratchet instructions brainstorm --json` naming `spikes.enabled`); (b) the
  never-read-config-directly rule; (c) the only-when-`true` condition; (d)
  explicit user approval before spike work; (e) throwaway; (f) built outside
  the tracked tree; (g) keeping routed as a new `/rct:propose` request;
  (h) never mentioned when the value is false or unavailable. Unit cases
  reject a body that offers spikes with no payload read, a body that reads the
  config file directly, and a body missing each individual rule, and accept
  the shipped body; registry render loops assert the predicate on the skill
  and command rendered for every registered agent, with the non-empty /
  full-coverage guards the file already establishes. A documentation
  assertion, in the file's existing real-file Reference block, pins the
  `docs/configuration/generated-artifacts.md` entry. The file header mirrors
  `features/brainstorm/spike-guidance.feature`. Full suite (`pnpm test`) and
  the coverage gate (`pnpm test:coverage`) stay green.
- **Verification.** `pnpm vitest run
  test/core/shared/brainstorm-v7-rendered-output.test.ts
  test/core/templates/workflows/brainstorm.test.ts` is green (the latter
  unchanged — the block only appends), the agent-neutral rendered-output test
  stays green, and the phase proof-of-work's e2e half (`pnpm vitest run
  test/cli-e2e`) stays green — this change touches no CLI surface.

### Approaches considered

- **Append one conditional block to the shared body (chosen).** The smallest
  change that proves the goal end to end: one block plus a guardrail in the
  single shared constant, pinned on every registered agent by assertions
  appended to the existing v7 rendered-output test, with no v7 text touched.
- **Weave spike mentions into each relevant step (triage, approaches,
  playback).** Dropped: it spreads one opt-in behavior across the body, risks
  tripping the v7 and removed-behavior predicates, and makes the
  never-mention-when-disabled rule impossible to state once.
- **Render two body variants (spikes on / off) selected at generation time.**
  Dropped: it violates instruction-fed-config twice over — generation is
  static and identical for every project, while the opt-in is project config
  resolved at skill-invocation time into payload data; the body must stay one
  static constant that conditions on the payload.

## Tasks

- [x] 1.1 Add the payload-conditional spike-guidance block to `BRAINSTORM_BODY`
  in `src/core/templates/workflows/brainstorm.ts`, placed after the approaches
  step, plus one guardrail bullet, stating all of: read `spikes.enabled` from
  the `ratchet instructions brainstorm --json` payload and never read
  `.ratchet/config.yaml` directly; only when the value is `true`, the agent
  may offer a spike that names what it would prove, with no spike work before
  the user's explicit approval; a spike is throwaway, built outside the
  tracked tree in a scratch location; keeping anything from a spike routes as
  a new `/rct:propose` request; when the value is `false` or the payload is
  unavailable, spikes are never mentioned (features:
  `brainstorm/spike-guidance.feature`)
- [x] 1.2 Confirm the existing template test
  `test/core/templates/workflows/brainstorm.test.ts` passes unchanged against
  the appended body (the block only appends; no v7 restatement) (features:
  `brainstorm/spike-guidance.feature`)
- [x] 2.1 Append to `test/core/shared/brainstorm-v7-rendered-output.test.ts`
  (header mirrors `features/brainstorm/spike-guidance.feature`): the
  `findSpikeGuidanceViolations(body)` predicate with unit cases rejecting an
  unconditional spike offer, a config-direct read, and a body missing each
  individual rule, and accepting the shipped body; render loops over the
  supported-tools registry and the command adapter registry asserting the
  predicate on every registered agent's rendered skill and command (with the
  non-empty / full-coverage guards); the
  `docs/configuration/generated-artifacts.md` documentation assertion in the
  file's real-file Reference block; and the header-comment update removing the
  "spike wording is deliberately NOT asserted" note (features:
  `brainstorm/spike-guidance.feature`)
- [x] 2.2 Run `pnpm build`, then the focused tests (`pnpm vitest run
  test/core/shared/brainstorm-v7-rendered-output.test.ts
  test/core/templates/workflows/brainstorm.test.ts
  test/core/shared/agent-neutral-rendered-output.test.ts test/cli-e2e`), then
  per the testing standard the full suite (`pnpm test`) and the coverage gate
  (`pnpm test:coverage`); all must be green
- [x] 3.1 Documentation (per the `documentation` standard): add a
  payload-conditional spike guidance subsection for the brainstorm workflow to
  `docs/configuration/generated-artifacts.md` — the payload seam
  (`ratchet instructions brainstorm --json`, never a config read), the four
  spike rules (user-approved, throwaway, outside the tracked tree, keeping
  routed as a new `/rct:propose` request), and the silence rule when disabled
  or unavailable. The subsection is **prose only — no Mermaid diagram**: this
  is a minor conditional leaf behavior, and the documentation standard's
  use-diagrams-deliberately rule reserves diagrams for core/important subjects
  and forbids diagramming a leaf component or restating adjacent prose. The
  README decision is explicit: **README.md does not change in this change** —
  its brainstorm descriptions cover the dialogue behavior, which this change
  leaves untouched (the body teaches silence when spikes are disabled, so no
  README-described behavior goes stale), and its `instructions brainstorm`
  payload row already records `spikes.enabled` as opt-in and off by default
  (shipped by `brainstorm-instructions-payload`, which owns that surface)
