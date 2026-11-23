# plan-template-nongoals-approaches

## Why

A plan records what a change does, but not what it deliberately won't do or
which approaches were weighed — so exclusions decided with the user, in an
issue, or in a brainstorm evaporate at planning time, and an agent can
self-approve an omission invisibly. This change makes the plan's structure
carry both: a default `## Non-goals` section (each entry traced to a
user/issue/brainstorm decision) and a `### Approaches considered` subsection
inside Design, on all three authoring surfaces — the template, the schema
instruction payload, and the shared propose body.

## What Changes

- `schemas/ratchet/templates/plan.md`: add a default `## Non-goals` section
  between `## What Changes` and `## Design` whose placeholder guidance directs
  that each entry traces to a decision the user, an originating issue, or a
  brainstorm made — never an omission the agent approved on its own — with an
  explicit one-liner when nothing was ruled out; add a
  `### Approaches considered` subsection inside `## Design` (before
  `## Tasks`) whose guidance names the approaches weighed and allows "one
  sensible way" when there is genuinely one sensible approach.
- `schemas/ratchet/schema.yaml` plan artifact `instruction`: insert a
  `**## Non-goals**` bullet between the `**## What Changes**` and
  `**## Design**` bullets carrying the same traceability rule and one-liner
  allowance, and extend the `**## Design**` bullet to require the
  `**### Approaches considered**` subsection with "one sensible way" allowed.
  The payload surfaced by `ratchet instructions plan` changes by this edit
  alone — no CLI code changes.
- `src/core/templates/workflows/propose.ts` `buildProposeBody` — the single
  body consumed by both the `ratchet-propose` skill template and the `propose`
  command template:
  - the artifact listing line becomes
    `plan.md (## Why, ## What Changes, ## Non-goals, ## Design, ## Tasks)`;
  - step 5a gains one bullet: for a `plan` artifact, keep the template's
    `## Non-goals` section between `## What Changes` and `## Design` (each
    entry traced to a decision the user, an originating issue, or a brainstorm
    made — never an omission you approved on your own — with an explicit
    one-liner when nothing was ruled out) and its `### Approaches considered`
    subsection inside `## Design` ("one sensible way" allowed when there is
    genuinely one sensible approach).
  - The planning-boundary text (the **Planning boundary** paragraph, step 8,
    and the boundary guardrail), the store-seeding bullet, and the
    scope-reconciliation interpolations stay intact — this change adds the
    plan-section guidance only.
- New shared test `test/core/shared/plan-nongoals.test.ts`: template
  assertions over `schemas/ratchet/templates/plan.md` (section presence and
  ordering), instructions-payload assertions over the schema.yaml plan
  instruction wording, a `findPlanNongoalsViolations` predicate over a
  rendered propose body with unit cases rejecting the pre-change shape on
  every dimension, and render loops asserting the predicate holds of the
  propose skill and command rendered for every registered agent. File header
  mirrors `features/plan-nongoals/template-and-propose-guidance.feature`.
- Documents the new plan sections in `docs/configuration/generated-artifacts.md`
  (the change-directory tree line and the `### plan.md` section table) and
  updates `README.md`'s three plan-structure mentions (per the `documentation`
  standard).
- Implements `features/plan-nongoals/template-and-propose-guidance.feature`.

The phase's sibling behaviors are separate batch changes by the approved
decomposition, not part of this one: the validate-on-missing-Non-goals warning
(`validate-nongoals-warning`) and the verify implemented-Non-goal flag
(`verify-nongoal-implementation-flag`), which appends its own verify-body
assertions to the shared test file this change creates.

## Non-goals

- `ratchet validate` warning when a plan lacks `## Non-goals` — decided by the
  approved phase decomposition recorded in
  `.ratchet/batches/upstream-absorption/batch.yaml`: that behavior is the
  sibling change `validate-nongoals-warning` (after: this change).
- Verify reporting an implemented Non-goal — same trace: the sibling change
  `verify-nongoal-implementation-flag` (after: this change) owns the
  verify-body read of `## Non-goals` and its report flag.
- Retrofitting existing or archived plans with the new sections — the
  user-approved batch manifest scopes this change to the template, the schema
  instruction, the propose body, their tests, and their docs; the sibling
  validate change carries the proof that every existing and archived plan
  still validates without retrofitting.

## Design

- **One author of lifecycle text (delegated-lifecycle).** The only
  lifecycle-template edit lands in the shared `buildProposeBody` constant;
  `getRctProposeSkillTemplate` and `getRctProposeCommandTemplate` keep
  consuming that one builder, so the skill and command surfaces cannot drift.
  No engine, CLI, or batch code changes: the schema instruction rides the
  existing `ratchet instructions plan` payload verbatim, and the template is
  served through the same payload's `template` field — guidance reaches the
  agent as payload data and as static skill text, never as a config read
  (instruction-fed-config is conformed to by construction; no new config is
  added, so it is not otherwise engaged).
- **Ecosystem-agnostic default text (generalizable-defaults).** The plan
  template ships into every consuming repository. The new `## Non-goals` and
  `### Approaches considered` placeholder prose names decisions and approaches
  only — no package manager, test runner, build tool, language, command
  string, or tool-specific path — so the shipped default stays
  ecosystem-agnostic.
- **The rule is the same on all three surfaces.** Each surface states the
  identical contract in its own register: the template as bracketed
  placeholder guidance the author replaces; the schema instruction as
  imperative section bullets; the propose body as one step-5a bullet. Target
  template text:
  > `## Non-goals`
  > [What this change deliberately will NOT do. Each entry traces to a
  > decision the user, an originating issue, or a brainstorm made — never an
  > omission the agent approved on its own. When nothing was ruled out, say so
  > explicitly in one line.]
  >
  > `## Design` …
  > `### Approaches considered`
  > [The approaches weighed before settling on the design above, and why each
  > was kept or dropped. "One sensible way" is allowed when there is genuinely
  > one sensible approach — name it and say why.]
- **Traceability aligns with the existing scope guardrails.** The propose
  body's scope-reconciliation guardrail already rules that an "out of scope"
  bullet records a decision the user already made and is never a substitute
  for asking; the Non-goals rule restates that contract for the plan's own
  section — each entry cites its user, issue, or brainstorm source, and the
  nothing-ruled-out one-liner makes the empty case explicit rather than
  absent.
- **Enforcement at the unit layer (testing standard).**
  `test/core/shared/plan-nongoals.test.ts` holds: (a) template assertions —
  read `schemas/ratchet/templates/plan.md` from the repo root and assert
  `## Non-goals` sits between `## What Changes` and `## Design`, and
  `### Approaches considered` sits inside `## Design` before `## Tasks`, plus
  the guidance wording pins (traced entries, never a self-approved omission,
  the one-liner); (b) instructions-payload assertions — read
  `schemas/ratchet/schema.yaml`, collapse whitespace (the YAML literal block
  wraps lines), and pin the plan instruction's `## Non-goals` and
  `### Approaches considered` wording, following the schema-assertion pattern
  in `test/core/shared/lifecycle-honesty.test.ts`; (c) a pure-string
  `findPlanNongoalsViolations(body): string[]` predicate over a rendered
  propose body asserting each dimension: the listing line naming
  `## Non-goals`; the keep-the-section direction with its position; the
  traced-decision rule; the never-self-approved-omission prohibition; the
  explicit one-liner; the `### Approaches considered` subsection inside
  `## Design`; and the "one sensible way" allowance; (d) unit cases feeding
  the predicate the pre-change body shape (the four-section listing, no
  plan-section bullet) and asserting rejection on every dimension, plus one
  well-formed body asserted clean; (e) render loops iterating the propose
  skill template (`getSkillTemplates(['propose'])` / `generateSkillContent`)
  and command template (`getCommandContents(['propose'])` / per-adapter
  `generateCommand`) for each agent in the supported-tools registry
  (`AI_TOOLS`, `CommandAdapterRegistry`), asserting the predicate holds and
  the checked agent set is non-empty and equal to the registry length. No CLI
  behavior changes, so no E2E layer is exercised; the sibling changes own the
  validation-fixture sweep and the verify-body assertions respectively.
- **Per-agent outputs covered (multi-agent-support).** The propose skill
  renders to `<skillsDir>/skills/ratchet-propose/SKILL.md` for every registry
  agent (`.claude`, `.codex`, `.cursor`, `.gemini`, `.github`, `.opencode`);
  the command renders to each adapter's path
  (`.claude/commands/rct/propose.md`, `<CODEX_HOME>/prompts/rct-propose.md`,
  `.cursor/commands/rct-propose.md`, `.gemini/commands/rct-propose.md`,
  `.github/prompts/rct-propose.prompt.md`,
  `.opencode/commands/rct-propose.md`). The render loop iterates the registry,
  so a newly registered agent is covered automatically. The new prose names no
  agent and no agent-specific capability, branches on no agent, and keeps
  cross-workflow references in the canonical `/rct:<name>` form.
- **Verification.** `pnpm vitest run test/core/shared/plan-nongoals.test.ts`
  is green; the two phase proof-of-work greps this change owns
  (`grep -q '## Non-goals' schemas/ratchet/templates/plan.md` and
  `grep -q 'Approaches considered' schemas/ratchet/templates/plan.md`) pass;
  the existing shared suites stay green (notably
  `test/core/shared/lifecycle-honesty.test.ts`, which pins the propose body);
  and per the testing standard the full suite (`pnpm test`) and the coverage
  gate (`pnpm test:coverage`) stay green.

### Approaches considered

- **Template-only** — put the sections in `schemas/ratchet/templates/plan.md`
  and rely on the existing "use `template` as the structure" step. Rejected:
  the schema instruction and the propose body would keep describing the old
  four-section plan, and an author following those texts could strip the new
  sections as boilerplate; the store-seeding guidance precedent landed on the
  same three surfaces for the same reason.
- **Template + schema instruction + propose body (chosen).** All three
  authoring surfaces carry the same rule, so the sections survive both
  payload-driven and skill-driven authoring, pinned by template,
  instructions-payload, and per-agent rendered-output assertions.
- **Validator enforcement as an ERROR.** Rejected: the phase goal pins
  warn-never-error for the missing-Non-goals check, and that check is the
  sibling change `validate-nongoals-warning`'s scope — this change is the
  template-and-guidance slice.

## Tasks

- [x] 1.1 Edit `schemas/ratchet/templates/plan.md`: insert a default
  `## Non-goals` section between `## What Changes` and `## Design` with
  placeholder guidance directing that each entry traces to a decision the
  user, an originating issue, or a brainstorm made — never an omission the
  agent approved on its own — and an explicit one-liner when nothing was
  ruled out; insert a `### Approaches considered` subsection inside
  `## Design`, before `## Tasks`, naming the approaches weighed and allowing
  "one sensible way" when there is genuinely one sensible approach (features:
  `plan-nongoals/template-and-propose-guidance.feature`)
- [x] 1.2 Edit the plan artifact `instruction` in
  `schemas/ratchet/schema.yaml`: insert a `**## Non-goals**` bullet between
  the `**## What Changes**` and `**## Design**` bullets carrying the same
  traceability rule (user / originating issue / brainstorm, never a
  self-approved omission) and the explicit nothing-ruled-out one-liner, and
  extend the `**## Design**` bullet to require the
  `**### Approaches considered**` subsection with "one sensible way" allowed;
  keep the remaining instruction text (task-format rules, example) intact
- [x] 1.3 Edit `buildProposeBody` in `src/core/templates/workflows/propose.ts`:
  change the artifact listing line to
  `plan.md (## Why, ## What Changes, ## Non-goals, ## Design, ## Tasks)` and
  add one step-5a bullet directing that for a `plan` artifact the author keeps
  the template's `## Non-goals` section between `## What Changes` and
  `## Design` (each entry traced to a decision the user, an originating issue,
  or a brainstorm made — never an omission you approved on your own — with an
  explicit one-liner when nothing was ruled out) and its
  `### Approaches considered` subsection inside `## Design` ("one sensible
  way" allowed when there is genuinely one sensible approach); keep the
  planning-boundary text, the store-seeding bullet, and the
  scope-reconciliation interpolations intact
- [x] 2.1 Create `test/core/shared/plan-nongoals.test.ts` (file header mirrors
  `features/plan-nongoals/template-and-propose-guidance.feature`): template
  assertions over `schemas/ratchet/templates/plan.md` (presence and ordering
  of `## Non-goals` between `## What Changes` and `## Design`, and of
  `### Approaches considered` inside `## Design` before `## Tasks`, plus the
  guidance-wording pins); instructions-payload assertions over the
  whitespace-collapsed `schemas/ratchet/schema.yaml` plan instruction;
  the pure-string `findPlanNongoalsViolations` predicate; unit cases asserting
  the predicate rejects the pre-change body shape (four-section listing, no
  plan-section bullet) on every dimension and accepts a well-formed body; and
  render loops over the propose skill and command templates for every
  registered agent asserting the predicate holds, with the checked agent set
  non-empty and equal to the registry length
- [x] 2.2 Run `pnpm vitest run test/core/shared/plan-nongoals.test.ts
  test/core/shared/lifecycle-honesty.test.ts` plus the two phase
  proof-of-work greps this change owns
  (`grep -q '## Non-goals' schemas/ratchet/templates/plan.md` and
  `grep -q 'Approaches considered' schemas/ratchet/templates/plan.md`); per
  the testing standard also run the full suite (`pnpm test`) and the coverage
  gate (`pnpm test:coverage`); all must be green
- [x] 3.1 Documentation (per the `documentation` standard): update
  `docs/configuration/generated-artifacts.md` — the change-directory tree
  comment for `plan.md`
  (`## Why / ## What Changes / ## Non-goals / ## Design / ## Tasks`) and the
  `### plan.md` entry (five top-level sections; add a `## Non-goals` row
  describing the traced-decision rule and the one-liner, and record the
  `### Approaches considered` subsection inside `## Design` with "one
  sensible way" allowed) — and update `README.md`'s three plan-structure
  mentions (the artifacts tree line, the `**plan.md**` bullet, and the
  `(Why / What Changes / Design / Tasks)` comment in the workflow snippet).
  No new Mermaid diagram: the change alters a document structure, not a flow
  or component, and the standard reserves diagrams for those; the existing
  diagrams (propose skill loop, change-directory tree is not a diagram)
  stay accurate unchanged
