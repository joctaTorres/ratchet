# eval-command-group-tests

## Why

The `commands/eval/` group is the last under-tested command group in the repo:
`baseline.ts`, `record.ts`, `report.ts`, `run.ts`, `set.ts`, and `shared.ts`
have no direct tests. The eval *core* (`src/core/eval/`) is well covered and a
thin `test/cli-e2e/eval.test.ts` drives the built CLI, but the command-verb
wiring itself — flag validation, scope/judge resolution, JSON vs text rendering,
and the error paths — is unproven at the integration layer. The `testing`
standard places command verbs at the integration layer over a tmpdir fixture
repo; covering this group is the third and final command-group lift of the
`command-groups-coverage` phase.

## What Changes

- Add integration tests for the shared helpers
  (`src/commands/eval/shared.ts`): `resolveScope` (store default, `--change`,
  `--path`, `--changes`, and the mutually-exclusive-flags error) and
  `resolveJudgeMode` (explicit valid flag wins, invalid flag rejected, project
  config default, `auto` fallback) — see
  `features/eval-command-tests/shared.feature`.
- Add integration tests for `evalSetCommand` (`src/commands/eval/set.ts`)
  covering the `--json` payload (scope, count, per-case fields), the text
  rendering of bound/`[unbound]` tags, and the mutually-exclusive scope error —
  see `features/eval-command-tests/set.feature`.
- Add integration tests for `evalRunCommand` (`src/commands/eval/run.ts`) over an
  unbound-case fixture: the persisted run + incomplete/unjudged text scorecard,
  the `--json` `{ runId, scorecard, warnings }` payload, and the invalid-`--judge`
  error path — see `features/eval-command-tests/run.feature`. No real agent is
  spawned.
- Add integration tests for `evalRecordCommand` (`src/commands/eval/record.ts`):
  the happy path (manual verdict recorded, `source: 'manual'`), the `--json`
  payload, the missing-`--run` / missing-`--case` / missing-`--verdict` errors,
  and the fail-without-evidence rejection that leaves the run unchanged — see
  `features/eval-command-tests/record.feature`.
- Add integration tests for `evalReportCommand` (`src/commands/eval/report.ts`)
  exercising `renderReport`: `--json` full report, clean text scorecard,
  regressions-first ordering with evidence, the incomplete notice, the
  new/retired baseline diff lines, and the missing-`--run` error — see
  `features/eval-command-tests/report.feature`.
- Add integration tests for `evalBaselineCommand`
  (`src/commands/eval/baseline.ts`): promotion writes
  `.ratchet/evals/baseline.json`, the `--json` payload, and the missing-`<run-id>`
  error — see `features/eval-command-tests/baseline.feature`.

## Design

This is a tests-only change. It follows the `testing` standard and adds no
user-facing behavior, so it carries no documentation task (the documentation
standard is scoped to user-facing surfaces).

**Pyramid placement.** Per the standard, "command verbs (`src/commands/`) get
integration tests that wire the real pieces together over a tmpdir fixture
repo." All six files under test are command verbs (or their shared helpers), so
these are **integration** tests under `test/commands/eval/`, mirroring the
precedent already set by `test/commands/batch/` and `test/commands/workflow/`.
Pure helpers in `shared.ts` (`resolveScope`, `resolveJudgeMode`) are exercised
as direct assertions within the same group; they read the filesystem only via
`readProjectConfig`, so the judge-default case writes a minimal config into the
fixture rather than mocking.

**Fixture isolation.** Every test that touches the filesystem builds an isolated
repo via `fs.mkdtemp(os.tmpdir())`, writes only the minimal `.ratchet/` tree it
exercises (a feature-store `.feature`, an eval `specs/*.yaml` binding, and/or a
persisted run under `.ratchet/evals/runs/`), and removes it in `afterEach`.
Tests must not depend on the real repo, on each other, or on execution order,
and must leave nothing behind. Where the existing `test/commands/change-fixture.ts`
`makeCommandFixture` helper fits it is reused; eval-specific scaffolding
(feature/spec/run writers, mirroring the `prepareProject` helper in
`test/cli-e2e/eval.test.ts`) is added as small local helpers in the eval test
files rather than bloating the shared fixture.

**Planning-home seam.** The eval verbs resolve their project root through
`projectRoot()` → `resolveCurrentPlanningHomeSync().root`. Tests that drive the
command entrypoints (`evalSetCommand`, `evalRunCommand`, `evalRecordCommand`,
`evalReportCommand`, `evalBaselineCommand`) mock `resolveCurrentPlanningHomeSync`
to return the fixture root via `vi.hoisted` + `vi.mock`, the same seam
`test/commands/workflow/` and `test/commands/batch/` use. Helper-level tests
(`resolveScope`, `resolveJudgeMode`) call the functions directly with the fixture
root, no mock needed. `console.log` is spied to capture output and restored in
`afterEach`.

**Determinism / no agent spawn.** `evalRunCommand` is exercised over an
**unbound** case so the engine records `unjudged` without spawning any agent —
the thin end-to-end slice that proves the run/persist/score wiring without the
agent seam (the agent path is already covered by `test/cli-e2e/eval.test.ts` via
`RATCHET_EVAL_AGENT_CMD`). Report/baseline/record tests operate on runs persisted
directly through the core `persistRun` helper so they are independent of the run
verb.

**Traceability.** Each test file names the `.feature` it implements in its header
comment, per the standard ("mirror the `.feature` in the test header"), matching
the conventions in `test/commands/batch/`, `test/commands/workflow/`, and
`test/core/`.

**Scope boundary — no floor bump here.** This change adds tests only and does
**not** touch `COVERAGE_THRESHOLD` / `DEFAULT_COVERAGE_THRESHOLD`. Per the batch
manifest, raising the enforced floor to 80 is owned by the gated
`ratchet-floor-to-80` change, which runs `after` all three command-group
changes land. This change's job is to add the eval-group coverage that change
depends on, and to keep the full vitest suite green.

## Tasks

- [x] 1.1 Add `test/commands/eval/shared.test.ts`: direct tests for
  `resolveScope` (store default, `--change`, `--path`, `--changes`, and the
  mutually-exclusive-flags error) and `resolveJudgeMode` (valid flag wins,
  invalid flag rejected, `eval.judge` config default over a fixture config,
  `auto` fallback); header names `shared.feature`.
- [x] 1.2 Add `test/commands/eval/set.test.ts`: integration tests for
  `evalSetCommand` over a fixture store with a check-bound and an unbound case —
  `--json` payload (scope, count, per-case fields), text bound/`[unbound]`
  rendering, and the mutually-exclusive scope error — with
  `resolveCurrentPlanningHomeSync` mocked and `console.log` spied; header names
  `set.feature`.
- [x] 1.3 Add `test/commands/eval/run.test.ts`: integration tests for
  `evalRunCommand` over an unbound-case fixture — persisted run + incomplete
  unjudged text scorecard, `--json` `{ runId, scorecard, warnings }`, and the
  invalid-`--judge` error (no run persisted) — no agent spawned; header names
  `run.feature`.
- [x] 1.4 Add `test/commands/eval/record.test.ts`: integration tests for
  `evalRecordCommand` — manual pass recorded with `source: 'manual'`, `--json`
  payload, missing-`--run` / missing-`--case` / missing-`--verdict` errors, and
  fail-without-evidence rejection leaving the run unchanged — over a run
  persisted via the core `persistRun` helper; header names `record.feature`.
- [x] 1.5 Add `test/commands/eval/report.test.ts`: integration tests for
  `evalReportCommand` / `renderReport` — `--json` full report, clean text
  scorecard, regressions-first ordering with evidence, the incomplete notice,
  new/retired baseline diff lines, and the missing-`--run` error; header names
  `report.feature`.
- [x] 1.6 Add `test/commands/eval/baseline.test.ts`: integration tests for
  `evalBaselineCommand` — promotion writes `.ratchet/evals/baseline.json`,
  `--json` payload, and the missing-`<run-id>` error; header names
  `baseline.feature`.
- [x] 2.1 Run `pnpm build && pnpm vitest run --coverage`; confirm the full suite
  is green and read the coverage summary for the `commands/eval/` group (every
  eval verb and `shared.ts` covered).
- [x] 2.2 Confirm this change does NOT modify `COVERAGE_THRESHOLD` /
  `DEFAULT_COVERAGE_THRESHOLD` (the 80 floor bump is owned by the gated
  `ratchet-floor-to-80` change) and that `node dist/core/ci/coverage-gate.js`
  still exits zero at the current default.
