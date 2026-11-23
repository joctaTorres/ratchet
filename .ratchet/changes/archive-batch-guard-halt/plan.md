# archive-batch-guard-halt

## Why

The scenario-loss guard (`scenario-loss-guard`) refuses a change archive that
would drop store scenarios, and the archive skill routes that refusal through
the user (`archive-skill-accept-flow`). But `ratchet batch archive` cascades
the change-archive flow over every member: today a tripped guard propagates
the raw refusal without naming the offending member change, and nothing pins
that the cascade halts, that the batch directory stays in place re-runnable,
or that the archive-batch workflow body tells the agent to report the trip and
stop.

## What Changes

- `src/core/features-apply.ts`: introduce an exported `ScenarioLossError`
  (`extends Error`) carrying the `LostScenarios[]`; `applyFeatures` throws it
  instead of a plain `Error` with the identical formatted message, so the
  batch cascade can recognize a guard refusal structurally. No message or
  behavior change for existing callers (the CLI prints `.message`).
- `src/core/batch/archive.ts`: wrap the per-member `archiveChange(...)` call
  in the cascade loop. On a `ScenarioLossError`, rethrow an error carrying
  only the factual refusal: it names the member change, reproduces the
  guard's refusal listing (each store file and lost scenario) verbatim, and
  states the facts that the batch directory stays in place and the cascade is
  re-runnable with already-archived members skipped on re-run. It does NOT
  embed resolution or recovery instructions — how to resolve (restore
  scenarios, tombstone, archive the member individually, re-run) is lifecycle
  guidance owned solely by `ARCHIVE_BATCH_BODY` (delegated-lifecycle). Any
  other error propagates unchanged.
- `src/core/templates/workflows/archive-batch.ts` (`ARCHIVE_BATCH_BODY` — the
  single shared body consumed by both the archive-batch skill and command
  templates, per delegated-lifecycle): extend the cascade step with the
  scenario-loss halt handling — a guard refusal exits non-zero and halts the
  cascade at the offending member; report the trip to the user and stop,
  naming the member change and each lost scenario and its store file exactly
  as the refusal lists them; state that the batch directory stays in place and
  the cascade is re-runnable (already-archived members are skipped); then ASK
  the user whether to resolve the offending member by archiving it
  individually with `--accept-removed-scenarios` or via a `features/.deleted`
  tombstone — using capability-plus-fallback phrasing (a structured-question
  tool such as AskUserQuestion if your agent has one, otherwise ask in plain
  prose) — and route intentional scenario removal through the offending
  member's own archive flow (`/rct:archive`, which surfaces the scenario-loss
  accept flow) followed by a re-run of `/rct:archive-batch`. The agent never
  passes `--accept-removed-scenarios` on its own initiative.
- Per-agent rendered outputs (multi-agent-support — every registered agent in
  the supported-tools registry gets the updated body through the shared
  template; the change authors no per-agent copies):
  - Skill (`<skillsDir>/skills/ratchet-archive-batch/SKILL.md` per agent):
    - claude: `.claude/skills/ratchet-archive-batch/SKILL.md`
    - codex: `.codex/skills/ratchet-archive-batch/SKILL.md`
    - cursor: `.cursor/skills/ratchet-archive-batch/SKILL.md`
    - gemini: `.gemini/skills/ratchet-archive-batch/SKILL.md`
    - github-copilot: `.github/skills/ratchet-archive-batch/SKILL.md`
    - opencode: `.opencode/skills/ratchet-archive-batch/SKILL.md`
  - Command (per the agent's command adapter):
    - claude: `.claude/commands/rct/archive-batch.md`
    - codex: `<CODEX_HOME>/prompts/rct-archive-batch.md` (global; `CODEX_HOME`
      env override, default `~/.codex/prompts/rct-archive-batch.md`)
    - cursor: `.cursor/commands/rct-archive-batch.md`
    - gemini: `.gemini/commands/rct-archive-batch.md`
    - github-copilot: `.github/prompts/rct-archive-batch.prompt.md`
    - opencode: `.opencode/commands/rct-archive-batch.md`
- Core batch-archive tests in `test/core/batch/archive.test.ts`: a new
  `describe` pinning the halt — the thrown error names the member and lists
  its lost scenarios, the cascade never reaches later members, the batch
  directory stays in place, a re-run skips already-archived members and halts
  again at the same member, a re-run after the member is resolved completes,
  and a non-scenario-loss error propagates unwrapped. The changed test file
  header names `features/batch-archive/guard-halt.feature`, mirroring the
  feature.
- CLI e2e `test/cli-e2e/batch-archive-guard-halt.test.ts`: a two-member batch
  whose second member drops a store scenario — `ratchet batch archive` exits
  non-zero naming the member and the lost scenario with the batch directory in
  place and the first member really archived; after archiving the offending
  member individually with `--accept-removed-scenarios`, a re-run completes
  and moves the batch directory. The new test file header names
  `features/batch-archive/guard-halt.feature`, mirroring the feature.
- Rendered-output assertions appended to the phase's shared test
  `test/core/shared/scenario-safe-archive-rendered-output.test.ts`: a
  `findBatchGuardHaltViolations` predicate over a rendered archive-batch body,
  a unit case rejecting the pre-change body shape, and render loops asserting
  the guidance holds of the archive-batch skill and command rendered for every
  registered agent. Update the file header to also mirror
  `features/batch-archive/guard-halt.feature`.
- Documents the halt in the `batch archive` Behavior section of
  `docs/commands/batch.md` with one vertical Mermaid flowchart and factual
  prose.
- Implements `features/batch-archive/guard-halt.feature`.

Sibling behaviors in the phase are separate batch changes by approved
decomposition, not part of this one: the guard itself (`scenario-loss-guard`),
the archive-skill retry flow (`archive-skill-accept-flow`), and propose-side
store seeding (`propose-store-seeded-features`).

## Design

- **Recognize the refusal structurally, not by string matching.** The guard's
  refusal today is a plain `Error` whose message happens to start with
  "Refusing to apply features:". The cascade needs to distinguish a guard
  refusal from any other mid-cascade failure (only the former gets the
  member-naming, re-runnable halt treatment), so `applyFeatures` gains a
  typed `ScenarioLossError extends Error` — same formatted message, plus a
  `lostScenarios` payload — and `batch/archive.ts` uses `instanceof`. Existing
  guard tests and the `archive` CLI surface are untouched because the message
  text is unchanged.
- **Halt by propagation; context by wrapping — facts only in the engine.**
  The cascade already stops when a member archive throws (the batch-directory
  move is after the loop, so the batch stays in place and the existing
  idempotent skip makes a re-run safe). What is missing is member context: the
  wrap site catches `ScenarioLossError` and rethrows an error whose text is
  strictly factual — (1) it names the member change, (2) it reproduces the
  guard's own listing verbatim so no lost-scenario name is paraphrased, and
  (3) it states the facts that the batch directory stays in place and the
  cascade is re-runnable with already-archived members skipped. Per
  delegated-lifecycle the engine's error text carries NO resolution or
  recovery instructions (no restore/tombstone/accept-flag/re-run guidance):
  resolution is lifecycle meaning, and lifecycle meaning has exactly one
  author, `ARCHIVE_BATCH_BODY`. Non-scenario-loss errors keep the existing
  propagate-unchanged semantics (the documented mid-cascade failure mode),
  pinned by a test.
- **One author of lifecycle text (delegated-lifecycle).** The only
  lifecycle-template edit lands in the shared `ARCHIVE_BATCH_BODY` constant in
  `archive-batch.ts`; the skill and command templates keep consuming that one
  constant, so skill and command cannot drift. The body tells the agent to
  report the trip and stop, and then — because the halt needs a human decision
  the engine cannot make — to ASK the user how to resolve the offending
  member: archive it individually with `--accept-removed-scenarios` (through
  `/rct:archive`, the approval-gated accept flow shipped in
  `archive-skill-accept-flow`) or remove the file intentionally via a
  `features/.deleted` tombstone, then re-run `/rct:archive-batch`. The ask
  uses the capability-plus-fallback form (multi-agent-support): a
  structured-question tool such as AskUserQuestion if your agent has one,
  otherwise ask in plain prose. The body deliberately does not teach a
  batch-level accept route — `ratchet batch archive` has no
  `--accept-removed-scenarios` flag, intentional removal is a per-member
  decision owned by `/rct:archive`'s approval-gated flow, and the agent never
  passes the accept flag on its own initiative. No new config reaches the
  skill (instruction-fed-config is not engaged: the halt semantics are fixed
  behavior, not project config).
- **Per-agent outputs enumerated (multi-agent-support).** The shared body is
  rendered into the per-agent skill and command paths listed under
  "What Changes" for every agent in the supported-tools registry (claude,
  codex, cursor, gemini, github-copilot, opencode) — one shared template,
  rendered per agent through the adapter layer, no hand-authored per-agent
  copies. The new prose names no agent-specific capability except in the
  capability-plus-fallback form, keeps cross-workflow references in the
  canonical `/rct:<name>` form, and adds no agent-branching prose.
- **Enforcement at the right layers (testing standard).** Unit: the
  `findBatchGuardHaltViolations(body): string[]` predicate — pure string
  checks over a rendered archive-batch body, no filesystem — asserting each
  element: halt-at-offending-member stated, report-the-trip-and-stop directed,
  member + each lost scenario and its store file named exactly as listed,
  batch-directory-stays-and-re-runnable stated, the ask-the-user resolution
  choice (accept-flag archive or tombstone) in capability-plus-fallback form,
  removal routed through the member's own archive flow, and the
  never-on-own-initiative prohibition. Integration: tmpdir `archiveBatch`
  tests over the real cascade wiring with an injected `archiveChange` (the
  existing test seam). E2E: one `test/cli-e2e/` run driving the built CLI
  through refuse → resolve member → re-run completes. Render loops iterate the
  archive-batch skill template (`getSkillTemplates(['archive-batch'])` /
  `generateSkillContent`) and command template
  (`getCommandContents(['archive-batch'])` / per-adapter `generateCommand`)
  for each agent in the supported-tools registry (`AI_TOOLS`,
  `CommandAdapterRegistry`), asserting the predicate holds and the checked
  agent set is non-empty and equal to the registry length — a newly registered
  agent is covered automatically.
- **Verification.** `pnpm vitest run test/core/batch/archive.test.ts
  test/core/shared/scenario-safe-archive-rendered-output.test.ts
  test/cli-e2e/batch-archive-guard-halt.test.ts` is green; the phase
  proof-of-work (the two `accept-removed-scenarios` greps plus
  `pnpm vitest run test/core/features-apply-scenario-guard.test.ts
  test/cli-e2e/scenario-safe-archive.test.ts`) stays green; and per the
  testing standard the full suite (`pnpm test`) and the coverage gate
  (`pnpm test:coverage`) stay green.

## Tasks

- [x] 1.1 Add an exported `ScenarioLossError extends Error` to
  `src/core/features-apply.ts` — constructed from the `LostScenarios[]`,
  carrying them as a `lostScenarios` property, with `super(...)` passed the
  existing formatted refusal message verbatim — and throw it from
  `applyFeatures` in place of the plain `Error` (features:
  `batch-archive/guard-halt.feature`)
- [x] 1.2 In `src/core/batch/archive.ts`, wrap the per-member
  `archiveChange(intent.name)` call: on `ScenarioLossError`, rethrow an error
  carrying only the factual refusal — naming the member change, reproducing
  the guard's refusal listing (each store file and lost scenario) verbatim,
  and stating the facts that the batch directory stays in place and the
  cascade is re-runnable with already-archived members skipped on re-run —
  with NO resolution or recovery instructions embedded (all resolution
  guidance lives in `ARCHIVE_BATCH_BODY` per delegated-lifecycle); let any
  other error propagate unchanged
- [x] 1.3 Add a scenario-loss-halt `describe` to
  `test/core/batch/archive.test.ts` (mirroring
  `features/batch-archive/guard-halt.feature` — named in the changed test
  file's header): the rethrown error names the member and lists each lost
  scenario and its store file; the cascade never reaches members declared
  after the offender; the active batch directory stays in place and no
  archived batch directory is created; a re-run (with the already-archived
  member simulated under `changes/archive/`) skips it and halts again at the
  same member; a re-run with the offender archived completes the cascade and
  moves the batch; and a non-`ScenarioLossError` failure propagates without
  the halt wrapping
- [x] 2.1 Extend `ARCHIVE_BATCH_BODY` in
  `src/core/templates/workflows/archive-batch.ts` with the scenario-loss halt
  handling: a guard refusal exits non-zero and halts the cascade at the
  offending member; report the trip to the user and stop, naming the member
  change and each lost scenario and its store file exactly as the refusal
  lists them; state the batch directory stays in place and the cascade is
  re-runnable (already-archived members skipped); then ASK the user whether to
  resolve the offending member by archiving it individually with
  `--accept-removed-scenarios` or by listing the file in a
  `features/.deleted` tombstone — using capability-plus-fallback phrasing (a
  structured-question tool such as AskUserQuestion if your agent has one,
  otherwise ask in plain prose); route intentional removal through the
  offending member's own `/rct:archive` flow and then re-run
  `/rct:archive-batch`; never retry with scenario losses accepted on the
  agent's own initiative
- [x] 2.2 Append the batch-halt assertions to
  `test/core/shared/scenario-safe-archive-rendered-output.test.ts`: the
  `findBatchGuardHaltViolations` predicate over a rendered archive-batch body,
  a unit case asserting the predicate rejects the pre-change body shape (no
  halt guidance) on every dimension and accepts a well-formed body, render
  loops over the archive-batch skill and command templates for every
  registered agent asserting the predicate holds and the checked agent set is
  non-empty and equal to the registry length, and the file header updated to
  also mirror `features/batch-archive/guard-halt.feature`
- [x] 3.1 Add `test/cli-e2e/batch-archive-guard-halt.test.ts` (mirroring
  `features/batch-archive/guard-halt.feature` — named in the new test file's
  header) driving the built CLI over a tmpdir project: a store file holding a
  scenario, a two-member batch whose second member's change drops that
  scenario — `ratchet batch archive <name> --yes` exits non-zero naming the
  member and the lost scenario, the first member is really archived under
  `changes/archive/`, and the batch directory stays in place; then archive
  the offending member individually with `--accept-removed-scenarios` and
  re-run `ratchet batch archive <name> --yes` — exit zero and the batch
  directory moved under `batches/archive/`
- [x] 3.2 Documentation (per the `documentation` standard): extend the
  `batch archive` Behavior section of `docs/commands/batch.md` with the
  scenario-guard halt — lead with one valid vertical Mermaid `flowchart TD`
  of the halt-and-resume flow (cascade → guard trips at a member → halt naming
  the member and its lost scenarios with the batch in place → resolve the
  member via its own archive → re-run completes), every `classDef` setting
  `color:` with high-contrast fills and semantic Unicode node symbols,
  followed by factual prose: the refusal names the member change and lists
  each lost scenario and its store file, earlier-archived members stay
  archived, the batch directory is not moved, re-running skips
  already-archived members, and intentional removal is resolved through the
  member's individual `ratchet archive` (tombstone or
  `--accept-removed-scenarios`), replacing the current generic mid-cascade
  paragraph's coverage of this case
- [x] 4.1 Run `pnpm vitest run test/core/batch/archive.test.ts
  test/core/shared/scenario-safe-archive-rendered-output.test.ts
  test/cli-e2e/batch-archive-guard-halt.test.ts` (with `pnpm run build` first
  so the e2e drives a fresh CLI) plus the phase proof-of-work command (the two
  `accept-removed-scenarios` greps and `pnpm vitest run
  test/core/features-apply-scenario-guard.test.ts
  test/cli-e2e/scenario-safe-archive.test.ts`); per the testing standard also
  run the full suite (`pnpm test`) and the coverage gate (`pnpm
  test:coverage`); all must be green
