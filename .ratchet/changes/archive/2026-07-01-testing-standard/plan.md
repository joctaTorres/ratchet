# testing-standard

## Why

Ratchet has no codified testing strategy: line coverage sits at ~68.67% with the
floor enforced only by a bare `COVERAGE_THRESHOLD` default, and nothing tells a
change author what to test, where, or to what bar. This change authors a
first-class `testing` standard so every later change — and the rest of the
coverage-95 batch — is governed by one explicit, ratchetable testing strategy.

## What Changes

- Add `.ratchet/standards/testing.md`, a new project standard (frontmatter tag
  `testing`) codifying: the test pyramid (unit / integration / E2E), what to
  test where, a **95% minimum line-coverage floor**, and ratchet's fixture and
  end-to-end test patterns. Implements
  `features/testing-standard/standard-library.feature`.
- Ship a Reference page for the standard under `docs/` and update `README.md` to
  mention it, per the `documentation` standard. Implements
  `features/testing-standard/reference-docs.feature`.
- Record `standards: [testing]`-resolution behavior is exercised by validation
  (the standard must validate and surface in `ratchet instructions`).
- Non-goals (separate batch changes): raising the enforced coverage gate
  (`ratchet-coverage-gate`) and writing the commands/ core verb tests
  (`commands-core-verb-tests`). This change only authors the standard + its docs.

## Design

- **Standard file format.** Follow the established shape of the existing
  standards (`documentation.md`, `generalizable-defaults.md`,
  `multi-agent-support.md`): YAML frontmatter with a unique `tag:`, then
  `# Title`, `> Concern:`, `## Intent`, `## Guidelines`, `## Applies to`. The
  `tag` must be `testing` and must not collide with any existing tag — the
  `Validator.validateStandards` path keys on tag uniqueness and reference
  resolution (see `test/core/validation.standards.test.ts`,
  `src/core/standards.ts`).
- **Required content (the strategy).** The Guidelines section must concretely
  state, so the standard is enforceable, not aspirational:
  - The **test pyramid** ratchet follows — many fast unit tests over pure
    logic, fewer integration tests over command/core wiring, a thin E2E layer
    (`test/cli-e2e/`) over the CLI surface.
  - **What to test where** — pure evaluators/policies and utilities get unit
    tests; command verbs and core orchestration get integration tests with
    tmpdir fixtures; user-visible CLI flows get E2E tests.
  - A **95% minimum line-coverage floor** as the standard's coverage bar, with
    the note that the enforced `COVERAGE_THRESHOLD` gate is ratcheted up toward
    it phase by phase (the gate change is a separate change; this standard sets
    the target the gate climbs to).
  - **Fixture pattern** — tests build an isolated repo under
    `fs.mkdtemp(os.tmpdir())`, write the minimal `.ratchet/` tree, and clean up
    in `afterEach`; mirror the corresponding `.feature` in the test header
    (matching the conventions already used across `test/core/`).
  - **E2E pattern** — drive the built CLI end-to-end and assert on observable
    output / exit codes (`test/cli-e2e/`).
- **Toolchain references are in-scope here.** `generalizable-defaults` forbids
  ratchet's own toolchain leaking into *shipped defaults that run in consumer
  repos*. This standard governs **ratchet's own** repository, so naming vitest /
  the `test/` layout is correct and not a leaked default — it is not written
  into any consuming project.
- **Surfacing.** No code change is needed for surfacing: `ratchet instructions`
  loads every file in `.ratchet/standards/` as an active standard
  (`src/core/standards.ts`), so adding `testing.md` makes it appear
  automatically; the plan only needs to verify it does.
- **Documentation (mandatory, per `documentation` standard).** Add a
  Reference page `docs/standards/testing.md` (with a `docs/standards/_category_.json`
  so the standards group renders alongside `commands/` and `engine/`),
  describing the standard factually for lookup, and update `README.md` to
  mention the testing standard and point at the page. The Reference page must
  match the standard's coverage floor, pyramid shape, and patterns exactly.
- **Change metadata.** Set `standards: [testing, documentation]` in this
  change's `.ratchet.yaml` — `documentation` because the change ships docs, and
  `testing` because the change introduces the standard the rest of the batch
  follows. Both tags resolve against `.ratchet/standards/` (the second only
  after `testing.md` is written).

## Tasks

- [x] 1.1 Author `.ratchet/standards/testing.md`: frontmatter `tag: testing`,
  `# Title`, `> Concern: testing`, `## Intent`, `## Guidelines`, `## Applies to`,
  following the existing standards' shape.
- [x] 1.2 In `## Guidelines`, codify the test pyramid (unit/integration/E2E) and
  what-to-test-where so it is concrete and enforceable.
- [x] 1.3 In `## Guidelines`, mandate the 95% minimum line-coverage floor and
  note it is the target the enforced `COVERAGE_THRESHOLD` gate ratchets toward.
- [x] 1.4 In `## Guidelines`, document the fixture pattern (tmpdir isolation,
  `.feature` mirrored in the test header, `afterEach` cleanup) and the E2E
  pattern (`test/cli-e2e/`, assert on output/exit codes).
- [x] 2.1 Validate the standard: run the standards validation path and confirm
  the `testing` tag is unique and reports no errors
  (mirrors `standard-library.feature`).
- [x] 2.2 Confirm the standard is surfaced as an active standard — run
  `ratchet instructions <artifact> --change testing-standard --json` and verify
  the `testing` standard appears with its tag and content.
- [x] 3.1 (documentation standard — mandatory) Add Reference page
  `docs/standards/testing.md` plus `docs/standards/_category_.json`; the page
  must describe the pyramid, the 95% floor, and the fixture/E2E patterns,
  Reference-style and matching the standard exactly
  (implements `reference-docs.feature`).
- [x] 3.2 (documentation standard — mandatory) Update `README.md` to mention the
  testing standard and point to the `docs/standards/testing.md` Reference page.
- [x] 4.1 Set `standards: [testing, documentation]` in
  `.ratchet/changes/testing-standard/.ratchet.yaml`.
