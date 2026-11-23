# propose-store-seeded-features

## Why

`ratchet archive` refuses to drop store scenarios (the `scenario-loss-guard`
change), but refusal is the backstop: a propose-authored feature file written
from scratch can still omit scenarios the store already holds, forcing the
user through the guard's refusal flow for a loss that should never have been
drafted. The propose body must make the loss impossible by construction: read
the capability's existing store files first and start each feature file from
the existing store file — copy and edit, never author from scratch.

## What Changes

- Add a store-seeding instruction to the `features`-artifact creation loop
  (step 5a) of `buildProposeBody` in `src/core/templates/workflows/propose.ts`
  — the single body consumed by both the `ratchet-propose` skill template and
  the `propose` command template:
  - Before authoring each feature file, read the capability's existing store
    files under `.ratchet/features/<capability>/` — every store file of the
    capability, not only the one at the target path — so a scenario that
    already exists in another store file of the capability is never added
    again (no duplicate scenarios across the capability's store files).
  - When a store file already exists at the feature file's store-relative
    path, start the file from that store file: copy it into the change and
    edit the copy — never author it from scratch — so existing store
    scenarios are preserved by construction.
  - Author a feature file new only when the store has no file at that path
    (a fresh capability or a new file in an existing one).
- Add one short store-seeding line to the `features` artifact `instruction`
  in `schemas/ratchet/schema.yaml` (the payload surfaced by
  `ratchet instructions features`): when `.ratchet/features/<cap>/<file>.feature`
  already exists at the target path, start from that store file (copy it into
  the change, keep its scenarios, then edit) and never recreate it from
  scratch; the existing one-file-per-scenario-set guidance is kept otherwise.
  Pin that payload wording with a test in
  `test/commands/workflow/instructions.test.ts`, following the pattern used
  for the apply instruction there.
- Append store-seeding rendered-output assertions to the phase's shared test
  `test/core/shared/scenario-safe-archive-rendered-output.test.ts`: a
  `findStoreSeedingViolations` predicate over a rendered propose body, unit
  cases proving it rejects the pre-change body shape, and render loops
  asserting it holds of the propose skill and command rendered for every
  registered agent. Update the file header to also mirror
  `features/propose/store-seeded-features.feature`.
- Documents the propose workflow's store-seeded feature authoring in
  `docs/configuration/generated-artifacts.md`, beside the scenario-loss
  accept-flow section (generated skill/command behavior is
  Reference-documented there — the scope-reconciliation and accept-flow
  sections are the precedent).
- Implements `features/propose/store-seeded-features.feature`.
- The phase-2 planning-boundary text in `propose.ts` (the **Planning
  boundary** paragraph, step 8, and the boundary guardrail) stays intact —
  this change adds store-seeding to step 5a only.

Sibling behaviors in the phase are separate batch changes by approved
decomposition, not part of this one: the guard itself (`scenario-loss-guard`),
the archive-skill retry flow (`archive-skill-accept-flow`), and the
batch-archive halt (`archive-batch-guard-halt`).

## Design

- **One author of lifecycle text (delegated-lifecycle).** The only
  lifecycle-template edit lands in the shared `buildProposeBody` constant;
  `getRctProposeSkillTemplate` and `getRctProposeCommandTemplate` keep
  consuming that one builder, so skill and command cannot drift. The only
  schema edit is one added line in the `features` artifact `instruction` of
  `schemas/ratchet/schema.yaml` — the payload `ratchet instructions features`
  already surfaces verbatim, so no CLI or engine code changes. The guard
  itself (`scenario-loss-guard`) is untouched, and no new config reaches the
  skill (instruction-fed-config is not engaged: the store path is a fixed
  ratchet convention, not project config).
- **Prevention by construction, not by reminder.** The instruction seeds each
  feature file from the store copy, so a scenario that exists in the store is
  present in the draft unless the agent deletes it deliberately — which the
  archive guard then still catches. Seeding and guarding compose: seeding
  makes the common case lossless, the guard refuses the rest. The read also
  spans the capability's *other* store files, so a scenario already accepted
  under a different file of the same capability is never drafted twice.
  The bullet's target shape (one new bullet in step 5a):
  > For a `features` artifact, before authoring each feature file: read the
  > capability's existing store files under `.ratchet/features/<capability>/`
  > — never add a scenario that already exists in another store file of the
  > capability. When a store file already exists at the file's store-relative
  > path, start the feature file from that store file — copy it into the
  > change and edit the copy, never author it from scratch — so existing
  > store scenarios are preserved by construction. Author a feature file new
  > only when the store has no file at that path.
- **The schema instruction says the same thing in one line.** The `features`
  artifact instruction keeps its one-file-per-scenario-set layout guidance
  and gains one short line: when `.ratchet/features/<cap>/<file>.feature`
  already exists at the target path, start from that store file — copy it
  into the change, keep its scenarios, then edit — and never recreate it
  from scratch. A payload-wording test pins the line through
  `ratchet instructions features --json`, the same surface the apply
  instruction tests in `test/commands/workflow/instructions.test.ts` pin.
- **Enforcement at the unit layer (testing standard).** The shared test file
  gains a `findStoreSeedingViolations(body): string[]` predicate — pure string
  checks over a rendered propose body, no filesystem — asserting each element:
  reads `.ratchet/features/<capability>/` before authoring; the
  never-add-a-duplicate-scenario prohibition for scenarios already in another
  store file of the capability; copy-it-into-the-change-and-edit-the-copy
  start; the never-author-from-scratch prohibition; the
  preserved-by-construction purpose; and the author-new-only-when-absent
  allowance. Render loops iterate the propose skill template
  (`getSkillTemplates(['propose'])` / `generateSkillContent`) and command
  template (`getCommandContents(['propose'])` / per-adapter `generateCommand`)
  for each agent in the supported-tools registry (`AI_TOOLS`,
  `CommandAdapterRegistry`), asserting the predicate holds and the checked
  agent set is non-empty and equal to the registry length. Unit cases feed the
  predicate the pre-change body shape (step 5a with no store-seeding bullet)
  and assert rejection on every dimension, plus one well-formed body asserted
  clean. The schema line is pinned by an integration test over the
  instructions payload. No CLI behavior changes, so no E2E layer is
  exercised.
- **Per-agent outputs covered (multi-agent-support).** The propose skill
  renders to `<skillsDir>/skills/ratchet-propose/SKILL.md` for every registry
  agent (`.claude`, `.codex`, `.cursor`, `.gemini`, `.github`, `.opencode`);
  the command renders to each adapter's path
  (`.claude/commands/rct/propose.md`, `<CODEX_HOME>/prompts/rct-propose.md`,
  `.cursor/commands/rct-propose.md`, `.gemini/commands/rct-propose.md`,
  `.github/prompts/rct-propose.prompt.md`,
  `.opencode/commands/rct-propose.md`). The render loop iterates the registry,
  so a newly registered agent is covered automatically. The new prose names no
  agent-specific capability, keeps cross-workflow references in the canonical
  `/rct:<name>` form, and adds no agent-branching prose.
- **Verification.** `pnpm vitest run
  test/core/shared/scenario-safe-archive-rendered-output.test.ts
  test/commands/workflow/instructions.test.ts` is green; the phase
  proof-of-work (the two `accept-removed-scenarios` greps plus
  `pnpm vitest run test/core/features-apply-scenario-guard.test.ts
  test/cli-e2e/scenario-safe-archive.test.ts`) stays green; and per the
  testing standard the full suite (`pnpm test`) and the coverage gate
  (`pnpm test:coverage`) stay green.

## Tasks

- [x] 1.1 Add the store-seeding bullet to step 5a ("For each artifact that is
  `ready`") of `buildProposeBody` in `src/core/templates/workflows/propose.ts`:
  read the capability's existing store files under
  `.ratchet/features/<capability>/` before authoring — never add a scenario
  that already exists in another store file of the capability; when a store
  file exists at the file's store-relative path, start the feature file from
  it (copy it into the change and edit the copy, never author it from
  scratch) so existing store scenarios are preserved by construction; author
  new only when the store has no file at that path. Keep the phase-2
  planning-boundary text (the **Planning boundary** paragraph, step 8, and
  the boundary guardrail) intact (features:
  `propose/store-seeded-features.feature`)
- [x] 1.2 Add one short store-seeding line to the `features` artifact
  `instruction` in `schemas/ratchet/schema.yaml`: when
  `.ratchet/features/<cap>/<file>.feature` already exists at the target path,
  start from that store file (copy it into the change, keep its scenarios,
  then edit) and never recreate it from scratch; keep the existing
  one-file-per-scenario-set guidance otherwise. Pin the payload wording with
  a test in `test/commands/workflow/instructions.test.ts` asserting the
  `instruction` payload of `ratchet instructions features --json` carries the
  line, following the apply-instruction test pattern there
- [x] 2.1 Append the store-seeding assertions to
  `test/core/shared/scenario-safe-archive-rendered-output.test.ts`: the
  `findStoreSeedingViolations` predicate over a rendered propose body (store
  read before authoring, never-add-a-scenario-already-in-another-store-file-
  of-the-capability prohibition, copy-and-edit start, never-from-scratch
  prohibition, preserved-by-construction purpose,
  author-new-only-when-absent allowance), unit cases asserting the predicate
  rejects the pre-change body shape on every dimension and accepts a
  well-formed body, render loops over the propose skill and command templates
  for every registered agent asserting the predicate holds and the checked
  agent set is non-empty and equal to the registry length, and the file
  header updated to also mirror
  `features/propose/store-seeded-features.feature`
- [x] 2.2 Run `pnpm vitest run
  test/core/shared/scenario-safe-archive-rendered-output.test.ts
  test/commands/workflow/instructions.test.ts` plus the phase proof-of-work
  command (the two `accept-removed-scenarios` greps and `pnpm vitest run
  test/core/features-apply-scenario-guard.test.ts
  test/cli-e2e/scenario-safe-archive.test.ts`); per the testing standard also
  run the full suite (`pnpm test`) and the coverage gate
  (`pnpm test:coverage`); all must be green
- [x] 3.1 Documentation (per the `documentation` standard): add a
  Reference-style section on the propose workflow's store-seeded feature
  authoring to `docs/configuration/generated-artifacts.md` beside the
  scenario-loss accept-flow section, lead it with one valid vertical Mermaid
  `flowchart TD` of the authoring flow (read the capability's store files →
  store file exists? → copy and edit the store file, never from scratch /
  author new when absent → no duplicate scenarios → archive guard passes with
  scenarios preserved), every `classDef` setting `color:` with high-contrast
  fills and semantic Unicode node symbols, followed by factual prose matching
  the new body and the new schema instruction line. Confirm `README.md`
  still matches (it describes the feature store layout, not
  feature-authoring internals), so no edits there
