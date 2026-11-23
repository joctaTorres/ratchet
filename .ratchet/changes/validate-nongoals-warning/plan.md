# validate-nongoals-warning

## Why

The plan template, schema instruction, and propose body now carry a default
`## Non-goals` section (sibling change `plan-template-nongoals-approaches`),
but nothing nudges an author who drops it: `ratchet validate` is silent on a
plan without the section. This change adds a WARNING-level check so the
omission surfaces at validation time without invalidating the many existing
and archived plans that predate the section.

## What Changes

- `src/core/validation/constants.ts`: new `PLAN_NO_NONGOALS` message in
  `VALIDATION_MESSAGES` naming the `## Non-goals` section, directing the
  author to record what the change deliberately will not do, and allowing the
  explicit one-liner that nothing was ruled out.
- `src/core/validation/validator.ts` `validatePlanContent`: after the existing
  plan-section checks, look up the `Non-goals` section via the existing
  `PlanSectionParser`; when the section is absent, push a WARNING issue (path
  `Non-goals`) carrying `PLAN_NO_NONGOALS`. The check never emits ERROR, so
  non-strict validity is unchanged for every plan that validated before.
- New test `test/core/validation.plan-nongoals.test.ts`: in-memory fixtures
  with and without the `## Non-goals` section pinning the WARNING-never-ERROR
  level and the message wording, plus a sweep over every active and archived
  plan in this repository proving the new check adds no ERROR.
- Documents the new plan rule in `docs/commands/validate.md` (per the
  `documentation` standard).
- Implements `features/plan-nongoals/validate-missing-nongoals-warning.feature`.

The phase's sibling behaviors are separate batch changes by the approved
decomposition, not part of this one: the template/instruction/propose-body
sections (`plan-template-nongoals-approaches`, already applied) and the
verify implemented-Non-goal flag (`verify-nongoal-implementation-flag`).

## Non-goals

- ERROR-level enforcement of the section, or any change to strict-mode
  semantics — the user-approved phase goal in
  `.ratchet/batches/upstream-absorption/batch.yaml` pins warn-never-error for
  this check, and `--strict`'s existing warnings-as-failures behavior stays
  untouched.
- Retrofitting existing or archived plans with a `## Non-goals` section — the
  user-approved batch manifest scopes this change to the validator check, its
  tests, and its docs; the plan sweep proves those plans still validate as-is.
- The verify-side flag for an implemented Non-goal — decided by the approved
  phase decomposition: the sibling change `verify-nongoal-implementation-flag`
  (after: `plan-template-nongoals-approaches`) owns the verify-body read of
  `## Non-goals`.
- The plan template, schema instruction, and propose-body guidance for the new
  sections — the sibling change `plan-template-nongoals-approaches` owns them
  and is already applied; this change only makes validation notice their
  absence.

## Design

- **One home for plan rules.** The check rides the existing
  `validatePlanContent` composition in `validator.ts` — the same function that
  owns every other plan-section rule — so every consumer of plan validation
  (`ratchet validate`, and the archive flow's plan gate) surfaces the warning
  with no command-layer change. The message lives in `VALIDATION_MESSAGES` in
  `constants.ts`, like every other plan-rule message, so the test pins the
  constant rather than a duplicated literal.
- **WARNING by construction, and why that is safe.** `createReport` computes
  non-strict validity as `errors === 0`; a WARNING-only issue therefore cannot
  flip a plan from valid to invalid. Strict mode (`--strict`,
  `new Validator(true)`) already fails on any WARNING — pre-existing,
  documented semantics this change neither alters nor relaxes. Plans predating
  the section keep validating in normal mode, which is exactly the batch's
  done criterion.
- **`--strict` behavior stated plainly.** After this change,
  `ratchet validate --strict` fails every plan lacking `## Non-goals`,
  including all pre-section active plans (strict already treats any WARNING
  as a failure, and the new check warns on each of them). No pipeline breaks:
  CI (`.github/workflows/ci.yml`) runs vitest only and never invokes
  `ratchet validate --strict`, and the engine and archive flow construct
  `new Validator()` non-strict — `--strict` is solely an opt-in CLI flag on
  the `validate` command. The sweep test therefore runs non-strict and never
  asserts strict-mode outcomes.
- **Section detection reuses the shared parser.** `PlanSectionParser` (the
  `MarkdownParser` subclass already used for `Why` / `What Changes` /
  `Design` / `Tasks`) looks up `Non-goals`; the check fires only when the
  header is absent. Presence is the whole rule — the phase goal pins a
  missing-section warning, not a content lint, so an empty-looking section or
  its one-liner is never inspected.
- **Fixture + sweep test strategy (testing standard).** Fixtures exercise
  `validatePlanContent` in memory with no filesystem: one plan without
  `## Non-goals` asserts the WARNING level, zero ERRORs, and a valid report;
  one with the section asserts no issue mentions it. The sweep resolves the
  repo root from the test file and iterates every active
  `.ratchet/changes/*/plan.md` (excluding `archive/`) and every archived
  `.ratchet/changes/archive/*/plan.md`, non-strict, asserting both sets are
  non-empty so the sweep cannot pass vacuously. It does NOT assert zero
  ERRORs per plan — two active plans carry pre-existing plan ERRORs on the
  untouched tree (`attributed-failure-surface`, `stage-scope-resolution`:
  Tasks has no checkbox), so that assertion would fail. Instead, per plan it
  asserts no ERROR issue carries the `PLAN_NO_NONGOALS` message, and that
  validity is unchanged from the pre-change result (recomputed with the
  new-check issues removed). Reading the repository's real plans is
  deliberate: it is the proof the batch's done criterion demands, mirroring
  the repo-root reads the shared template tests already use.
- **Ecosystem-neutral surface (generalizable-defaults).** The message and the
  check name only ratchet's own plan format; no package manager, test runner,
  build tool, or toolchain literal ships into a default.
- **Not engaged.** `delegated-lifecycle` (no lifecycle instruction text is
  touched — the validator is machinery, not lifecycle authoring),
  `instruction-fed-config` (no new config and nothing reaches a skill),
  `multi-agent-support` (no agent-facing surface — the warning is CLI output
  identical for every registered agent, so there are no per-agent outputs to
  enumerate), `security-remediation` (not security-relevant).
- **Verification.** `pnpm vitest run test/core/validation.plan-nongoals.test.ts`
  is green alongside the existing validation suites
  (`test/core/validation.features-plan.test.ts`,
  `test/core/validation.standards.test.ts`); per the testing standard the full
  suite (`pnpm test`) and the coverage gate (`pnpm test:coverage`) stay green.
  The phase proof-of-work greps this change does not own are the sibling's;
  the proof's `pnpm vitest run test/core/shared/plan-nongoals.test.ts
  test/core/validation.plan-nongoals.test.ts` half becomes runnable once this
  change's test file exists.

### Approaches considered

- **Validator composition (chosen).** Add the rule inside
  `validatePlanContent` beside the other plan-section checks, with the message
  in `constants.ts` — one code path serves `ratchet validate` and archive's
  plan gate, and the report machinery itself pins the level.
- **A separate plan-lint pass in the validate command.** Rejected: a second
  check site would drift from the validator composition, and archive's plan
  validation would silently miss the warning — the same one-author principle
  the standards apply to lifecycle text applies to validation rules.
- **ERROR level, or WARNING gated behind a grace-period flag.** Rejected: the
  user-approved phase goal pins warn-never-error, and a flag would add new
  config for a one-line advisory.

## Tasks

- [x] 1.1 Add `PLAN_NO_NONGOALS` to `VALIDATION_MESSAGES` in
  `src/core/validation/constants.ts`: the message names the `## Non-goals`
  section, directs recording what the change deliberately will not do, and
  allows stating explicitly that nothing was ruled out (features:
  `plan-nongoals/validate-missing-nongoals-warning.feature`)
- [x] 1.2 In `validatePlanContent` (`src/core/validation/validator.ts`), after
  the existing section checks, look up the `Non-goals` section via
  `PlanSectionParser` and, when absent, push a WARNING issue (path
  `Non-goals`) carrying `PLAN_NO_NONGOALS` — never an ERROR (features:
  `plan-nongoals/validate-missing-nongoals-warning.feature`)
- [x] 2.1 Create `test/core/validation.plan-nongoals.test.ts` (file header
  mirrors `features/plan-nongoals/validate-missing-nongoals-warning.feature`):
  (a) an in-memory fixture without `## Non-goals` asserts a WARNING issue
  carrying the constant message, zero ERRORs, and a valid report; (b) a
  fixture with the section asserts no issue mentions `## Non-goals` and the
  report stays valid; (c) message-wording pins (names `## Non-goals`, the
  deliberately-will-not-do remedy, the nothing-ruled-out one-liner
  allowance); (d) a non-strict sweep over every active
  `.ratchet/changes/*/plan.md` (excluding `archive/`) and every archived
  `.ratchet/changes/archive/*/plan.md`, with both plan sets asserted
  non-empty, asserting per plan: no ERROR issue carries the
  `PLAN_NO_NONGOALS` message (the new check never errors), and the plan's
  validity is unchanged from its pre-change result — recomputed with the
  new-check issues removed, so the active plans carrying pre-existing plan
  ERRORs (`attributed-failure-surface`, `stage-scope-resolution`: Tasks has
  no checkbox) keep their ERRORs and stay invalid exactly as before, and the
  archived set is covered the same way
- [x] 2.2 Run `pnpm vitest run test/core/validation.plan-nongoals.test.ts`
  plus the existing validation suites
  (`test/core/validation.features-plan.test.ts`,
  `test/core/validation.standards.test.ts`); per the testing standard also run
  the full suite (`pnpm test`) and the coverage gate (`pnpm test:coverage`);
  all must be green
- [x] 3.1 Documentation (per the `documentation` standard): update
  `docs/commands/validate.md` — the **Plan** rules list gains the entry
  "`## Non-goals` section present — `WARNING` if absent (plans authored before
  the section existed keep validating; `--strict` treats the warning as a
  failure, so a strict run fails every plan lacking the section, including all
  pre-section active plans — no pipeline impact: CI runs vitest only and the
  engine never passes `--strict`)". No README change: its validate mentions stay at the "check
  Gherkin + plan structure" level and remain accurate. No new Mermaid diagram:
  the change alters a rule level, not a flow or component, and the standard
  reserves diagrams for those
