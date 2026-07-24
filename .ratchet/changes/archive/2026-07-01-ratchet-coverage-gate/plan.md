# ratchet-coverage-gate

## Why

The coverage gate is already a ratchet — `total.lines.pct` is judged against an
enforced minimum overridable by `COVERAGE_THRESHOLD` — but its default floor is
pinned at the 68 baseline with only ~0.67pp of headroom, and the knob is
undocumented outside the source. This change lifts the enforced floor to the
phase target (72), proves the raised floor's green-at/above / red-below behavior
at the unit level, and documents `COVERAGE_THRESHOLD` as the ratchet point so the
floor can only climb toward the 95% goal, never silently regress.

## What Changes

- Raise `DEFAULT_COVERAGE_THRESHOLD` in `src/core/ci/coverage-gate.ts` from `68`
  to `72`, making the enforced default CI floor the phase target. The value
  stays data-driven: `COVERAGE_THRESHOLD` overrides it, an unparseable override
  falls back to the raised default. Implements
  `features/coverage-gate/ratchetable-threshold.feature`.
- Rewrite the `DEFAULT_COVERAGE_THRESHOLD` doc comment so it describes the raised
  72 floor and the `COVERAGE_THRESHOLD` ratchet, and drops the stale "68.67% /
  0.67pp headroom" baseline narrative.
- Add unit coverage in `test/ci/coverage-gate.test.ts` for the raised-threshold
  behavior — green at and above 72, red below 72, override wins, non-numeric
  override falls back to 72 — and update the existing assertions that hard-code
  the old 68 default. Implements `ratchetable-threshold.feature`.
- Add a `/docs` Reference page documenting the coverage gate and its
  `COVERAGE_THRESHOLD` / `COVERAGE_SUMMARY` knobs, signals, and exit codes; note
  the knob in `README.md`. Implements
  `features/coverage-gate/documented-knob.feature`. (documentation standard)

This change does NOT itself raise measured coverage to 72 — that is delivered by
the downstream `commands-core-verb-tests` change (sequenced `after` this one),
whose definition of done is "the gate is green at the raised floor." This is the
intended "raise the bar here, then clear it next" ratchet ordering.

## Design

**Single source of truth for the floor.** The enforced minimum already flows
through one named constant (`DEFAULT_COVERAGE_THRESHOLD`) and one resolver
(`resolveThreshold`), with CI invoking `node dist/core/ci/coverage-gate.js` with
no env so the default governs. Raising the floor is therefore a one-line constant
change plus its doc comment — the evaluator (`evaluateCoverage`), reader
(`readCoverageTotal`), and runner (`runCoverageGate`) are untouched, preserving
the `GateSignal` shape the release-decision spine consumes. The value stays
ratchetable: `COVERAGE_THRESHOLD` is parsed by `resolveThreshold` and only a
finite parse wins, so the override contract and fail-closed-on-unreadable
behavior are unchanged.

**Why 72, and why ahead of the coverage.** 72 is the phase's target floor. The
measured total (~68.67%) does not yet clear it; the `commands-core-verb-tests`
change that follows adds the unit tests over the four `commands/` core verbs that
lift `total.lines.pct` past 72. The phase proof-of-work runs
`COVERAGE_THRESHOLD=72 node dist/core/ci/coverage-gate.js` after all three phase
changes, so the gate is green at 72 at phase close. Setting the floor first is
the ratchet: the bar is raised here and cleared by the next change, exactly as
that change's "green at the raised floor" definition of done states.

**Testing (testing standard).** The threshold behavior is pure logic
(`evaluateCoverage` / `resolveThreshold` / `runCoverageGate` over an in-memory
env and a fixture json-summary), so it is proven at the **unit** layer with no
process spawn — extending the existing `test/ci/coverage-gate.test.ts`, which
already mirrors its `.feature` contract in its header and writes fixture
summaries under `fs.mkdtemp(os.tmpdir())` and cleans them in teardown. Tests
assert green at exactly 72, green above 72, red below 72 (naming coverage and the
72 threshold), override-wins, and non-numeric-override-falls-back-to-72. No new
integration or E2E layer is warranted — pushing this check up the pyramid is
explicitly discouraged.

**Documentation (documentation standard).** The change alters a user-facing
surface (the enforced floor and its `COVERAGE_THRESHOLD` override), so a Reference
page under `docs/` and the `README.md` must be made accurate in the same change.
A new `docs/engine/coverage-gate.md` Reference page mirrors the gate's machinery
(the `COVERAGE_THRESHOLD` and `COVERAGE_SUMMARY` env vars, the `total.lines.pct`
input, the green/red signal, and the 0/1 exit codes); it is registered in
`docs/engine/_category_.json` if ordering requires. `README.md`'s testing/coverage
section gains a one-line note that the floor is raisable via `COVERAGE_THRESHOLD`
and is ratcheted toward 95%, never lowered. Reference prose only — factual,
no tutorial/rationale.

**Standards followed:** `testing` (unit tests at the right layer, fixture
isolation, `.feature` mirrored in the header) and `documentation` (Reference page
+ README updated in the same change). `generalizable-defaults` does not bind:
the coverage gate is ratchet's own CI tooling and `COVERAGE_THRESHOLD` is not a
default shipped into or executed in consuming repositories.

## Tasks

- [x] 1.1 Raise `DEFAULT_COVERAGE_THRESHOLD` from `68` to `72` in
  `src/core/ci/coverage-gate.ts` and rewrite its doc comment to describe the
  raised floor and the `COVERAGE_THRESHOLD` ratchet, removing the stale
  68.67%/0.67pp baseline narrative (implements `ratchetable-threshold.feature`
  and the in-source scenario of `documented-knob.feature`).
- [x] 2.1 Extend `test/ci/coverage-gate.test.ts` with unit tests for the raised
  floor: green at exactly 72, green above 72, red below 72 (reason names the
  measured coverage and the 72 threshold), `COVERAGE_THRESHOLD` override wins
  over the default, and a non-numeric override falls back to 72 — following the
  testing standard (unit layer, fixture isolation, `.feature` named in the
  header).
- [x] 2.2 Update the existing gate assertions that hard-code the old `68`
  default so they reflect the raised default (use `DEFAULT_COVERAGE_THRESHOLD`
  symbolically rather than the literal where they assert the default), and
  confirm `pnpm vitest run test/ci/coverage-gate.test.ts` is green.
- [x] 3.1 **[documentation standard — mandatory]** Create
  `docs/engine/coverage-gate.md` Reference page documenting the coverage gate:
  the `COVERAGE_THRESHOLD` (default 72) and `COVERAGE_SUMMARY` env vars, the
  `total.lines.pct` input, the green/red signal, and the 0/1 exit codes; register
  it in `docs/engine/_category_.json` if ordering requires. Implements
  `documented-knob.feature`.
- [x] 3.2 **[documentation standard — mandatory]** Update `README.md`'s
  testing/coverage section to note the enforced floor is raisable via
  `COVERAGE_THRESHOLD` and is ratcheted toward the 95% target, never lowered.
- [x] 4.1 Run `pnpm build && pnpm vitest run test/ci/coverage-gate.test.ts` and
  confirm the full gate suite is green; sanity-check the gate runner against a
  fixture summary at `COVERAGE_THRESHOLD=72` (green at >=72, red below) to prove
  the raised floor end to end.
