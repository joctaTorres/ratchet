# batch-command-group-tests

## Why

The `src/commands/batch/` group is the largest remaining under-tested command
surface: of its verbs only `archive.ts` and `shared.ts` carry tests today, while
`apply.ts`, `config.ts`, `new-batch.ts`, `report.ts`, `status.ts`, and `view.ts`
have no direct coverage. These verbs own the batch lifecycle a user drives —
scaffolding a manifest, resolving settings, reporting progress and halts,
rendering status, and stepping the bundled engine — and each carries
fail-fast / no-spawn / no-secret-leak guarantees worth pinning down. With the
`testing` standard now codified, this change covers the six untested batch verbs
following that standard and keeps the full suite green, advancing the
`command-groups-coverage` phase.

## What Changes

- Add a shared batch fixture helper for `test/commands/batch/` that builds an
  isolated repo under `fs.mkdtemp(os.tmpdir())`, writes only the minimal
  `.ratchet/batches/<name>/batch.yaml` manifest and `.ratchet/changes/<change>/`
  tree each scenario exercises, and tears it down in `afterEach`.
- Add integration tests for the six untested batch verbs under
  `test/commands/batch/`, each following the `testing` standard
  (right-thing-at-the-right-layer, fixture isolation, `.feature` traceability in
  the header):
  - `test/commands/batch/apply.test.ts` — implements
    `features/batch-command-tests/apply.feature`.
  - `test/commands/batch/config.test.ts` — implements
    `features/batch-command-tests/config.feature`.
  - `test/commands/batch/new-batch.test.ts` — implements
    `features/batch-command-tests/new-batch.feature`.
  - `test/commands/batch/report.test.ts` — implements
    `features/batch-command-tests/report.feature`.
  - `test/commands/batch/status.test.ts` — implements
    `features/batch-command-tests/status.feature`.
  - `test/commands/batch/view.test.ts` — implements
    `features/batch-command-tests/view.feature`.
- Cover each verb's main behaviors plus its key error/edge paths: step
  selection / halt-respect / outcome-persist with no real spawn (apply),
  resolve / get / set with secret redaction and no-op-on-invalid (config),
  name-validation / clobber-refusal / stamped-manifest (new-batch), the
  single-report-kind journal/park channel (report), and the derived text /
  `--json` rendering of status and view/list.
- No production behavior changes — this change ships tests only. Per the
  `testing` standard this still counts as a change "not done until its tests
  are"; because it adds no user-facing surface, the `documentation` standard
  does not apply and no documentation task is required.

## Design

**Layer (per the `testing` standard).** The batch verbs are command wiring, so
they get **integration** tests over a tmpdir fixture repo — every real piece is
wired (manifest load, settings resolution, derived status, journal/park state)
except the one piece a test must not run: the agent spawn. Each verb resolves its
project root through `resolveCurrentPlanningHomeSync()`; tests mock that module to
return the fixture root, exactly as the existing `test/commands/batch/archive.test.ts`
does. The verbs' own logic then runs unmocked over the fixture.

**Per-verb seams.**

- `apply.ts` constructs `RatchetBatchEngine` in-process. The engine module
  (`src/core/batch/engine/index.js`) is mocked so `runStep` returns a canned
  `StepResult`; happy-path scenarios assert the verb forced exactly one step and
  persisted/cleared the parked state, while the nothing-ready and parked-step
  precheck scenarios assert the verb returns *before* the engine is invoked (a
  fake `runStep` asserted never-called is the no-spawn proof).
- `config.ts`, `report.ts`, `new-batch.ts`, `status.ts`, `view.ts` need no
  engine: their behavior is pure verb logic over the fixture's manifest, project
  config, journal, and change state. `config` and `report` assert on the
  filesystem effects they cause (project-config writes, journal/park entries) and
  on rendered output; `status`/`view` assert on the derived text and `--json`
  shapes. The secret-redaction scenarios assert no `authToken` value reaches
  stdout.

**Fixture isolation (per the `testing` standard).** A shared helper builds an
isolated repo under `fs.mkdtemp(os.tmpdir())`, writes only the minimal
`.ratchet/batches/<name>/batch.yaml` and `.ratchet/changes/<change>/` tree each
scenario exercises (reusing the change-tree builders already in
`test/commands/change-fixture.ts` for done/ready change state, plus the batch
`journal.js`/`parkStep` seams for parked state), and removes it in `afterEach`.
Tests depend on no real repo state, on each other, or on execution order, and
leave nothing behind. Each test file names its corresponding `.feature` in the
header for traceability, matching `test/commands/batch/archive.test.ts` and the
conventions in `test/core/`.

**Done bar.** The six new test files exercise the verbs' main behaviors plus key
error/edge paths, and the full vitest suite stays green. The phase's enforced
coverage-floor lift to ~80 is owned by the separate `ratchet-floor-to-80` change;
this change's contribution is the batch-group coverage and a green suite.

## Tasks

- [x] 1.1 Add a shared batch fixture helper under `test/commands/batch/` that
  builds an isolated `.ratchet/batches/<name>/batch.yaml` manifest plus the
  `.ratchet/changes/<change>/` trees a scenario needs under
  `fs.mkdtemp(os.tmpdir())`, exposes seams for parked/journal state, and tears
  the repo down in `afterEach` (no real-repo dependence, order-independent), per
  the `testing` standard.
- [x] 2.1 Write `test/commands/batch/apply.test.ts` implementing `apply.feature`:
  nothing-ready, parked-blocked and parked-awaiting-approval no-advance (engine
  never invoked), ready-step single advance with parked-state cleared, engine
  blocked-result parks the step, and `--json` structured output — with the
  bundled engine mocked so no real agent spawns.
- [x] 2.2 Write `test/commands/batch/config.test.ts` implementing
  `config.feature`: project resolve with source annotation, named-batch manifest
  override, unknown-name error, malformed `--set` rejection, invalid-`--set`
  no-op (file unchanged), valid `--set` write, secret never echoed, and `--json`
  authToken redaction.
- [x] 2.3 Write `test/commands/batch/new-batch.test.ts` implementing
  `new-batch.feature`: missing-name and non-kebab-case rejection, stamped-manifest
  scaffold, existing-batch clobber refusal (file unchanged), and `--json` output.
- [x] 2.4 Write `test/commands/batch/report.test.ts` implementing `report.feature`:
  missing-`--change` and zero/multiple report-kind rejection, and each report
  kind (status, blocker, needs-input, complete, complete-awaiting-approval,
  answer, reject) writing the right journal/park state and message.
- [x] 2.5 Write `test/commands/batch/status.test.ts` implementing `status.feature`:
  empty-batch text, phases/symbols/next-step text, parked-blocker surfacing, and
  the `--json` shape (name, status, gate, per-change done/progress/blocked).
- [x] 2.6 Write `test/commands/batch/view.test.ts` implementing `view.feature`:
  empty-batch guidance, single-batch dashboard with progress and next step,
  parked-halt surfacing, `view --json` full status, and `list` (none-found,
  one-row-per-batch, `--json` summary rows).
- [x] 3.1 Run `pnpm build && pnpm vitest run --coverage` and confirm the full
  suite is green with the new batch-group tests included.
