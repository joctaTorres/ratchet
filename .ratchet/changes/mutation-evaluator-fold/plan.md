# Mutation evaluator fold

## Why

`kind: mutation` invariants are schema-typed (`mutation-invariant-schema`) and the
seed/oracle/classify/revert harness exists standalone (`mutation-oracle-harness`,
`runMutationHarness`), but `evaluateInvariant`'s `mutation` case is still a
fail-closed placeholder that always returns `unevaluable` with a "not implemented
yet" string. Until the harness's per-mutant kill/survive results are reduced to a
real `pass`/`fail`/`unevaluable` outcome, no project can actually gate a run on
"did a seeded fault survive the user's own tests" — the whole point of the
`mutation-invariant` phase. This is the wiring slice, mirroring exactly how
`web-deterministic-fold` reduced `runWebLifecycle`'s outcome into a `CaseVerdict`
after `web-lifecycle-harness` shipped the harness standalone.

## What Changes

Implements `features/mutation-evaluator-fold/mutation-outcome.feature`:

- `evaluateMutation` in `src/core/eval/invariant-evaluator.ts` stops being a
  placeholder: it calls `runMutationHarness(invariant, ctx.projectRoot, { bash,
  spawner, agentName })` and reduces the result to an `InvariantOutcome` in the
  same shape `evaluateDeterministic`/`evaluateMonotonic`/`evaluateSnapshot`
  already return:
  - Any `survived` mutant is a hard `fail`, regardless of how many others were
    killed.
  - Fewer evaluated mutants than `invariant.threshold` (with none survived) is
    `unevaluable` — not enough evidence to trust a "no survivors" claim, never a
    silent pass.
  - A harness call that throws (the oracle command, or `git`, could not run at
    all), or a harness result of `{ kind: 'unusable-working-tree' }`, is also
    `unevaluable` — fail-closed, matching the "no runnable suite" done criterion.
  - Otherwise (≥ `threshold` mutants evaluated, zero survived): `pass`.
- `InvariantEvalContext` (and `InvariantGateInput`/`evaluateInvariantGate`, which
  already forwards `bash`/`readFile` the same way) gain optional `spawner?:
  Spawner` and `agentName?: string` fields, threaded straight into the harness
  call — the same injectable-seam pattern `bash`/`readFile` already use, so tests
  never spawn a real agent. `report.ts`'s existing call
  (`evaluateInvariantGate({ projectRoot, run, baseline })`) needs no change: the
  new fields are optional and the harness's own defaults (`realSpawner`,
  `resolveAdapter()`) apply exactly as they do when `runMutationHarness` is called
  directly.
- No change to `aggregate.ts`, `invariant-gate.ts`'s `failing`-collection logic, or
  `ALL_CONTRIBUTOR_IDS`: a `mutation` invariant's `fail`/`unevaluable` outcome
  already flows into the existing `invariants` contributor through
  `isInvariantViolation`, exactly like every other kind — no new `ContributorId`.
- **Out of scope** (later changes in the `mutation-invariant` phase per
  `.ratchet/batches/mature-eval/batch.yaml`): persisting each mutant's diff and
  test output as replayable run evidence/artifacts (`mutation-evidence-recording`)
  — this change's `evidence` is a human-readable summary string, matching every
  other kind's `measure`/`evidence` fields, not a structured artifact; and
  scaffolding an inert `kind: mutation` entry from `ratchet init`
  (`init-mutation-scaffold`) — `default-manifest.ts` is untouched here.
- No agent-facing surface (no new skill/command/template): the fold only adds a
  code path that calls the already-agent-neutral `runMutationHarness`, so
  `multi-agent-support` is satisfied by construction, matching
  `web-deterministic-fold`'s precedent.
- Reference documentation: update `docs/eval-invariants.md`'s evaluator-dispatch
  diagram and "How each kind is evaluated" section, and `README.md`'s mutation
  bullet, per `.ratchet/standards/documentation.md`.

## Design

**`evaluateMutation` mirrors the other three kinds' shape exactly.** Every other
case in the switch is `(invariant, ctx) => InvariantOutcome | Promise<...>`; the
placeholder's signature (`(inv: MutationInvariant) => InvariantOutcome`, no
`ctx`) is widened to take `ctx: InvariantEvalContext` and made `async`, since it
now needs `ctx.projectRoot` (the harness's `cwd`) and the injectable `bash`/
`spawner`/`agentName` seams:

```ts
async function evaluateMutation(
  inv: MutationInvariant,
  ctx: InvariantEvalContext
): Promise<InvariantOutcome> {
  const measureBase = `mutation: ${inv.test} (budget ${inv.budget}, threshold ${inv.threshold})`;
  let harnessOutcome: MutationHarnessOutcome;
  try {
    harnessOutcome = await runMutationHarness(inv, ctx.projectRoot, {
      bash: ctx.bash,
      spawner: ctx.spawner,
      agentName: ctx.agentName,
    });
  } catch (err) {
    // Fail closed: an oracle/harness that cannot run at all is unevaluable,
    // never a silent pass — mirrors evaluateDeterministic's predicate-throws path.
    return unevaluable(inv, measureBase, `mutation harness could not run: ${(err as Error).message}`);
  }

  if (harnessOutcome.kind === 'unusable-working-tree') {
    return unevaluable(
      inv,
      measureBase,
      `working tree was not usable for mutation seeding: ${harnessOutcome.reason}`
    );
  }

  const { mutants } = harnessOutcome;
  const survived = mutants.filter((m) => m.outcome === 'survived');
  const measure = `${measureBase} — ${mutants.length} evaluated, ${survived.length} survived`;

  if (survived.length > 0) {
    const first = survived[0]!;
    return fail(
      inv,
      measure,
      `${survived.length} of ${mutants.length} evaluated mutant(s) survived (e.g. attempt #${first.index}): ${first.diff.slice(0, 500)}`
    );
  }
  if (mutants.length < inv.threshold) {
    return unevaluable(
      inv,
      measure,
      `only ${mutants.length} of ${inv.threshold} required mutants reached a kill/survive verdict (budget ${inv.budget}); too few to trust the invariant`
    );
  }
  return pass(inv, measure, `all ${mutants.length} evaluated mutant(s) were killed`);
}
```

- `evaluateInvariant`'s switch changes `case 'mutation': return
  evaluateMutation(invariant);` to `return evaluateMutation(invariant, context);`
  — the function itself was already `async` overall (the switch's return type is
  `Promise<InvariantOutcome>`), so no signature change is needed at the dispatch
  site beyond passing `context` through, exactly like the other three cases
  already do.

**Survived-first ordering is deliberate, not incidental.** A survived mutant is
real evidence of a gap in the test suite regardless of how many mutants the
budget allowed for; checking it before the threshold means a project that hits
its threshold late (e.g. `budget: 5`, `threshold: 3`, and mutant #1 already
survived) still fails hard on real evidence rather than waiting to see if more
mutants get evaluated. The threshold check exists to catch the *opposite*
problem — an all-killed result built from too little evidence to trust — so it
only applies once "no survivors" is the live question.

**`InvariantEvalContext` grows two more optional injectable seams, not a
required one.** `bash`/`readFile` already default to the real runners when
omitted; `spawner`/`agentName` follow the identical contract so every existing
caller (`report.ts`, and every non-mutation test in
`invariant-evaluator.test.ts`) keeps compiling and behaving unchanged. Threading
is one line in `invariant-gate.ts`'s `evaluateInvariantGate`, forwarding
`input.spawner`/`input.agentName` into the `evaluateInvariant` call alongside the
existing `bash`/`readFile` forward — no new parameter is introduced anywhere else
in the call chain, matching the existing seam-threading precedent exactly.

**No new `ContributorId`, no change to `aggregate.ts`.** The `invariants`
contributor already reads `ctx.invariants?.failing` — a plain `string[]` of
violating invariant ids computed upstream by `evaluateInvariantGate` — with no
per-kind branching. A `mutation` invariant's `fail`/`unevaluable` outcome is
already `isInvariantViolation` (`status !== 'pass'`), so it was already wired
into `failing` end-to-end the moment the placeholder shipped; this change only
makes that a *meaningful* fail/pass distinction instead of an always-`unevaluable`
one. This is exactly the "existing `invariants` contributor gates on it
unchanged, no new `ContributorId`" done criterion, and it requires zero edits to
`aggregate.ts`.

**Ecosystem-agnostic and agent-neutral by construction
(`generalizable-defaults` / `multi-agent-support`).** `evaluateMutation` invokes
`runMutationHarness` with the invariant's own author-supplied `test` string and
optional `agentName` — it introduces no new command literal, no new toolchain
assumption, and no agent-specific branch; every seam it touches was already
built agent/ecosystem-neutral by `mutation-oracle-harness`.

**Testing strategy (`testing` standard).** Proven at the **unit** layer:

- `test/core/eval/invariant-evaluator.test.ts` replaces its
  "mutation (schema-only placeholder)" `describe` block (the single "not
  implemented" assertion no longer holds) with cases covering
  `features/mutation-evaluator-fold/mutation-outcome.feature`: all evaluated
  mutants killed ⇒ `pass`; one survived mutant among several ⇒ `fail` naming the
  survived mutant in its evidence, regardless of threshold; fewer mutants
  evaluated than `threshold` with none survived ⇒ `unevaluable` citing the
  threshold; an `unusable-working-tree` harness result ⇒ `unevaluable` citing the
  reason; a thrown harness/oracle error ⇒ `unevaluable` citing that the test
  command could not run, with zero mutants recorded. Every case injects fake
  `bash`/`spawner` (mirroring `mutation-harness.test.ts`'s `makeSeams` pattern) —
  no real git command or agent spawn. File header updated to also name the new
  feature file.
- `test/core/eval/invariant-gate.test.ts` gains one case: an active `kind:
  mutation` invariant evaluated through `evaluateInvariantGate` with injected
  `bash`/`spawner` such that the harness reports a survived mutant, proving
  `spawner` is threaded from `InvariantGateInput` through to the mutation
  evaluation and the invariant's id lands in `failing` — the end-to-end proof
  that the fold reaches the run-level gate, not just the per-invariant unit.
- The full suite and coverage gate stay green at or above the enforced
  `COVERAGE_THRESHOLD`.

**Documentation strategy (`documentation` standard).** `docs/eval-invariants.md`:
update the second Overview diagram (`EVAL -->|mutation| MUT[...]`) to show
`mutation` funneling into the shared three-valued `OUTCOME` node like the other
three kinds instead of straight to `UNEV`, and replace the "How each kind is
evaluated" `mutation` bullet's "always resolves to `unevaluable` today" language
with the real survived/threshold/pass rule this change implements — while noting
that persisted per-mutant evidence and the `ratchet init` scaffold remain
follow-on changes. `README.md`'s mutation bullet under "Invariants" is updated
from "evaluation lands in a follow-on change" to state that evaluation is wired:
a survived mutant is a hard fail and too little evaluated evidence is
unevaluable.

## Tasks

- [x] 1.1 In `src/core/eval/invariant-evaluator.ts`: import `runMutationHarness`
      and `type MutationHarnessOutcome` from `./mutation-harness.js` and `type
      Spawner` from `../batch/engine/index.js`; add `spawner?: Spawner` and
      `agentName?: string` to `InvariantEvalContext`; replace the placeholder
      `evaluateMutation` with the real reduction per the Design section
      (survived-first hard fail, then threshold ⇒ unevaluable, then pass; a
      thrown harness call or `unusable-working-tree` ⇒ unevaluable); update the
      switch's `case 'mutation':` to pass `context` through.
- [x] 1.2 In `src/core/eval/invariant-gate.ts`: add `spawner?: Spawner` and
      `agentName?: string` to `InvariantGateInput`, forwarded into the
      `evaluateInvariant` call alongside the existing `bash`/`readFile` forward.
- [x] 1.3 Update the module docstring at the top of `invariant-evaluator.ts` (the
      `mutation` kind's description in the file header) to describe the real
      survived/threshold/pass behavior instead of "schema-only kind".
- [x] 2.1 Rewrite the "mutation (schema-only placeholder)" `describe` block in
      `test/core/eval/invariant-evaluator.test.ts` covering
      `features/mutation-evaluator-fold/mutation-outcome.feature`: all-killed ⇒
      pass; one survived among several ⇒ fail naming the survived mutant; fewer
      than `threshold` evaluated with none survived ⇒ unevaluable citing the
      threshold; `unusable-working-tree` ⇒ unevaluable citing the reason; a
      thrown oracle/harness call ⇒ unevaluable citing that the test command could
      not run, with zero mutants recorded — all via injected fake `bash`/
      `spawner`, no real git or agent spawn. Update the file header to also name
      `features/mutation-evaluator-fold/mutation-outcome.feature`.
- [x] 2.2 Extend `test/core/eval/invariant-gate.test.ts` with a case: an active
      `kind: mutation` invariant evaluated via `evaluateInvariantGate` with
      injected `bash`/`spawner` such that the harness reports a survived mutant,
      asserting the invariant's id lands in `failing` and its outcome status is
      `fail` — proving `spawner` threads from `InvariantGateInput` through to the
      mutation evaluation end-to-end.
- [x] 2.3 Run `pnpm build && pnpm vitest run mutation` and the full suite +
      coverage gate; confirm green at or above the enforced
      `COVERAGE_THRESHOLD`.
- [x] 3.1 (documentation — mandatory, `documentation` standard) Update
      `docs/eval-invariants.md`: the evaluator-dispatch Overview diagram (`MUT`
      node funnels into the shared `OUTCOME` node, not straight to `UNEV`) and
      the "How each kind is evaluated" `mutation` bullet, per the Design section.
- [x] 3.2 (documentation — mandatory) Update `README.md`'s mutation bullet under
      "Invariants" to state that evaluation is wired (survived ⇒ hard fail,
      too-little-evidence ⇒ unevaluable), per the Design section.
