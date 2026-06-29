# ratchet-floor-to-80

## Why

This phase covered the three remaining under-tested command groups —
`commands/batch/`, `commands/workflow/` and `commands/eval/` — and the measured
total line coverage now sits at ~80% (80.09% on the latest coverage run). The
coverage gate is already a ratchet: `total.lines.pct` is judged against an
enforced minimum that defaults to `DEFAULT_COVERAGE_THRESHOLD` and is overridable
via `COVERAGE_THRESHOLD`. Its default floor was lifted to `78` by the prior
phase. This change closes the phase by raising the enforced default floor from
`78` to the phase target `80`, locking in the gain so the bar can only climb
toward the 95% goal, never silently regress.

## What Changes

- Raise `DEFAULT_COVERAGE_THRESHOLD` in `src/core/ci/coverage-gate.ts` from `78`
  to `80`, making the enforced default CI floor the phase target. The value stays
  data-driven: `COVERAGE_THRESHOLD` overrides it, and a missing/empty/non-numeric
  override falls back to the raised default. Implements
  `features/coverage-gate/floor-to-80.feature`.
- Rewrite the `DEFAULT_COVERAGE_THRESHOLD` doc comment so it describes the raised
  `80` floor and the `COVERAGE_THRESHOLD` ratchet, dropping the stale `78`
  narrative. Implements the in-source scenario of
  `features/coverage-gate/documented-floor-80.feature`.
- Update the gate unit tests in `test/ci/coverage-gate.test.ts` for the new
  floor — green at exactly 80, green above 80, red below 80 (reason names the
  measured coverage and the 80 threshold), override-wins, and non-numeric
  override falls back to 80 — and update the existing assertions that hard-code
  the old `78` default. Implements `floor-to-80.feature`.
- Update the `/docs` Reference page `docs/engine/coverage-gate.md` so the
  `COVERAGE_THRESHOLD` default and the ratchet note read `80` instead of `78`.
  Implements `documented-floor-80.feature`. (documentation standard)
- Update `README.md`'s testing/coverage section so the noted `COVERAGE_THRESHOLD`
  default reads `80`. Implements `documented-floor-80.feature`. (documentation
  standard)

This change does NOT itself add new test coverage — the measured ~80% that
clears the raised floor is already delivered by the upstream
`batch-command-group-tests`, `workflow-command-group-tests` and
`eval-command-group-tests` changes this change is sequenced `after`. This is the
intended "cover the surface, then raise the bar to match" ratchet ordering, with
the bar set to the value the coverage already clears.

## Design

**Single source of truth for the floor.** The enforced minimum flows through one
named constant (`DEFAULT_COVERAGE_THRESHOLD`) and one resolver
(`resolveThreshold`); CI invokes `node dist/core/ci/coverage-gate.js` with no env
so the default governs. Raising the floor is therefore a one-line constant change
plus its doc comment — the evaluator (`evaluateCoverage`), reader
(`readCoverageTotal`) and runner (`runCoverageGate`) are untouched, preserving
the `GateSignal` shape the release-decision spine consumes. The value stays
ratchetable: `COVERAGE_THRESHOLD` is parsed by `resolveThreshold` and only a
finite parse wins, so the override contract and the fail-closed-on-unreadable
behavior are unchanged.

**Why 80, and why it is safe.** 80 is the phase's target floor. The latest
coverage run measures `total.lines.pct` at 80.09%, which clears 80, so setting
the default to 80 keeps the gate green at the raised floor with no further test
work in this change. The phase proof-of-work runs
`COVERAGE_THRESHOLD=80 node dist/core/ci/coverage-gate.js` after the build and
suite, so the gate is green at 80 at phase close.

**Testing (testing standard).** The threshold behavior is pure logic
(`evaluateCoverage` / `resolveThreshold` / `runCoverageGate` over an in-memory
env and a fixture json-summary), so it is proven at the **unit** layer with no
process spawn — extending the existing `test/ci/coverage-gate.test.ts`, which
already mirrors its `.feature` contract in its header and writes fixture
summaries under `fs.mkdtemp(os.tmpdir())` and cleans them in teardown. The raised
floor is asserted green at exactly 80, green above 80, red below 80 (naming the
coverage and the 80 threshold), override-wins, and non-numeric-override-falls-
back-to-80. No new integration or E2E layer is warranted — pushing this check up
the pyramid is explicitly discouraged.

**Documentation (documentation standard).** The change alters a user-facing
surface (the enforced floor's default value), so the existing
`docs/engine/coverage-gate.md` Reference page and `README.md` are made accurate
in the same change: the `COVERAGE_THRESHOLD` default and the ratchet note move
from `78` to `80`. Reference prose only — factual, no tutorial/rationale.

**Standards followed:** `testing` (unit tests at the right layer, fixture
isolation, `.feature` mirrored in the header) and `documentation` (Reference page
+ README updated in the same change). `generalizable-defaults` does not bind: the
coverage gate is ratchet's own CI tooling and `COVERAGE_THRESHOLD` is not a
default shipped into or executed in consuming repositories.

## Tasks

- [x] 1.1 Raise `DEFAULT_COVERAGE_THRESHOLD` from `78` to `80` in
  `src/core/ci/coverage-gate.ts` and rewrite its doc comment to describe the
  raised floor and the `COVERAGE_THRESHOLD` ratchet, removing the stale `78`
  narrative (implements `floor-to-80.feature` and the in-source scenario of
  `documented-floor-80.feature`).
- [x] 2.1 Update `test/ci/coverage-gate.test.ts` for the raised floor: green at
  exactly 80, green above 80, red below 80 (reason names the measured coverage
  and the 80 threshold), `COVERAGE_THRESHOLD` override wins over the default, and
  a non-numeric override falls back to 80 — following the testing standard (unit
  layer, fixture isolation, `.feature` named in the header).
- [x] 2.2 Update the existing gate assertions that hard-code the old `78`
  default so they reflect the raised default (use `DEFAULT_COVERAGE_THRESHOLD`
  symbolically rather than the literal where they assert the default), and
  confirm `pnpm vitest run test/ci/coverage-gate.test.ts` is green.
- [x] 3.1 **[documentation standard — mandatory]** Update
  `docs/engine/coverage-gate.md` so the `COVERAGE_THRESHOLD` default in the
  environment-variables table and the ratchet note both read `80` instead of
  `78`. Implements `documented-floor-80.feature`.
- [x] 3.2 **[documentation standard — mandatory]** Update `README.md`'s
  testing/coverage section so the noted `COVERAGE_THRESHOLD` default reads `80`
  and the floor is still described as ratcheted toward the 95% target, never
  lowered. Implements `documented-floor-80.feature`.
- [x] 4.1 Run `pnpm build && pnpm vitest run --coverage` and confirm the full
  suite is green and measured `total.lines.pct >= 80`; then run
  `COVERAGE_THRESHOLD=80 node dist/core/ci/coverage-gate.js` and confirm it exits
  0, proving the gate is green at the raised floor end to end.
