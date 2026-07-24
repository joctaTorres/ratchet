# ratchet-floor-to-87

## Why

This phase (`core-utilities-coverage`) covered the untested core utilities —
`core/migration.ts`, `core/change-status-policy.ts`, `core/shared/config-schema.ts`
— and the `utils` helpers (`match.ts`, `item-discovery.ts`, `task-progress.ts`)
via the upstream `core-util-tests` and `utils-helper-tests` changes. The coverage
gate is already a ratchet: `total.lines.pct` is judged against an enforced
minimum that defaults to `DEFAULT_COVERAGE_THRESHOLD` and is overridable via
`COVERAGE_THRESHOLD`. Its default floor was lifted to `80` by the prior phase.

This change closes the phase in two moves. First it **scopes vitest coverage to
the application** so the measured total reflects real app code: it excludes the
non-app terminal-animation demo scripts under `scripts/**` and the root tooling
config `eslint.config.js` from coverage, joining the existing `.agents/**`
exclusion (`website/` stays measured — it is now covered). Then it **raises the
enforced default floor from `80` to the phase target `87`**, locking in the gain
so the bar can only climb toward the 95% goal, never silently regress.

## What Changes

- Add `scripts/**` and `eslint.config.js` to the `coverage.exclude` list in
  `vitest.config.ts`, alongside the existing `.agents/**` exclusion, with a
  comment explaining they are non-app demo scripts / root tooling, not
  application code. `website/` is NOT excluded — it stays measured. Implements
  `features/coverage-gate/coverage-scope.feature`.
- Raise `DEFAULT_COVERAGE_THRESHOLD` in `src/core/ci/coverage-gate.ts` from `80`
  to `87`, making the enforced default CI floor the phase target. The value stays
  data-driven: `COVERAGE_THRESHOLD` overrides it, and a missing/empty/non-numeric
  override falls back to the raised default. Implements
  `features/coverage-gate/floor-to-87.feature`.
- Rewrite the `DEFAULT_COVERAGE_THRESHOLD` doc comment so it describes the raised
  `87` floor and the `COVERAGE_THRESHOLD` ratchet, dropping the stale `80`
  narrative. Implements the in-source scenario of
  `features/coverage-gate/documented-floor-87.feature`.
- Update the gate unit tests in `test/ci/coverage-gate.test.ts` for the new
  floor — green at exactly 87, green above 87, red below 87 (reason names the
  measured coverage and the 87 threshold), override-wins, and non-numeric
  override falls back to 87 — and update the existing assertions that hard-code
  the old `80` default. Implements `floor-to-87.feature`.
- Update the `/docs` Reference page `docs/engine/coverage-gate.md` so the
  `COVERAGE_THRESHOLD` default and the ratchet note read `87` instead of `80`,
  and add a note documenting the coverage scope (the application is measured;
  `scripts/**` and `eslint.config.js` are excluded alongside `.agents/**`).
  Implements `documented-floor-87.feature`. (documentation standard)
- Update `README.md`'s testing/coverage section so the noted `COVERAGE_THRESHOLD`
  default reads `87`. Implements `documented-floor-87.feature`. (documentation
  standard)

This change does NOT itself add new behavioral test coverage of product code —
the measured ~87% that clears the raised floor is delivered by the upstream
`core-util-tests` and `utils-helper-tests` changes plus the coverage-scope
narrowing in this change. This is the intended "cover the surface, scope the
measurement, then raise the bar to match" ratchet ordering, with the bar set to
the value the coverage now clears.

## Design

**Single source of truth for the floor.** The enforced minimum flows through one
named constant (`DEFAULT_COVERAGE_THRESHOLD`) and one resolver
(`resolveThreshold`); CI invokes `node dist/core/ci/coverage-gate.js` with no env
so the default governs. Raising the floor is a one-line constant change plus its
doc comment — the evaluator (`evaluateCoverage`), reader (`readCoverageTotal`)
and runner (`runCoverageGate`) are untouched, preserving the `GateSignal` shape
the release-decision spine consumes. The value stays ratchetable:
`COVERAGE_THRESHOLD` is parsed by `resolveThreshold` and only a finite parse
wins, so the override contract and the fail-closed-on-unreadable behavior are
unchanged.

**Coverage scope is config-only.** Enforcement does not live in
`vitest.config.ts` (there is no `coverage.thresholds` there); the exclude list
only governs *what is instrumented*. Adding `scripts/**` and `eslint.config.js`
to the existing `.agents/**` exclusion narrows the measured denominator to
application code so `total.lines.pct` reflects real coverage. `website/` is left
in scope because it is now covered. The gate reads the resulting
`coverage-summary.json` total unchanged.

**Why 87, and why it is safe.** 87 is the phase's target floor. With the upstream
core-utility and helper tests landed and the coverage narrowed to the
application, measured `total.lines.pct` clears 87, so setting the default to 87
keeps the gate green at the raised floor with no further test work in this
change. The phase proof-of-work runs `pnpm build && pnpm vitest run --coverage &&
COVERAGE_THRESHOLD=87 node dist/core/ci/coverage-gate.js`, so build, suite, and
gate are all green at 87 at phase close.

**Testing (testing standard).** The threshold behavior is pure logic
(`evaluateCoverage` / `resolveThreshold` / `runCoverageGate` over an in-memory
env and a fixture json-summary), so it is proven at the **unit** layer with no
process spawn — extending the existing `test/ci/coverage-gate.test.ts`, which
already mirrors its `.feature` contract in its header and writes fixture
summaries under `fs.mkdtemp(os.tmpdir())`, cleaned in teardown. The raised floor
is asserted green at exactly 87, green above 87, red below 87 (naming the
coverage and the 87 threshold), override-wins, and
non-numeric-override-falls-back-to-87. The coverage-scope change is a
declarative config edit (an exclude-list addition) with no runtime logic to
unit-test; it is proven by the phase integration proof-of-work, where the gate is
green at 87 only if the narrowed measurement clears the raised floor. Pushing the
threshold check up the pyramid is explicitly discouraged.

**Documentation (documentation standard).** The change alters two user-facing
surfaces — the enforced floor's default value and what the coverage run measures
— so the existing `docs/engine/coverage-gate.md` Reference page and `README.md`
are made accurate in the same change: the `COVERAGE_THRESHOLD` default and the
ratchet note move from `80` to `87`, and the Reference page documents the
application coverage scope (`scripts/**` and `eslint.config.js` excluded
alongside `.agents/**`). Reference prose only — factual, no tutorial/rationale.

**Standards followed:** `testing` (unit tests at the right layer, fixture
isolation, `.feature` mirrored in the test header) and `documentation` (the
`/docs` Reference page and README updated in the same change for the surfaces
this change alters).

## Tasks

- [x] Add `scripts/**` and `eslint.config.js` to the `coverage.exclude` list in
      `vitest.config.ts`, alongside the existing `.agents/**` entry, with a
      comment explaining they are non-app demo scripts / root tooling; leave
      `website/` measured. (coverage-scope.feature)
- [x] Raise `DEFAULT_COVERAGE_THRESHOLD` in `src/core/ci/coverage-gate.ts` from
      `80` to `87`. (floor-to-87.feature)
- [x] Rewrite the `DEFAULT_COVERAGE_THRESHOLD` doc comment to describe the raised
      `87` floor and the `COVERAGE_THRESHOLD` ratchet, dropping the stale `80`
      narrative. (documented-floor-87.feature, in-source scenario)
- [x] Update `test/ci/coverage-gate.test.ts` for the new floor: green at exactly
      87, green above 87, red below 87 (reason names coverage + 87 threshold),
      `COVERAGE_THRESHOLD` override-wins, and non-numeric override falls back to
      87; update existing assertions that hard-code the old `80` default.
      (floor-to-87.feature)
- [x] **Documentation (documentation standard — mandatory):** update
      `docs/engine/coverage-gate.md` so the `COVERAGE_THRESHOLD` default and the
      ratchet note read `87`, and add a note documenting the coverage scope (the
      application is measured; `scripts/**` and `eslint.config.js` are excluded
      alongside `.agents/**`); update `README.md`'s testing/coverage section so
      the noted `COVERAGE_THRESHOLD` default reads `87`. (documented-floor-87.feature)
- [x] Run the phase proof-of-work — `pnpm build && pnpm vitest run --coverage &&
      COVERAGE_THRESHOLD=87 node dist/core/ci/coverage-gate.js` — and confirm it
      exits 0 (build ok, full suite green, gate green at the raised floor 87).
