# ratchet-floor-to-95

## Why

This phase (`cli-and-large-files-to-95`) covered the remaining surface gaps —
`cli/index.ts`, `commands/validate.ts`, `ui/welcome-screen.ts` + telemetry, and a
core remainder — via the upstream `cli-index-tests`, `validate-deep-tests`,
`ui-telemetry-tests` and `core-remainder-tests` changes. Measured total line
coverage is now **95.39%**.

The coverage gate is already a ratchet: `total.lines.pct` is judged against an
enforced minimum that defaults to `DEFAULT_COVERAGE_THRESHOLD` and is overridable
via `COVERAGE_THRESHOLD`; the prior phase lifted that default to `87`. This change
**raises the enforced default floor from `87` to `95`** — the `testing`
standard's permanent minimum — locking in the gain so the bar sits at the target
and can never silently regress. This is the batch's final floor-ratchet.

## What Changes

- Raise `DEFAULT_COVERAGE_THRESHOLD` in `src/core/ci/coverage-gate.ts` from `87`
  to `95`, making the enforced default CI floor the testing standard's permanent
  minimum. The value stays data-driven: `COVERAGE_THRESHOLD` overrides it, and a
  missing/empty/non-numeric override falls back to the raised default. Implements
  `features/coverage-gate/floor-to-95.feature`.
- Rewrite the `DEFAULT_COVERAGE_THRESHOLD` doc comment so it describes the
  locked-in `95` floor (the testing standard's permanent minimum, reached) and
  the `COVERAGE_THRESHOLD` ratchet, dropping the stale `87` narrative. Implements
  the in-source scenario of `features/coverage-gate/documented-floor-95.feature`.
- Update the gate unit tests in `test/ci/coverage-gate.test.ts` for the new
  floor — green at exactly 95, green above 95 (e.g. 95.39), red below 95 (reason
  names the measured coverage and the 95 threshold), override-wins, and
  non-numeric override falls back to 95 — and update the existing assertions that
  hard-code the old `87` default. Implements `floor-to-95.feature`.
- Update the `/docs` Reference page `docs/engine/coverage-gate.md` so the
  `COVERAGE_THRESHOLD` default and the ratchet note read `95` instead of `87`,
  and state that `95` is the testing standard's permanent minimum, reached and
  locked in. Implements `documented-floor-95.feature`. (documentation standard)
- Update `README.md`'s testing/coverage section so the noted `COVERAGE_THRESHOLD`
  default reads `95` and reflects that the floor sits at the standard's permanent
  minimum. Implements `documented-floor-95.feature`. (documentation standard)

This change does NOT itself add new behavioral test coverage of product code —
the measured 95.39% that clears the raised floor is delivered by the four
upstream test changes in this phase. This is the intended "cover the surface,
then raise the bar to match" ratchet ordering, with the bar set to the value the
coverage now clears.

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

**Why 95, and why it is safe.** 95 is the `testing` standard's permanent minimum
and the batch's terminal target. With the four upstream test changes landed,
measured `total.lines.pct` is 95.39%, so setting the default to 95 keeps the gate
green at the raised floor with no further test work in this change. The phase
proof-of-work runs `pnpm build && pnpm vitest run --coverage &&
COVERAGE_THRESHOLD=95 node dist/core/ci/coverage-gate.js`, so build, suite, and
gate are all green at 95 at phase close. The coverage scope was already narrowed
to the application in the prior phase (`ratchet-floor-to-87`); no scope change is
needed here.

**Testing (testing standard).** The threshold behavior is pure logic
(`evaluateCoverage` / `resolveThreshold` / `runCoverageGate` over an in-memory
env and a fixture json-summary), so it is proven at the **unit** layer with no
process spawn — extending the existing `test/ci/coverage-gate.test.ts`, which
already mirrors its `.feature` contract in its header and writes fixture
summaries under `fs.mkdtemp(os.tmpdir())`, cleaned in teardown. The raised floor
is asserted green at exactly 95, green above 95 (95.39), red below 95 (naming the
coverage and the 95 threshold), override-wins, and
non-numeric-override-falls-back-to-95. Pushing the threshold check up the pyramid
is explicitly discouraged.

**Documentation (documentation standard).** The change alters one user-facing
surface — the enforced floor's default value — so the existing
`docs/engine/coverage-gate.md` Reference page and `README.md` are made accurate
in the same change: the `COVERAGE_THRESHOLD` default and the ratchet note move
from `87` to `95`, and both state 95 is the testing standard's permanent minimum,
reached and locked in. Reference prose only — factual, no tutorial/rationale.

**Standards followed:** `testing` (unit tests at the right layer, fixture
isolation, `.feature` mirrored in the test header) and `documentation` (the
`/docs` Reference page and README updated in the same change for the surface this
change alters).

## Tasks

- [x] Raise `DEFAULT_COVERAGE_THRESHOLD` in `src/core/ci/coverage-gate.ts` from
      `87` to `95`. (floor-to-95.feature)
- [x] Rewrite the `DEFAULT_COVERAGE_THRESHOLD` doc comment to describe the
      locked-in `95` floor (the testing standard's permanent minimum, reached)
      and the `COVERAGE_THRESHOLD` ratchet, dropping the stale `87` narrative.
      (documented-floor-95.feature, in-source scenario)
- [x] Update `test/ci/coverage-gate.test.ts` for the new floor: green at exactly
      95, green above 95 (95.39), red below 95 (reason names coverage + 95
      threshold), `COVERAGE_THRESHOLD` override-wins, and non-numeric override
      falls back to 95; update existing assertions that hard-code the old `87`
      default. (floor-to-95.feature)
- [x] **Documentation (documentation standard — mandatory):** update
      `docs/engine/coverage-gate.md` so the `COVERAGE_THRESHOLD` default and the
      ratchet note read `95` and state 95 is the testing standard's permanent
      minimum, reached and locked in; update `README.md`'s testing/coverage
      section so the noted `COVERAGE_THRESHOLD` default reads `95` and reflects
      the floor sits at the standard's permanent minimum.
      (documented-floor-95.feature)
- [x] Run the phase proof-of-work — `pnpm build && pnpm vitest run --coverage &&
      COVERAGE_THRESHOLD=95 node dist/core/ci/coverage-gate.js` — and confirm it
      exits 0 (build ok, full suite green, gate green at the locked-in floor 95).
