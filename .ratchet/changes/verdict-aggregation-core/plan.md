# verdict-aggregation-core

## Why

Today an eval run's overall pass/fail is decided by one inline expression in
`report.ts` (`scorecard.fail > 0 || diff.regressions.length > 0`), baseline
promotion has no completeness guard, and there is no seam for future gate
capabilities (invariants, regression policy) to plug into the verdict. This
change extracts a single verdict-aggregation core so the run pass is computed in
exactly one place as a logical AND over named contributors, with a defined
extension point — the foundation the rest of the `foundation-verdict-core` phase
builds on.

## What Changes

- Add a single aggregation module `src/core/eval/aggregate.ts` that computes a
  run's overall verdict as a logical **AND over named contributors**, exposing a
  `Contributor` interface as the **defined extension point** for later
  capabilities. Implements
  `features/eval-verdict-aggregation/aggregation-core.feature`.
- Ship three built-in contributors derived from existing signals —
  `deterministic` (fails of `deterministic`-kind bound cases), `llm-judge`
  (fails of `llm-judge`-kind bound cases), and `regression` (baseline diff) —
  plus an `invariants` contributor **registered as a neutral placeholder**
  (reports pass with nothing to evaluate) so the `invariant-set` change later
  fills it in without touching the aggregation seam.
- Route `report.ts`'s `overall` verdict through the aggregation core and expose a
  per-contributor breakdown on `EvalReport`; **remove the inline pass/fail
  expression** so the core is the only decider.
- Make `ratchet eval run` render the aggregated overall verdict and its
  contributor breakdown (it previously printed only the scorecard counts).
- Guard baseline promotion: `promoteBaseline` rejects an **incomplete** run
  (any case still `unjudged`) using the core's completeness signal, leaving the
  baseline unchanged. Implements
  `features/eval-verdict-aggregation/baseline-promotion-guard.feature`.
- **Non-goal (next change `configurable-contributor-gate`):** config/CLI
  contributor *selection* (`eval.gate`, `--only`, `--no-llm-judge`, `--gate`).
  The core accepts a contributor set as a parameter so that selection wires in
  without reshaping the core.

## Design

**One decider, contributor-shaped.** The core is a pure function over an
in-memory context — no filesystem, no spawn — so it sits at the bottom of the
test pyramid (`testing` standard: pure evaluators are unit-tested). Shape:

- `interface ContributorContext { run; cases; diff }` — assembled by
  `report.ts` from the already-loaded run and `diffAgainstBaseline`. Each case
  snapshot already carries its `bindingKind`, so the deterministic/llm-judge
  contributors partition cases by kind without new I/O.
- `interface Contributor { id: ContributorId; evaluate(ctx): ContributorOutcome }`
  where `ContributorOutcome = { id; status: 'pass' | 'fail'; failing: string[] }`.
  This is the extension point: `invariant-set` adds a contributor by
  implementing this interface and registering it — the aggregation logic does
  not change.
- `aggregateRun(ctx, contributors = DEFAULT_CONTRIBUTORS)` returns
  `{ overall: 'pass' | 'fail'; complete: boolean; contributors: ContributorOutcome[] }`.
  `overall` is `pass` iff **every** contributor reports `pass` (logical AND); an
  empty/neutral contributor reports `pass` and is therefore identity to the AND.
  `complete` mirrors today's "no case unjudged" rule, lifted into the core so
  promotion and reporting share one definition.

**Why AND over contributors rather than over cases.** The current OR-of-(fail,
regression) is exactly a two-contributor AND of "no fail" and "no regression";
expressing it as contributors generalizes it (invariants/regression-policy slot
in) and keeps a single truth for the gate. Behavior is preserved for the three
existing signals — existing `report.test.ts` expectations for `overall` stay
green.

**Routing.** `buildReport` calls `aggregateRun` and sets
`report.overall = aggregate.overall`, adding `report.contributors`. The inline
expression is deleted. `commands/eval/run.ts` renders overall + breakdown from
the report. `promoteBaseline` loads the run, builds the context, and throws when
`aggregateRun(...).complete` is false — keeping the baseline file untouched.

**`generalizable-defaults` compliance.** This change introduces no command
strings, package-manager names, build tools, or toolchain paths into shipped
artifacts or config defaults; contributor ids (`deterministic`, `llm-judge`,
`regression`, `invariants`) are ecosystem-neutral vocabulary, and the eval core
runs identically in any consuming repo. No `eval.gate` default is shipped here
(deferred to the next change), so no default value crosses into user repos.

**`documentation` compliance.** The aggregation core is a central component of
the eval gate, so its Reference doc gets an `## Overview` whose first artifact is
a **vertical** (`flowchart TD`) Mermaid diagram — contributors → AND core →
overall verdict / completeness → report + promotion guard — using high-contrast
`classDef`s that each set `color:`. `README.md` is updated where it describes the
`eval run` surface.

**`testing` compliance.** Pure-logic unit tests for `aggregate.ts` (AND truth
table, neutral contributor identity, completeness); integration tests for the
`report.ts`/`promoteBaseline` wiring over a tmpdir fixture; a thin E2E assertion
that `ratchet eval run` prints the overall verdict + contributor breakdown. The
full suite and the coverage gate must stay green at or above the enforced
`COVERAGE_THRESHOLD` (95% floor).

## Tasks

- [x] 1.1 Add `src/core/eval/aggregate.ts`: `Contributor` interface (extension
  point), `ContributorContext`/`ContributorOutcome` types, the built-in
  `deterministic` / `llm-judge` / `regression` contributors, the neutral
  `invariants` placeholder contributor, and `aggregateRun(ctx, contributors)`
  computing `overall` as the AND over contributors plus `complete`.
- [x] 1.2 Unit-test `aggregate.ts` (`test/core/eval/aggregate.test.ts`,
  `.feature` named in the header): AND truth table across contributors, a single
  failing contributor failing the run, regression-only failure, neutral
  contributor identity, and the completeness signal — pure in-memory inputs, no
  fs/spawn.
- [x] 2.1 Route `report.ts` through the core: build the `ContributorContext`,
  set `overall` from `aggregateRun`, add a `contributors` breakdown to
  `EvalReport`, and delete the inline pass/fail expression. Export the new
  surface from `src/core/eval/index.ts`.
- [x] 2.2 Guard `promoteBaseline` (`src/core/eval/run.ts`) to reject an
  incomplete run via the core's `complete` signal, leaving `baseline.json`
  unchanged on rejection.
- [x] 2.3 Update/extend integration tests for `report.ts` and `promoteBaseline`
  (`test/core/eval/report.test.ts`, `test/core/eval/run.test.ts`): overall
  routed through the core, contributor breakdown present, and an incomplete run
  rejected from promotion with the baseline untouched.
- [x] 3.1 Render the aggregated overall verdict and per-contributor breakdown in
  `src/commands/eval/run.ts` (text + `--json`); update
  `test/commands/eval/run.test.ts` and the E2E `test/cli-e2e/eval.test.ts` to
  assert the verdict + breakdown on the built CLI.
- [x] 4.1 **[documentation standard]** Create `docs/eval-verdict-aggregation.md`
  (Reference) with an `## Overview` whose first artifact is a vertical
  `flowchart TD` Mermaid diagram (contributors → AND core → overall verdict /
  completeness → report + promotion guard), high-contrast `classDef`s each
  setting `color:`; document contributors, the extension point, the AND rule,
  and the incomplete-promotion guard. Update `README.md` where it describes
  `eval run`. Cross-check no toolchain literal leaks (generalizable-defaults).
- [x] 5.1 Run `pnpm build && pnpm vitest run eval` and the coverage gate; ensure
  the full suite is green at or above the enforced `COVERAGE_THRESHOLD`.
