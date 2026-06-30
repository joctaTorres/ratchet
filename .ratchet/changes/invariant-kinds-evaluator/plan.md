# invariant-kinds-evaluator

## Why

The prior slice (`invariant-manifest-schema`) gives the gate a typed, fail-closed
loader for `.ratchet/evals/invariants.yaml`, but nothing yet *evaluates* a loaded
invariant — the `invariants` contributor in `aggregate.ts` is still a neutral
placeholder that always passes. Before the contributor can gate the verdict, the
gate needs an evaluator that, given one loaded invariant plus the run state,
computes a single pass / fail / unevaluable outcome for each of the three kinds —
and treats any invariant it *cannot* evaluate as a violation, because a kind that
silently resolves to "pass" when it could not actually be checked is the exact
vacuous-pass gaming hole the invariant set exists to close.

## What Changes

This is the evaluator vertical slice of the invariant set. It implements
`features/eval-invariants/kinds-evaluator.feature`:

- Add a pure-decision evaluator `src/core/eval/invariant-evaluator.ts` exposing
  `evaluateInvariant(invariant, context)` that returns an `InvariantOutcome`
  (`id`, `kind`, `status: 'pass' | 'fail' | 'unevaluable'`, `measure`, `evidence`)
  for any one loaded `Invariant`, plus an `isInvariantViolation(outcome)` helper
  (`status !== 'pass'`) so callers treat both `fail` and `unevaluable` as
  violations.
- Evaluate each kind:
  - **deterministic** — run the `check.run` predicate (cwd = project root) and
    decide pass/fail with the engine's `evaluatePassCondition` (the same
    `exit-zero` / `contains:` / `regex:` / substring vocabulary the deterministic
    *binding* already uses); a predicate that throws before producing a result is
    `unevaluable`.
  - **monotonic** — resolve the named `measure` to a current value over the run
    via a measure resolver, compare it non-decreasing against the same measure
    derived from the **baseline run's recorded state**; `current ≥ baseline` is
    pass, `current < baseline` is fail. A missing baseline run/measure, or a
    measure name that cannot be resolved, is `unevaluable`.
  - **snapshot** — read the checked-in `golden`; run `produce.run` and diff its
    stdout (trimmed) against the golden (trimmed); equal is pass, differing is
    fail. An absent golden, or a `produce` command that throws, is `unevaluable`.
- Record each invariant's measure/evidence on the outcome (e.g. monotonic records
  `scenario-count: 12 (baseline 10)`; deterministic records the pass condition or
  the predicate output; snapshot records match/mismatch).
- Register one built-in, ecosystem-neutral measure — `scenario-count`
  (`run.cases.length`) — through an extensible resolver map. The seam keeps the
  evaluator from baking any toolchain into the measure.
- Export the evaluator, the `InvariantOutcome` / `InvariantStatus` types, and the
  resolver registry from `src/core/eval/index.ts`.
- No contributor wiring and no default manifest in this slice: `aggregate.ts`'s
  `invariants` contributor stays the neutral placeholder, and `executeRun` /
  `buildReport` are untouched (the `invariants-contributor` change threads the
  loaded manifest through this evaluator into the gate; `init-default-manifest`
  ships the default `.ratchet/evals/invariants.yaml`).

## Design

**Mirror `judge.ts`, the existing per-case evaluator.** The deterministic kind is
the same shape as a deterministic *binding*: a command plus a pass condition. So
the evaluator reuses the engine seams `judge.ts` already uses — `BashRunner` for
running `check.run` / `produce.run`, and `evaluatePassCondition` for the
`exit-zero` / `contains:` / `regex:` / substring vocabulary — rather than inventing
a second predicate language. Every command-running and file-reading dependency is
injected (`bash`, `readFile`), exactly as `JudgeDeps` injects its seams, so the
decision logic is provable without a real spawn or real fs.

**The outcome is three-valued, and the third value is fail-closed.** `status` is
`pass | fail | unevaluable`. `unevaluable` is a first-class recorded status — not
folded into `fail` — so the evidence can distinguish "the invariant was checked
and the run violated it" from "the invariant could not be checked at all". Both
are violations: `isInvariantViolation` is `status !== 'pass'`, and the downstream
contributor will fail the gate on either. Reserving a status that is *not pass*
for the unevaluable case is the whole point — a kind that cannot be evaluated must
never return pass, or a gamed run slips through on a broken check.

**Monotonic compares against the baseline run's recorded state, re-derived.** The
"baseline value" for a measure is that measure computed over the baseline
`EvalRun` (e.g. `scenario-count` is `baseline.cases.length`). The baseline run's
recorded `cases`/`verdicts` *are* the recorded value, so no new persistence or
`EvalRun` schema change is needed in this slice — the evaluator takes the baseline
run (or `null`) in its context and the caller loads it via the existing
`loadBaselineRunId` + `loadRun`. No baseline run, or a baseline the measure cannot
be derived from, is `unevaluable` (the fail-closed "missing baseline measure"
case). A measure name absent from the resolver is likewise `unevaluable`, never a
crash and never a pass.

**Ecosystem-neutral by construction (`generalizable-defaults`).** The evaluator
ships no toolchain literal: the only built-in measure, `scenario-count`, is
computed from run state with no command; the deterministic `check.run` and
snapshot `produce.run` are user-authored manifest strings the evaluator merely
runs; and the pass-condition vocabulary is the existing neutral one. The resolver
is an extensible map so future measures are added without baking a package
manager, test runner, or command string into the evaluator. (The agent-neutral
*default manifest* is `init-default-manifest`'s concern, not this slice's.)

**Tool-agnostic core (`multi-agent-support`).** The evaluator is pure core logic
identical for every coding agent; it adds no agent-facing skill, command, or
template, and no batch/agent lifecycle surface (`delegated-lifecycle` is
unaffected — this slice changes no skill-delegated verb), so it is trivially
agnostic across coding agents.

**Testing strategy (`testing` standard).** The evaluator is a pure decision
function over in-memory inputs with injected `bash`/`readFile` seams, so every
branch is proven at the **unit** layer in `test/core/eval/invariant-evaluator.test.ts`
with no real spawn: the monotonic path needs no seam at all; the deterministic and
snapshot paths use a stub `bash`/`readFile` (and a `mkdtemp(os.tmpdir())` fixture
for the golden-file existence cases, torn down in `afterEach`). Coverage spans all
three kinds × {pass, fail, unevaluable}: predicate met / unmet / throws, measure
≥ / < baseline / missing-baseline / unknown-measure, golden match / mismatch /
absent. The test file header names
`features/eval-invariants/kinds-evaluator.feature`. Nothing is pushed up the
pyramid — there is no new CLI surface in this slice. The full suite and the
coverage gate stay green at or above the enforced `COVERAGE_THRESHOLD`.

**Documentation strategy (`documentation` standard — mandatory, blocking).** The
evaluator is a core anti-gaming gate component, so it is documented in the Reference
doc the loader slice created, `docs/eval-invariants.md`: a new section describes the
per-invariant outcome model (the three statuses, fail-closed unevaluable, the
recorded measure/evidence) and how each kind is evaluated (predicate, monotonic vs
baseline, snapshot vs golden), and the doc's `## Overview` Mermaid diagram is
extended/added with a vertical, high-contrast flow (every `classDef` sets `color:`,
semantic Unicode node labels) of invariant → evaluator → {pass | fail |
unevaluable-as-violation}. Because this slice adds no user-facing CLI/flag/config
surface (the contributor toggle and default manifest are downstream), `README.md`
needs no change in this change; the documentation task records that explicitly.

## Tasks

- [x] 1.1 Add `src/core/eval/invariant-evaluator.ts`: define `InvariantStatus`
      (`pass | fail | unevaluable`) and `InvariantOutcome` (`id`, `kind`,
      `status`, `measure`, `evidence`), an injectable `InvariantEvalContext`
      (`projectRoot`, `run`, `baseline`, optional `bash`, optional `readFile`),
      and an `isInvariantViolation(outcome)` helper (`status !== 'pass'`).
- [x] 1.2 Implement the deterministic path: run `check.run` via the injected
      `bash` (default `realBashRunner`) at the project root, decide pass/fail with
      `evaluatePassCondition` over `check.pass`; a `bash` that throws ⇒
      `unevaluable` naming the predicate error; record the pass condition or the
      predicate output as evidence.
- [x] 1.3 Implement the monotonic path with an extensible measure resolver
      registering the ecosystem-neutral `scenario-count` (`run.cases.length`):
      compare the current measure non-decreasing against the same measure derived
      from `context.baseline`; `current ≥ baseline` ⇒ pass, `current < baseline`
      ⇒ fail, missing baseline run/measure or an unresolvable measure name ⇒
      `unevaluable`; record `measure: current (baseline value)`.
- [x] 1.4 Implement the snapshot path: read `golden` via the injected `readFile`
      (default fs) relative to the project root — absent golden ⇒ `unevaluable`;
      run `produce.run` via `bash` (throws ⇒ `unevaluable`); diff produced stdout
      (trimmed) against the golden (trimmed) ⇒ pass on equal, fail on differ;
      record match/mismatch evidence.
- [x] 1.5 Export `evaluateInvariant`, `isInvariantViolation`, the
      `InvariantOutcome` / `InvariantStatus` types, and the measure-resolver
      registry from `src/core/eval/index.ts`.
- [x] 2.1 Add `test/core/eval/invariant-evaluator.test.ts` (unit; tmpdir fixture
      for golden cases; `afterEach` cleanup; header naming
      `features/eval-invariants/kinds-evaluator.feature`) covering all three kinds
      × {pass, fail, unevaluable}: deterministic predicate met / unmet / throws;
      monotonic ≥ / < baseline / missing-baseline / unknown-measure; snapshot
      match / mismatch / absent-golden; assert `unevaluable` is reported as a
      violation and each outcome records its measure/evidence.
- [x] 2.2 Run `pnpm build && pnpm vitest run invariant` and the full suite +
      coverage gate; confirm green at or above the enforced `COVERAGE_THRESHOLD`.
- [x] 3.1 (documentation — mandatory, `documentation` standard) Update
      `docs/eval-invariants.md`: add a section on the per-invariant outcome model
      (three statuses, fail-closed `unevaluable`, recorded measure/evidence) and
      how each kind is evaluated, and extend/add the `## Overview` vertical,
      high-contrast Mermaid diagram (every `classDef` sets `color:`, semantic
      Unicode labels) of invariant → evaluator → {pass | fail | unevaluable-as-
      violation}. Record in the task that `README.md` needs no change because this
      slice adds no user-facing CLI/flag/config surface.
