# workflow-command-group-tests

## Why

The `commands/workflow/` group is the most under-tested command group in the
repo: `new-change.ts`, `status.ts`, and `shared.ts` have no direct tests, and
`instructions.ts` is only partially covered (one test pins standards handling).
The `testing` standard holds the suite to a 95% line floor with a phase-by-phase
ratchet of the enforced `COVERAGE_THRESHOLD`; covering this group lets the gate
rise from 72 toward ~80 without lowering the bar.

## What Changes

- Add integration tests for `newChangeCommand` (`src/commands/workflow/new-change.ts`)
  covering create, `--json` payload, README-from-description, and the
  missing-name / invalid-name / unknown-schema error paths — see
  `features/workflow-command-tests/new-change.feature`.
- Add integration tests for `statusCommand` and `printStatusText`
  (`src/commands/workflow/status.ts`) covering the no-changes state, the
  no-changes `--json` payload, the missing-`--change` error, and artifact
  progress rendering — see `features/workflow-command-tests/status.feature`.
- Add unit/integration tests for the shared helpers
  (`src/commands/workflow/shared.ts`): `getAvailableChanges`,
  `validateChangeExists`, `validateSchemaExists`, and the
  `getStatusIndicator` / `getStatusColor` rendering under `NO_COLOR` — see
  `features/workflow-command-tests/shared.feature`.
- Extend `instructions.ts` coverage to the remaining untested paths:
  `instructionsCommand` (ready artifact JSON, missing-argument, unknown-artifact,
  blocked warning), the `blocked` / `all_done` branches of
  `generateApplyInstructions`, `applyInstructionsCommand` (apply JSON), and
  `printApplyInstructionsText` — see
  `features/workflow-command-tests/instructions.feature`.
- Raise the enforced coverage floor: bump `COVERAGE_THRESHOLD` in the CI
  coverage gate from 72 to ~80 (ratchet up, never down).

## Design

This is a tests-only change. It follows the `testing` standard and adds no
user-facing behavior, so it carries no documentation task (the documentation
standard is scoped to user-facing surfaces).

**Pyramid placement.** Per the standard, "command verbs (`src/commands/`) get
integration tests that wire the real pieces together over a tmpdir fixture
repo." All four files under test are command verbs, so these are **integration**
tests under `test/commands/workflow/`, mirroring the precedent already set by
`test/commands/batch/`. The pure rendering helpers in `shared.ts`
(`getStatusIndicator`, `getStatusColor`) are exercised as unit assertions within
the same file (deterministic functions over in-memory inputs, no filesystem).

**Fixture isolation.** Every test that touches the filesystem builds an isolated
repo via `fs.mkdtemp(os.tmpdir())`, writes only the minimal `.ratchet/` tree it
exercises, and removes it in `afterEach` — reusing the existing
`test/commands/change-fixture.ts` `CommandFixture` / `makeCommandFixture` helper
rather than introducing a parallel builder. Tests must not depend on the real
repo, on each other, or on execution order, and must leave nothing behind.

**Planning-home seam.** The workflow verbs resolve their project root through
`resolveCurrentPlanningHomeSync()`. Tests that drive the command entrypoints
(`newChangeCommand`, `statusCommand`, `instructionsCommand`,
`applyInstructionsCommand`) mock that function to return the fixture root, the
same seam `test/commands/batch/` uses. Helper-level tests
(`getAvailableChanges`, `validateChangeExists`, `validateSchemaExists`,
`generateApplyInstructions`, `printApplyInstructionsText`) call the functions
directly with the fixture root, no mock needed. `console.log` is spied to capture
output and restored in `afterEach`.

**Traceability.** Each test file names the `.feature` it implements in its header
comment, per the standard ("mirror the `.feature` in the test header"), matching
the conventions in `test/commands/batch/` and `test/core/`.

**Coverage ratchet.** The enforced threshold is raised only after the new tests
land green, so the gate climbs with real coverage and is never lowered. The exact
final value (~80) is set to the floor the suite actually clears after these tests
are added; the phase proof runs the gate at `COVERAGE_THRESHOLD=80`.

## Tasks

- [x] 1.1 Add `test/commands/workflow/new-change.test.ts`: integration tests for
  `newChangeCommand` create, `--json` payload, README-from-description, and the
  missing-name / invalid-name / unknown-schema error paths, over a
  `makeCommandFixture` tmpdir with `resolveCurrentPlanningHomeSync` mocked; header
  names `new-change.feature`.
- [x] 1.2 Add `test/commands/workflow/status.test.ts`: integration tests for
  `statusCommand` no-changes (text + `--json`), missing-`--change` error, and
  artifact-progress rendering, plus a direct `printStatusText` assertion over a
  status with done/ready/blocked artifacts; header names `status.feature`.
- [x] 1.3 Add `test/commands/workflow/shared.test.ts`: unit/integration tests for
  `getAvailableChanges` (excludes archive/hidden, empty when absent),
  `validateChangeExists` (accepts existing, rejects missing/unknown/traversal
  names), `validateSchemaExists` (unknown schema), and the `getStatusIndicator` /
  `getStatusColor` helpers under `NO_COLOR`; header names `shared.feature`.
- [x] 1.4 Add `test/commands/workflow/instructions.test.ts`: integration tests for
  `instructionsCommand` (ready artifact JSON, missing-argument, unknown-artifact,
  blocked warning), the `blocked` / `all_done` branches of
  `generateApplyInstructions`, `applyInstructionsCommand` (apply JSON), and
  `printApplyInstructionsText` (blocked banner + progress + tasks); header names
  `instructions.feature`.
- [x] 2.1 Run `pnpm build && pnpm vitest run --coverage`; confirm the full suite
  is green and read the coverage summary for the workflow group.
- [x] 2.2 Raise `COVERAGE_THRESHOLD` in the CI coverage gate from 72 to 78
  (to the floor the suite now clears, never lowered — the 78→80 step is owned by
  the gated `ratchet-floor-to-80` change after the eval group lands) and confirm
  `node dist/core/ci/coverage-gate.js` exits zero at the new default.
