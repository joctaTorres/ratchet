# validate-deep-tests

## Why

`src/commands/validate.ts` measures ~29% line coverage at phase entry — one of the
two largest remaining gaps (with `src/cli/index.ts`) standing between the suite and
the 95% floor. The existing `test/commands/validate.test.ts` covers only four
paths: the non-interactive no-item hint, an unknown item, an ambiguous
change-and-spec name, and a single valid-change happy path. The bulk of the verb is
untested: the entire `runBulkValidation` engine (the `--all/--changes/--specs`
flags, the concurrency-bounded queue, JSON vs text output, the empty-queue early
return, and the per-task error catch), the `runInteractiveSelector` menu and its
routing, batch-manifest validation (`isBatch` + `validateBatch`, including the
`BatchManifestError` and per-phase `BatchDagError` paths), the `--type` override,
the spec/feature-store path, and the full `printReport`/`printNextSteps` reporting
surface for invalid changes and specs.

This change closes that gap by adding integration tests that drive
`ValidateCommand.execute` over an isolated tmpdir fixture across those branches,
lifting `src/commands/validate.ts` coverage substantially per the `testing`
standard. It is tests-only: it does **not** change production behavior and does
**not** touch the coverage gate floor — ratcheting the enforced threshold to 95 is
the separate `ratchet-floor-to-95` change that this and its sibling test-writing
changes feed.

## What Changes

- Extend the `test/commands/` suite with integration tests for the uncovered
  `validate` branches, following the `testing` standard
  (right-thing-at-right-layer, fixture isolation, `.feature` traceability in the
  header). Tests drive the in-process `ValidateCommand.execute(...)` over a tmpdir
  fixture repo — the layer that instruments this file — reusing/extending
  `test/commands/change-fixture.ts` rather than the spawned `test/cli-e2e/` suite.
- Cover the bulk-validation engine, implementing
  `features/validate-deep/bulk-validation.feature`:
  - `--all`, `--changes`, and `--specs` scope selection and the printed
    per-item markers + `Totals:` line;
  - a failing item driving the failed marker and `process.exitCode = 1`;
  - the empty-queue early return in both text (`No items found to validate.`) and
    JSON (zeroed `summary.totals`) modes;
  - JSON mode emitting `items`, `summary.totals`, and `version: "1.0"`;
  - an explicit `--concurrency` bounding the queue while still validating every
    item.
- Cover the interactive selector, implementing
  `features/validate-deep/interactive-selector.feature`: with
  `@inquirer/prompts` `select` stubbed, the `all`/`changes`/`specs` choices route
  into bulk validation, `one` routes into single-item validation, and the
  no-items path prints `No items found to validate.` with exit 1.
- Cover batch validation and the reporting surface, implementing
  `features/validate-deep/batch-and-reporting.feature`: a valid batch manifest
  (text + JSON, `type: "batch"`), a malformed manifest reported with its
  `location` (`BatchManifestError`), a per-phase cycle reported under the phase
  path (`BatchDagError`), an invalid change reported with leveled issue lines +
  change-specific next-steps (text + JSON), the `--type spec` override routing to
  the feature store, and an invalid spec reported with spec-specific next-steps.
- No production behavior changes — this change ships tests only. The coverage gate
  floor is **not** changed here.

## Design

**Layer (per the `testing` standard).** `src/commands/validate.ts` is a command
verb, so it gets an **integration** test that exercises the real verb over a
tmpdir fixture (matching the existing `test/commands/validate.test.ts`). The seam
is the exported `ValidateCommand` class: tests `await new
ValidateCommand().execute(name, options)` so the bulk queue, the interactive
selector, batch validation, and the reporting helpers all run in-process and are
measured. This is deliberately NOT pushed up to E2E: the spawned `test/cli-e2e/`
suite proves the user-facing surface but cannot instrument this file, so the
verb's own branches must be proven one layer down.

**Fixture isolation (per the `testing` standard).** Tests reuse the existing
`test/commands/change-fixture.ts` helper, which builds an isolated repo under
`fs.mkdtemp(os.tmpdir())`, writes only the minimal `.ratchet/` tree each scenario
needs (valid/invalid changes, specs, and batch manifests), and is torn down in
`afterEach`. Each test `process.chdir`s into the fixture (the verb resolves its
project root from `process.cwd()`) and restores the original cwd in `afterEach`;
`console.log`/`console.error` are spied and `process.exitCode` is reset per test,
mirroring the established style. New fixture helpers — for an invalid change, for
specs with invalid feature files, and for valid/malformed/cyclic batch manifests —
are added to `change-fixture.ts` as needed. Tests depend on no real repo state, on
each other, or on execution order, and leave nothing behind.

**Containment seams.** Two side effects of driving the real verb are contained:
- **Interactive prompt** — `runInteractiveSelector` dynamically imports
  `@inquirer/prompts`; the selector scenarios `vi.mock('@inquirer/prompts')` (or
  equivalent) so `select` resolves a scripted choice without real TTY I/O, while
  the bulk/batch scenarios pass `noInteractive: true` to avoid the prompt and the
  `ora` spinner entirely.
- **Spinner** — `runBulkValidation` starts an `ora` spinner unless `json` or
  `noInteractive`; scenarios use `--json`/`noInteractive` so no spinner renders
  during tests.

**Branch targeting.** The scenarios are chosen to hit the specific uncovered
lines: the empty-queue branch (text + JSON), the populated-queue sort/totals, the
JSON serialization in both `printReport` and `validateBatch`, the
`BatchManifestError` (with `location`) and per-phase `BatchDagError` arms, the
`normalizeType` override, the spec/feature-store path, and `printNextSteps` for
both change and spec. The per-task error catch and `getPlannedId/getPlannedType`
helpers are exercised opportunistically where a fixture can force a task rejection.

**Proof / done bar.** The new tests must lift `src/commands/validate.ts` line
coverage substantially above the ~29% entry measurement and keep the full vitest
suite green. The phase integration proof-of-work
(`pnpm build && pnpm vitest run --coverage && COVERAGE_THRESHOLD=95 node dist/core/ci/coverage-gate.js`)
is satisfied collectively by this change and its siblings; for this change in
isolation the bar is: the suite is green and the per-file coverage of
`src/commands/validate.ts` rises substantially (verifiable in the `text` coverage
report row for the file). The gate floor is NOT changed here.

## Tasks

- [x] 1.1 Extend `test/commands/change-fixture.ts` with helpers the new scenarios
  need: an invalid change (broken feature + plan), a spec with invalid feature
  files, and valid/malformed/cyclic batch-manifest writers under the fixture's
  `.ratchet/` tree (fixture-isolated, order-independent, leaves nothing behind).
- [x] 2.1 Add bulk-validation integration tests implementing
  `features/validate-deep/bulk-validation.feature` (name the `.feature` in the
  header): `--all`/`--changes`/`--specs` scope + per-item markers + `Totals:`
  line, a failing item → fail marker + exit 1, the empty-queue early return in
  text and JSON, JSON `items`/`summary.totals`/`version`, and `--concurrency`
  bounding the queue.
- [x] 2.2 Add interactive-selector integration tests implementing
  `features/validate-deep/interactive-selector.feature`: with `@inquirer/prompts`
  `select` stubbed, the `all`/`changes`/`specs`/`one` routing and the no-items
  path (`No items found to validate.`, exit 1).
- [x] 2.3 Add batch-and-reporting integration tests implementing
  `features/validate-deep/batch-and-reporting.feature`: valid batch (text +
  JSON), malformed manifest with `location`, per-phase cycle under the phase path,
  invalid change with next-steps (text + JSON), the `--type spec` override to the
  feature store, and an invalid spec with spec-specific next-steps.
- [x] 3.1 Run `pnpm build && pnpm vitest run --coverage`; confirm the full suite is
  green and the `text` report's `src/commands/validate.ts` row has risen
  substantially above the ~29% entry measurement.
