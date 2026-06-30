# cli-index-tests

## Why

`src/cli/index.ts` is the CLI entrypoint — it wires every command into commander,
applies global flags, runs the preAction telemetry hook, and wraps each verb in a
catch/exit guard. At phase entry it measures ~43% line coverage, one of the two
largest remaining gaps (with `commands/validate.ts`) standing between the suite
and the 95% floor. The reason is structural: the existing `test/cli-e2e/` suite
drives a **spawned** `bin/ratchet.js`, which runs in a separate process and never
instruments this file. This change closes that gap by driving the entrypoint
**in-process** over an isolated fixture, lifting `src/cli/index.ts` coverage
substantially per the `testing` standard. It does **not** touch the coverage gate
floor — ratcheting the enforced threshold to 95 is the separate
`ratchet-floor-to-95` change that this and its sibling test-writing changes feed.

## What Changes

- Add an in-process integration test for the CLI entrypoint under
  `test/cli/index.test.ts`, following the `testing` standard
  (right-thing-at-right-layer, fixture isolation, `.feature` traceability in the
  header). It imports the in-process `program` from `src/cli/index.ts` and drives
  it with `program.parseAsync([...])` over a tmpdir fixture repo — the layer that
  actually instruments this file (unlike the spawned `test/cli-e2e/` suite).
- Cover `src/cli/index.ts`'s own wiring, implementing
  `features/cli-index/dispatch-and-flags.feature`:
  - command dispatch routes a known command (`status --json`) and a grouped
    subcommand (`batch list`) to their verbs over the fixture;
  - flag parsing carries `--json` into the verb and the global `--no-color` flag
    sets `process.env.NO_COLOR` via the preAction hook;
  - the preAction telemetry hook runs and `getCommandPath` resolves the
    colon-joined command path (e.g. `batch:list`);
  - `--version` prints the package version.
- Cover the catch/exit guards, implementing
  `features/cli-index/error-and-exit-paths.feature`:
  - a verb that throws over the fixture is reported via `ora().fail` and the
    action calls `process.exit(1)`;
  - an unknown command and a missing required argument are rejected by commander
    and exit non-zero.
- No production behavior changes — this change ships tests only.

## Design

**Layer (per the `testing` standard).** `src/cli/index.ts` is command wiring, so
it gets an **integration** test that exercises the real entrypoint over a tmpdir
fixture. The seam is the module's own exported `program`: tests
`await program.parseAsync(['node', 'ratchet', ...args])` so the registered
`.action` callbacks, the `preAction`/`postAction` hooks, `getCommandPath`, and the
global-flag handling all run in-process and are measured. This is deliberately
NOT pushed up to E2E: the existing `test/cli-e2e/` spawned suite already proves
the user-facing surface but cannot instrument this file, so the entrypoint's own
lines must be proven one layer down.

**Fixture isolation (per the `testing` standard).** A helper builds an isolated
repo under `fs.mkdtemp(os.tmpdir())`, writes only the minimal `.ratchet/` tree
each scenario needs (a structurally valid project for happy dispatch; an
empty/invalid one for the error path), and removes it in `afterEach`. Commands
resolve their project root from `process.cwd()`, so each scenario `process.chdir`s
into its fixture and restores the original cwd in `afterEach`; tests depend on no
real repo state, on each other, or on execution order, and leave nothing behind.

**Containment seams.** Three side effects of driving the real entrypoint are
contained so the test stays isolated and does not terminate the runner:
- **Telemetry** — the `preAction` hook calls `maybeShowTelemetryNotice` +
  `trackCommand`; the suite sets `RATCHET_TELEMETRY=0` (the documented opt-out) so
  the hook is still exercised but performs no I/O.
- **`process.exit`** — the action catch blocks (and commander's own
  version/unknown-command/missing-argument exits) call `process.exit`; the suite
  `vi.spyOn(process, 'exit')` and throws a sentinel, asserting the code (`1` for
  verb errors, non-zero for commander) instead of killing vitest.
- **Singleton `program` state** — `program` is a module-level singleton, so each
  scenario imports a fresh module via `vi.resetModules()` + dynamic
  `import('../../src/cli/index.js')` (or an equivalent reset) to avoid commander
  option state leaking across scenarios.

**Proof / done bar.** The new test must lift `src/cli/index.ts` line coverage
substantially above the ~43% entry measurement and keep the full vitest suite
green. The phase integration proof-of-work
(`pnpm build && pnpm vitest run --coverage && COVERAGE_THRESHOLD=95 node dist/core/ci/coverage-gate.js`)
is satisfied collectively by this change and its siblings; for this change in
isolation the bar is: the suite is green and the per-file coverage of
`src/cli/index.ts` rises substantially (verifiable in the `text` coverage report
row for the file). The gate floor is NOT changed here.

## Tasks

- [x] 1.1 Add a tmpdir fixture helper for `test/cli/` that builds an isolated
  `.ratchet/` project tree under `fs.mkdtemp(os.tmpdir())`, chdirs into it, and
  tears it down + restores cwd in `afterEach` (no real-repo dependence,
  order-independent).
- [x] 1.2 Establish the entrypoint driving harness: set `RATCHET_TELEMETRY=0`,
  `vi.spyOn(process, 'exit')` to throw a sentinel, and load a fresh `program` per
  scenario via `vi.resetModules()` + dynamic import of `src/cli/index.ts`.
- [x] 2.1 Write `test/cli/index.test.ts` implementing
  `features/cli-index/dispatch-and-flags.feature` (name the `.feature` in the
  header): known-command dispatch (`status --json`) and grouped-subcommand
  dispatch (`batch list`) over the fixture, `--json` routed into the verb, global
  `--no-color` setting `process.env.NO_COLOR`, `getCommandPath` resolving the
  colon-joined path, and `--version` printing the package version.
- [x] 2.2 Extend `test/cli/index.test.ts` implementing
  `features/cli-index/error-and-exit-paths.feature`: a throwing verb reported via
  `ora().fail` with `process.exit(1)`, an unknown command exiting non-zero, and a
  missing required argument exiting non-zero.
- [x] 3.1 Run `pnpm build && pnpm vitest run --coverage`; confirm the full suite
  is green and the `text` report's `src/cli/index.ts` row has risen substantially
  above the ~43% entry measurement.
