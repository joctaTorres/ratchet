# Mutation green-baseline precondition

## Why

The mutation invariant harness classifies a mutant `killed` on a non-zero oracle
exit and `survived` on exit 0, but never checks that the user's `test` command
passes on the clean tree first. A suite already red on the unmutated tree scores
every seeded mutant `killed` regardless of the fault, yielding zero survivors and
a silently vacuous `pass` — the exact gaming hole the mutation invariant exists to
close. This is a confirmed correctness/anti-gaming defect in code that gates a run.

## What Changes

Implements `features/mutation-invariant-harness/green-baseline-precondition.feature`
and `features/mutation-evaluator-fold/green-baseline-unevaluable.feature`:

- `runMutationHarness` (`src/core/eval/mutation-harness.ts`) gains a **green-baseline
  precondition**: after the working-tree cleanliness check and before the seed loop,
  it runs `invariant.test` once on the clean, unmutated tree and requires exit 0. A
  red baseline seeds nothing and returns a new `MutationHarnessOutcome` variant
  `{ kind: 'oracle-not-green'; reason }`. Implements the red-baseline, self-revert,
  green-preserved, and thrown-oracle scenarios of the harness feature.
- A new private `checkOracleBaseline(bash, test, cwd)` runs the oracle once, reverts
  **unconditionally** in a `finally` (reusing the existing scoped `REVERT_COMMAND`) so
  the baseline run cannot leak into the first mutant's `git diff --cached` or dirty
  the tree, returns `{ green: false, reason }` on a non-zero exit, and — critically —
  does **not** catch a thrown oracle, so a missing-binary throw propagates as "could
  not run at all", distinct from "ran but red".
- `evaluateMutation` (`src/core/eval/invariant-evaluator.ts`) maps an
  `oracle-not-green` harness result to `unevaluable` (never `pass`), mirroring the
  existing `unusable-working-tree` guard. No mutant ran, so nothing is persisted as
  run evidence and no prior-evaluation cache entry is written — a later run may retry
  once the suite is green. Implements the evaluator-fold feature.

No public CLI surface, flag, config key, or generated artifact changes; the fix is
internal to the two eval-core modules and their contract docs.

## Design

**Where the gate lives, and why there.** The green-baseline check runs strictly
AFTER `checkWorkingTree` (the tree must already be clean so the oracle runs against a
known state) and strictly BEFORE the seed loop (a red baseline must seed nothing). It
is the load-bearing anti-vacuity check: because the oracle decides `killed` on any
non-zero exit, a suite already red on the clean tree would score every mutant `killed`
no matter what was mutated. Requiring a green baseline guarantees a subsequent non-zero
exit is attributable to the seeded fault — the whole premise of the kill/survive
classification.

**Self-reverting baseline run.** `checkOracleBaseline` runs `invariant.test` inside a
`try` whose `finally` issues the same scoped `REVERT_COMMAND`
(`git reset --hard HEAD && git clean -fd -e .ratchet/evals/runs`) the seed loop already
uses. Reusing that one constant keeps the baseline revert and the per-attempt revert
from drifting, and ensures any artifact the test command writes is cleaned before the
first `git add -A`, and the tree is left exactly as clean as it was found.

**Red vs. cannot-run are distinct outcomes.** Only a non-zero EXIT becomes
`{ green: false }` ⇒ `oracle-not-green` ⇒ `unevaluable` with an explanatory reason. A
THROWN oracle call (e.g. the test binary is missing) is deliberately not caught in
`checkOracleBaseline`, so it propagates to `runMutationHarness`'s caller — the same
"harness could not run" failure surface the existing code already exposes for a thrown
seed/oracle call — rather than being misreported as a red suite.

**Fail-closed at the evaluator, mirroring `unusable-working-tree`.** `evaluateMutation`
already maps `unusable-working-tree` to `unevaluable` (a violation, never a pass); the
new `oracle-not-green` branch sits directly beside it and returns `unevaluable` the same
way, before any mutant reduction. Because no mutant ran, the branch persists no
`InvariantOutcome.artifacts` and writes no `(run.runId, invariant.id)` cache entry, so a
later evaluation is free to re-run the harness once the suite is green. Fail-closed:
never a guessed or vacuous pass.

**Standards.**
- **testing** (applies — this change modifies core `src/core/eval` behavior): prove the
  new behavior at the **unit** layer, the correct pyramid level for these pure-seam
  evaluators, injecting fake `bash`/`spawner` exactly like the existing
  `mutation-harness.test.ts` / `invariant-evaluator.test.ts` fixtures — no real git or
  agent spawn. Cover red-baseline ⇒ `oracle-not-green`/no-seeding, the probe→baseline→
  revert ordering, green-baseline ⇒ seed/classify preserved, thrown-oracle ⇒ propagates,
  and the evaluator's `oracle-not-green` ⇒ `unevaluable`/no-persist/no-cache mapping. Do
  not weaken existing assertions; keep the full suite and the enforced
  `COVERAGE_THRESHOLD` (95% floor) green. Each test file names the `.feature` it
  implements in its header (traceability).
- **documentation** (applies, mandatory — this change touches production source and
  alters the harness's fail-closed contract and its `MutationHarnessOutcome` type):
  update `docs/eval-mutation-harness.md` (add the green-baseline gate to the Overview
  Mermaid flowchart and the Sequence, and add the `oracle-not-green` variant to the
  `MutationHarnessOutcome` section) and `docs/eval-invariants.md`'s `### kind: mutation`
  subsection (a non-green baseline evaluates `unevaluable`, never a vacuous pass). No
  `README.md` user-facing surface changes (no command/flag/config/artifact change), so
  README is left untouched by design — the internal contract docs are the surface this
  change affects.

**Standards not applicable to this change.**
- **generalizable-defaults** — the change ships no new default, command, path, or
  literal into consuming repos; `invariant.test` stays 100% user-supplied and every
  git command already exists in the harness. Nothing ratchet-toolchain-specific is
  introduced.
- **multi-agent-support** — no agent-facing surface (no skill/command/template/adapter);
  the seed spawn already flows through the adapter registry and is unchanged. Core logic
  only.
- **delegated-lifecycle** — does not touch the batch engine, the headless
  propose/apply/verify verbs, or the shared lifecycle/workflow templates.

## Tasks

- [x] 1.1 In `src/core/eval/mutation-harness.ts`, add the `MutationHarnessOutcome`
      variant `{ kind: 'oracle-not-green'; reason: string }` and a private
      `checkOracleBaseline(bash, test, cwd)` that runs `invariant.test` once, reverts
      unconditionally in a `finally` using the existing scoped `REVERT_COMMAND`, returns
      `{ green: false, reason }` (reason naming the test command and its non-zero exit)
      on a non-zero exit, `{ green: true }` on exit 0, and lets a thrown oracle
      propagate (no catch). Update the module docstring to document the green-baseline
      precondition.
- [x] 1.2 Wire `checkOracleBaseline` into `runMutationHarness` AFTER the working-tree
      cleanliness check and BEFORE the seed loop; on a non-green baseline return
      `{ kind: 'oracle-not-green', reason }` and seed nothing.
- [x] 2.1 In `src/core/eval/invariant-evaluator.ts`, map an `oracle-not-green` harness
      result in `evaluateMutation` to `unevaluable` (a violation, never `pass`),
      beside the existing `unusable-working-tree` guard, with an explanatory reason and
      no persist/cache. Update the `evaluateMutation`/module docstrings accordingly.
- [x] 3.1 (testing) Add unit tests in `test/core/eval/mutation-harness.test.ts` (header
      naming `features/mutation-invariant-harness/green-baseline-precondition.feature`):
      red baseline ⇒ `oracle-not-green` with zero spawns and no add/diff; probe →
      baseline-oracle → revert ordering before any seed; green baseline ⇒ seed/classify
      preserved (adjust existing oracle sequences for the extra baseline run without
      weakening them); thrown baseline oracle ⇒ propagates, nothing seeded.
- [x] 3.2 (testing) Add a unit test in `test/core/eval/invariant-evaluator.test.ts`
      (header naming `features/mutation-evaluator-fold/green-baseline-unevaluable.feature`):
      a red baseline ⇒ `unevaluable` (never `pass`, is a violation, evidence mentions
      not-green/vacuous), no `artifacts` persisted, no cache entry; adjust existing
      mutation-path oracle sequences for the added green-baseline run without weakening
      their assertions.
- [x] 3.3 (testing) Run `pnpm vitest run test/core/eval/mutation-harness.test.ts
      test/core/eval/invariant-evaluator.test.ts` and the full `pnpm vitest run` with the
      coverage gate; confirm green at or above the enforced `COVERAGE_THRESHOLD` (95%
      floor), with existing assertions intact.
- [x] 4.1 **Documentation (required, per the `documentation` standard).** Update
      `docs/eval-mutation-harness.md`: add the green-baseline gate to the Overview
      Mermaid flowchart (a node between the cleanliness precondition and the loop, with
      an `oracle-not-green` error terminal, high-contrast `classDef` with `color:`) and
      to the Sequence, and add `{ kind: 'oracle-not-green'; reason }` to the
      `MutationHarnessOutcome` section. Update `docs/eval-invariants.md`'s
      `### kind: mutation` subsection to state a non-green baseline evaluates
      `unevaluable` (never a vacuous pass). Keep every touched diagram valid and
      accurate.
- [x] 5.1 Run the change's proof of work — `pnpm vitest run` (full suite + coverage
      gate, green at/above the enforced `COVERAGE_THRESHOLD`), `pnpm run lint`
      (exit-zero), and `pnpm run build` (exit-zero) — and confirm all pass before the
      change is considered done.
