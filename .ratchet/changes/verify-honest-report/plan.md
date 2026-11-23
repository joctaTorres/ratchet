# verify-honest-report

## Why

The verify workflow can claim more than it proved: a scenario with no
implementation and no test is only a WARNING, a check that could not run is
silently scored as passing, the Correctness heuristic blesses "reasonable
inference" as evidence, and verify never runs the project's own tests. Absorb
OpenSpec 2.0.0's "Not verified" reporting and superpowers' evidence-before-
claims law (7.0.2), restated in ratchet terms with the batch-approved
sharpening: an uncovered scenario is CRITICAL, and test evidence means a fresh
run of the project's own discovered test command.

## What Changes

- Rewrite the `VERIFY_BODY` constant in
  `src/core/templates/workflows/verify-change.ts` (the single body consumed by
  both the skill and the command template):
  - Step "Verify Correctness": a scenario with no implementation and no test
    becomes a CRITICAL issue ("Scenario not covered: <name>"), no longer a
    WARNING; the report's CRITICAL priority list names it.
  - New "Not verified" reporting: any applicable check that could not run
    (evidence missing or unusable — artifacts unreadable, search inconclusive,
    test command undiscoverable or unrunnable) is reported "Not verified" with
    the reason, is never scored as passing, and blocks "Ready for archive";
    the final assessment names every "Not verified" check and its reason
    instead of claiming readiness.
  - New step before report generation: discover the project's own test command
    from the project itself (its package manifest test script, a Makefile test
    target, CI configuration — whatever the project already declares), run it
    fresh, and cite the exact command and fresh result in the report; no new
    ratchet configuration is introduced. An undiscoverable/unrunnable command
    is "Not verified"; a failing run is CRITICAL.
  - Verification Heuristics: state that reasonable inference no longer counts
    as test evidence — test evidence means a fresh run of the project's own
    test command.
  - `@holdout` handling (the step-3 count-only non-blocking WARNING and the
    step-7 note) is byte-for-byte unchanged.
- Add `test/core/shared/lifecycle-honesty.test.ts` pinning every guardrail
  above on every registered agent's rendered verify skill and command output,
  plus unit cases proving the assertions reject the pre-change body shape.
- Documents the new report rules in `docs/commands/verify.md`: a new lead
  `## Overview` section whose first artifact is a Mermaid `flowchart TD` of
  the verify flow (per the `documentation` standard's Overview rule), plus a
  Reference-style "Verify report honesty" section. `README.md` is unchanged.
- Implements `features/verify-report-honesty/honest-verdicts.feature` and
  `features/lifecycle-honesty/verify-rendered-output.feature`.

## Design

- **One author of lifecycle text (delegated-lifecycle).** Every edit lands in
  the shared `VERIFY_BODY` constant in `src/core/templates/workflows/`;
  `getVerifyChangeSkillTemplate` and `getRctVerifyCommandTemplate` keep
  consuming that one constant, so skill and command cannot drift. No CLI,
  engine, or schema changes.
- **Ecosystem-agnostic test-command discovery (generalizable-defaults,
  instruction-fed-config).** The shipped text instructs the agent to discover
  the test command from the consuming project's own declarations (package
  manifest scripts, Makefile, CI config) and never names ratchet's own
  toolchain; no new config key is added and no skill reads config — discovery
  is agent-performed at invocation time. If nothing can be discovered, that
  check is "Not verified (no test command discovered)", which blocks readiness
  rather than passing silently.
- **"Not verified" model, kept thinner than upstream.** OpenSpec 2.0.0
  distinguishes "Not applicable" (schema-optional artifacts, `skip_specs`) from
  "Not verified"; ratchet's fixed schema has no optional verify inputs (the
  workspace-planning stop at step 2 already covers the one unsupported mode),
  so this change adopts only the "Not verified" half: applicable-but-unrun is
  reported with a reason, never scored as passing, and the final assessment
  prints readiness only when every applicable check ran and no CRITICAL issues
  remain. Archive retains its own checks; this change does not touch them.
- **Severity split stays deliberate.** "No implementation and no test" is
  CRITICAL (batch-approved sharpening beyond upstream, which keeps it a
  WARNING); "implemented but divergence suspected" remains a WARNING; the
  false-positive ladder (SUGGESTION < WARNING < CRITICAL) is otherwise
  untouched.
- **Enforcement at the unit layer (testing standard).**
  `test/core/shared/lifecycle-honesty.test.ts` mirrors
  `agent-neutral-rendered-output.test.ts`: pure string predicates over a
  rendered body plus a render loop — every verify skill template
  (`getSkillTemplates`/`generateSkillContent`) and command template
  (`getCommandContents`/per-adapter `generateCommand`) for each agent in the
  supported-tools registry (`AI_TOOLS`, `CommandAdapterRegistry`) — asserting
  each guardrail is present and the checked agent set is non-empty and equal
  to the registry length; unit cases feed the predicates the pre-change body
  shape (uncovered scenario as WARNING, "reasonable inference" as evidence, no
  "Not verified") and assert rejection. The file header names both `.feature`
  files. This is the shared phase file: `open-pr-tested-push` appends its own
  assertions to it later; this change creates it with the verify slice only.
- **Per-agent outputs covered (multi-agent-support).** The verify skill renders
  to `<skillsDir>/skills/ratchet-verify-change/SKILL.md` for every registry
  agent (`.claude`, `.codex`, `.cursor`, `.gemini`, `.github`, `.opencode`);
  the command renders to each adapter's path (`.claude/commands/rct/verify.md`,
  `<CODEX_HOME>/prompts/rct-verify.md`, `.cursor/commands/rct-verify.md`,
  `.gemini/commands/rct-verify.md`, `.github/prompts/rct-verify.prompt.md`,
  `.opencode/commands/rct/verify.md`). The render loop iterates the registry,
  so a newly registered agent is covered automatically. New template prose
  adds no agent-specific capability mentions, so the capability-plus-fallback
  rule is untouched; cross-workflow references stay in the canonical
  `/rct:<name>` form.
- **Verification.** `pnpm vitest run test/core/shared/lifecycle-honesty.test.ts`
  is green; the verify half of the phase proof-of-work
  (`grep -q 'Not verified' src/core/templates/workflows/verify-change.ts`)
  matches; and per the testing standard the full suite (`pnpm test`) and the
  coverage gate (`pnpm test:coverage`) stay green.

## Tasks

- [x] 1.1 In `src/core/templates/workflows/verify-change.ts` `VERIFY_BODY`,
  make a scenario with no implementation and no test a CRITICAL issue in step
  7 (replacing the "Scenario not covered" WARNING), and add it to the
  report's CRITICAL priority list (features:
  `verify-report-honesty/honest-verdicts.feature`)
- [x] 1.2 Add "Not verified" reporting to `VERIFY_BODY`: report-structure
  rule that any applicable check that could not run is reported "Not verified"
  with the reason and never scored as passing; final-assessment gating so
  "Ready for archive" (both the all-clear and the with-warnings forms)
  requires every applicable check to have run, and any "Not verified" check
  produces the non-readiness assessment naming each such check and its reason
- [x] 1.3 Add the fresh-test-evidence step to `VERIFY_BODY` (before report
  generation): discover the project's own test command from the project (no
  new ratchet configuration, no hardcoded toolchain), run it fresh, cite the
  exact command and result in the report; undiscoverable/unrunnable → "Not
  verified", failing → CRITICAL; and rewrite the Correctness heuristic to
  state that reasonable inference no longer counts as test evidence
- [x] 1.4 Confirm the `@holdout` text (step-3 warning, step-7 note) is
  byte-for-byte unchanged: the verify-change.ts diff contains no holdout
  hunks
- [x] 2.1 Add `test/core/shared/lifecycle-honesty.test.ts` (header naming
  `verify-report-honesty/honest-verdicts.feature` and
  `lifecycle-honesty/verify-rendered-output.feature`): pure predicates over a
  rendered verify body for each guardrail (uncovered-scenario CRITICAL and the
  WARNING form gone; "Not verified" reported, never scored as passing, gating
  readiness; discovered-test-command run with fresh result cited; inference
  not test evidence; @holdout warning still non-blocking and count-only), a
  render loop over every verify skill and command template for every
  registered agent asserting the predicates hold and the checked agent set is
  non-empty and equal to the registry length, and unit cases asserting the
  predicates reject the pre-change body shape
- [x] 2.2 Run `pnpm vitest run test/core/shared/lifecycle-honesty.test.ts` and
  `grep -q 'Not verified' src/core/templates/workflows/verify-change.ts`;
  both must pass. Per the testing standard, also run the full suite
  (`pnpm test`) and the coverage gate (`pnpm test:coverage`); both must be
  green
- [x] 3.1 Documentation (per the `documentation` standard, including its
  Overview rule): `docs/commands/verify.md` currently has no Overview and no
  Mermaid diagram, and verify is the core pre-archive gate whose report flow
  this change alters.
  - Add an `## Overview` section as the lead of `docs/commands/verify.md`
    whose first artifact is one valid Mermaid `flowchart TD` showing the
    verify flow: load change artifacts; check Completeness, Correctness,
    Coherence; discover and run the project's own test command fresh; then
    the verdict branches — a CRITICAL issue or a "Not verified" check blocks
    "Ready for archive"; every applicable check ran and no CRITICAL issues
    gives "Ready for archive". Every `classDef` must set `color:`, use
    high-contrast fills, and label nodes with semantic Unicode symbols; the
    diagram must match the new `VERIFY_BODY` exactly.
  - Keep the existing sections, and add a Reference-style
    "Verify report honesty" section stating the report rules (uncovered
    scenario is CRITICAL; "Not verified" is never passing and blocks
    readiness; the fresh discovered-test-command citation; inference is not
    test evidence; @holdout warning unchanged) — facts only, matching the
    existing entry's tone.
  - No `README.md` change: the README's verify mentions cover CLI
    preconditions, standards scoping, and generated-artifact paths, none of
    which this change alters
