# commands-core-verb-tests

## Why

The `src/commands/` core verbs — `apply.ts`, `verify.ts`, `validate.ts`,
`propose.ts` — are the highest-gap surface in the coverage report and carry the
fail-fast, no-spawn precondition guarantees that keep the headless engine safe to
drive. With the `testing` standard now codified and the coverage gate ratcheted,
this change proves the standard end to end by covering these four verbs and
lifting measured `total.lines.pct` to hold the raised floor (>= 72).

## What Changes

- Add unit/integration tests for the four core verbs under `test/commands/`,
  each following the `testing` standard (test-the-right-thing-at-the-right-layer,
  fixture isolation, `.feature` traceability in the header):
  - `test/commands/propose.test.ts` — implements
    `features/commands-core-verbs/propose.feature`.
  - `test/commands/apply.test.ts` — implements
    `features/commands-core-verbs/apply.feature`.
  - `test/commands/verify.test.ts` — implements
    `features/commands-core-verbs/verify.feature`.
  - `test/commands/validate.test.ts` — implements
    `features/commands-core-verbs/validate.feature`.
- Cover each verb's happy path plus its key error/edge paths: name derivation and
  clobber-refusal (propose), missing-change / missing-plan / `--force` bypass
  (apply), missing-change / unfinished-tasks / `--force` bypass (verify), and
  non-interactive hint / unknown-item suggestions / ambiguity / valid-item
  (validate).
- Prove the raised floor holds: full vitest suite green and the coverage gate
  exits 0 at `COVERAGE_THRESHOLD=72`
  (`features/commands-core-verbs/coverage-floor.feature`).
- No production behavior changes — this change ships tests only.

## Design

**Layer (per the `testing` standard).** The verbs are command wiring, so they get
**integration** tests over a tmpdir fixture repo — every real piece is wired
except the one piece a test must not run: the agent spawn. `propose`/`apply`/
`verify` already expose an injection seam via `EngineDeps`:
`projectRoot?: () => string` points the verb at the fixture, and the documented
`spawner?: Spawner` (`(req) => Promise<AgentSpawnResult>`) replaces the real
agent. Happy-path tests inject a fake spawner returning a canned result and
assert the verb forced the correct transition (`propose`/`apply`/`verify`) and
rendered the expected outcome. Precondition tests inject **no** spawner and a
fixture missing the relevant file, asserting the verb throws its actionable error
*before* the engine is constructed — directly encoding each verb's "NO spawn on a
failed precondition" guarantee (a fake spawner asserted never-called is the
proof). `deriveChangeName` is a pure exported function and gets a direct unit
assertion. `validate` is driven through `ValidateCommand.execute` with
`noInteractive: true` over a fixture and asserts printed output plus
`process.exitCode`, mirroring the existing `doctor.test.ts` exit-code style.

**Fixture isolation (per the `testing` standard).** A shared helper builds an
isolated repo under `fs.mkdtemp(os.tmpdir())`, writes only the minimal
`.ratchet/changes/<name>/` tree each scenario exercises (e.g. a `plan.md`, a
`tasks`-bearing plan with checked/unchecked boxes, or a structurally valid
change), and removes it in `afterEach`. Tests depend on no real repo state, on
each other, or on execution order, and leave nothing behind. Each test file names
its corresponding `.feature` in the header for traceability, matching the
conventions in `test/core/` and `test/commands/doctor.test.ts`.

**Proof / done bar.** Coverage from the four files must lift measured
`total.lines.pct` to >= 72 so the gate is green at the raised floor. The
integration proof-of-work is
`pnpm build && pnpm vitest run --coverage && COVERAGE_THRESHOLD=72 node dist/core/ci/coverage-gate.js`;
it passes when the suite exits 0 and the gate exits 0. If the four verbs alone do
not reach 72, extend coverage on their immediate shared helper
(`change-step-common.ts`) before broadening scope — the slice stays thin and
verb-focused.

## Tasks

- [x] 1.1 Add a shared tmpdir fixture helper for `test/commands/` that builds an
  isolated `.ratchet/changes/<name>/` tree under `fs.mkdtemp(os.tmpdir())` and
  tears it down in `afterEach` (no real-repo dependence, order-independent).
- [x] 2.1 Write `test/commands/propose.test.ts` implementing `propose.feature`:
  `deriveChangeName` slug, blank/unsluggable → fail-fast no-spawn, explicit
  `--name` override, existing-change clobber refusal, happy-path forced `propose`
  transition, and `--json` single-object rendering.
- [x] 2.2 Write `test/commands/apply.test.ts` implementing `apply.feature`:
  missing-change throw, missing-plan fail-fast no-spawn, `--force` bypass, and
  happy-path forced `apply` transition.
- [x] 2.3 Write `test/commands/verify.test.ts` implementing `verify.feature`:
  missing-change throw, unfinished-tasks fail-fast no-spawn (with done/total
  count), `--force` bypass, and happy-path forced `verify` transition.
- [x] 2.4 Write `test/commands/validate.test.ts` implementing `validate.feature`:
  non-interactive hint + exit code 1, unknown-item error with nearest-match
  suggestions + exit 1, change/spec ambiguity + exit 1, and a valid change
  validating with no failure exit code.
- [x] 3.1 Run `pnpm build && pnpm vitest run --coverage` and confirm the full
  suite is green; if `total.lines.pct` is below 72, extend coverage on
  `change-step-common.ts` until the floor is met.
- [x] 3.2 Run `COVERAGE_THRESHOLD=72 node dist/core/ci/coverage-gate.js` and
  confirm it exits 0, holding the raised floor.
