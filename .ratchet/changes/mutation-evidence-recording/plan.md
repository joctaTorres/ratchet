# Mutation evidence recording

## Why

`evaluateMutation` (`mutation-evaluator-fold`) already reduces the mutation
harness's per-mutant kill/survive results to a `pass`/`fail`/`unevaluable`
outcome, but the mutant's full diff and the oracle's full stdout/stderr are
discarded the instant that reduction happens — `evidence` only carries a
500-character slice of the *first* survivor's diff, and nothing survives to
disk. Worse, `evaluateMutation` runs fresh every time `buildReport` is called
(`report.ts:190`, invoked separately by both `ratchet eval run` and `ratchet
eval report --run <id>` — confirmed by tracing both call sites), so a second
`eval report` on an already-evaluated run **re-spawns the coding agent** and
seeds brand-new mutants instead of replaying what already happened. A survived
mutant — the single most important finding this invariant can produce — is
neither reproducible after the fact nor stable across report calls. This
change makes the harness's per-mutant evidence durable and makes a mutation
invariant's evaluation for a given run idempotent, closing the
`mutation-invariant` phase's definition of done.

## What Changes

Implements
`features/mutation-evidence-recording/replayable-evidence.feature`:

- `InvariantOutcome` (`src/core/eval/invariant-evaluator.ts`) gains an optional
  `artifacts?: MutantEvidence[]` field — present only for a `mutation` outcome
  whose harness run actually seeded at least one mutant — extending the
  existing `evidence`/`measure` fields rather than replacing them, mirroring
  `CaseRecord.artifacts?: WebArtifacts` (`run.ts`).
- `mutation-harness.ts` gains a new exported type, `MutantEvidence`: `{ index,
  outcome, diffPath, testOutputPath }`, the persisted (project-relative) form
  of a `MutantOutcome`'s in-memory `diff`/`testResult`.
- `run.ts` gains the persistence primitives, following the
  `runArtifactsDir`/`persistCaseArtifacts` convention exactly:
  - `invariantArtifactsDir(projectRoot, runId, invariantId)` — the durable
    evidence directory for one invariant's evaluation of one run.
  - `persistMutationEvidence(projectRoot, runId, invariantId, mutants)` —
    writes each mutant's diff and oracle stdout/stderr to disk and returns
    `MutantEvidence[]` with project-relative paths (writes content directly,
    since a mutant's evidence originates as in-memory strings, not — like a
    Playwright trace — a pre-existing file to copy).
  - `persistMutationOutcome` / `loadPersistedMutationOutcome` — round-trip the
    full reduced `InvariantOutcome` (status/measure/evidence/artifacts) for one
    run+invariant, so a later evaluation reads it back verbatim.
- `evaluateMutation` checks for a persisted outcome for `(ctx.run.runId,
  inv.id)` **before** calling `runMutationHarness`; a hit returns it directly —
  no harness call, no agent spawn. A miss runs the harness as today, persists
  every mutant it ran (killed or survived alike) plus the reduced outcome, then
  returns it.
- Reference documentation: `docs/eval-invariants.md` (evaluator-dispatch
  diagram + "How each kind is evaluated" mutation bullet), `docs/
  eval-mutation-harness.md` (cross-reference to the new evidence location), and
  `README.md`'s mutation bullet, per `.ratchet/standards/documentation.md`.
- **Out of scope**: scaffolding an inert `kind: mutation` entry from `ratchet
  init` (`init-mutation-scaffold` — a sibling, not-yet-started change per
  `.ratchet/batches/mature-eval/batch.yaml`); no change to
  `runMutationHarness`'s own seed/detect/classify/revert sequence, to
  `invariant-gate.ts`'s `failing`-collection logic, or to `aggregate.ts`.

## Design

**Persisted evidence lives under the run's own artifacts directory, keyed by
invariant id, not case id.** Cases and invariants are different kinds of
run-level entity, so `invariantArtifactsDir` is a sibling of `runArtifactsDir`,
not a reuse of it: `.ratchet/evals/runs/<runId>/artifacts/invariants/<id>/`
versus `.ratchet/evals/runs/<runId>/artifacts/<caseId>/`. Within it, one
mutant's evidence is two files, `mutant-<index>.diff` (the raw unified diff)
and `mutant-<index>.log` (exit code + stdout + stderr from the oracle run),
plus one `outcome.json` holding the full reduced `InvariantOutcome` — the
manifest that makes evaluation of this run+invariant idempotent.

```ts
// invariant-evaluator.ts — evaluateMutation, restructured
async function evaluateMutation(
  inv: MutationInvariant,
  ctx: InvariantEvalContext
): Promise<InvariantOutcome> {
  const measureBase = `mutation: ${inv.test} (budget ${inv.budget}, threshold ${inv.threshold})`;

  // Reproducible from the run record alone: once this run+invariant has been
  // evaluated, the persisted outcome IS the answer — no agent is re-spawned
  // to re-derive it, e.g. on a second `ratchet eval report --run <id>`.
  const cached = loadPersistedMutationOutcome(ctx.projectRoot, ctx.run.runId, inv.id);
  if (cached) return cached;

  let harnessOutcome: MutationHarnessOutcome;
  try {
    harnessOutcome = await runMutationHarness(inv, ctx.projectRoot, {
      bash: ctx.bash,
      spawner: ctx.spawner,
      agentName: ctx.agentName,
    });
  } catch (err) {
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

  let outcome: InvariantOutcome;
  if (survived.length > 0) {
    const first = survived[0]!;
    outcome = fail(
      inv,
      measure,
      `${survived.length} of ${mutants.length} evaluated mutant(s) survived (e.g. attempt #${first.index}): ${first.diff.slice(0, 500)}`
    );
  } else if (mutants.length < inv.threshold) {
    outcome = unevaluable(
      inv,
      measure,
      `only ${mutants.length} of ${inv.threshold} required mutants reached a kill/survive verdict (budget ${inv.budget}); too few to trust the invariant`
    );
  } else {
    outcome = pass(inv, measure, `all ${mutants.length} evaluated mutant(s) were killed`);
  }

  // Every mutant the harness actually ran gets its evidence persisted,
  // regardless of the final status — a threshold-driven `unevaluable` still
  // ran real mutants worth keeping. No mutant ran ⇒ nothing to persist, and
  // nothing cached, so a later evaluation is free to retry the harness (the
  // working tree, e.g., may be clean by then).
  if (mutants.length > 0) {
    outcome = {
      ...outcome,
      artifacts: persistMutationEvidence(ctx.projectRoot, ctx.run.runId, inv.id, mutants),
    };
    persistMutationOutcome(ctx.projectRoot, ctx.run.runId, inv.id, outcome);
  }

  return outcome;
}
```

**The cache is deliberately scoped to `(runId, invariantId)`, with no
cache-busting knob.** Once a run has been evaluated for a mutation invariant,
that verdict is fixed evidence — exactly like a case's verdict, once written to
`run.verdicts`, never re-derives itself from a later source change. A user who
wants a fresh mutation evaluation starts a new `eval run` (a new `runId`); this
mirrors how `--no-invariants`/promoting a new baseline already work at the
run granularity, not by mutating a past run in place. This boundary is also
what keeps the change thin: no new CLI flag, no change to `execute.ts` or
`report.ts` call ordering — the memoization is entirely internal to
`evaluateMutation`, keyed off state already available on `ctx` (`projectRoot`,
`run.runId`) with zero new parameters threaded through `invariant-gate.ts` or
`report.ts`.

**Only the agent-invoking path is cached — precondition failures recompute
every time.** `unusable-working-tree` and a thrown harness call return before
any mutant is seeded (no agent spawned, nothing expensive to protect), so they
are neither persisted nor cached: `git status --porcelain` is cheap and its
result can genuinely change between calls (e.g. a dirty tree becomes clean),
so recomputing it is correct, not a regression.

**Why writing content, not copying files.** `persistCaseArtifacts` copies
pre-existing files a Playwright run already wrote to disk. A mutant's diff and
oracle output are in-memory strings the harness already holds
(`MutantOutcome.diff` / `.testResult`) — there is no ephemeral file to copy, so
`persistMutationEvidence` writes them directly with `writeFileSync`, returning
the same `{ field: relativePath }` shape `persistCaseArtifacts` returns.

**Ecosystem-agnostic and agent-neutral by construction
(`generalizable-defaults` / `multi-agent-support`).** No new command literal,
toolchain assumption, or agent-specific branch is introduced: the cache check
and the evidence writers are pure filesystem operations over data the
already-agent-neutral `runMutationHarness` produced; `runMutationHarness`
itself is untouched.

**Testing strategy (`testing` standard).** Proven at the **unit** layer, with
one integration-shaped assertion at the gate:

- `test/core/eval/run.test.ts`: new `describe('persistMutationEvidence /
  persistMutationOutcome / invariantArtifactsDir')` covering
  `features/mutation-evidence-recording/replayable-evidence.feature` —
  `persistMutationEvidence` writes one `.diff` + one `.log` file per mutant
  under `invariantArtifactsDir(root, runId, invariantId)` and returns
  project-relative paths whose contents round-trip the mutant's `diff` and
  `testResult`; `persistMutationOutcome`/`loadPersistedMutationOutcome`
  round-trip an `InvariantOutcome` (including `artifacts`) unchanged;
  `loadPersistedMutationOutcome` returns `undefined` when nothing has been
  persisted yet. Isolated via the existing `makeProject()` tmpdir fixture.
- `test/core/eval/invariant-evaluator.test.ts`: extends `describe('evaluateInvariant:
  mutation')` — the three tests whose harness actually seeds mutants (all-killed
  pass, one-survived fail, fewer-than-threshold unevaluable) switch
  `projectRoot: '/p'` to a real `makeProject()` tmpdir (evidence persistence now
  writes real files) and gain assertions that `.artifacts` has one entry per
  evaluated mutant, each `diffPath`/`testOutputPath` resolves under the
  project root to content matching that mutant's diff/oracle output. Two new
  `it`s: (a) evaluating the same invariant twice for the same `run.runId` calls
  the injected `bash`/`spawner` only on the first evaluation (a call-counting
  wrapper proves zero additional invocations) and returns byte-identical
  outcomes, including `artifacts`; (b) evaluating the same invariant for a
  *different* `run.runId` re-invokes the harness and persists evidence under
  the new run id, independent of the first run's evidence. The two tests whose
  harness never seeds a mutant (`unusable-working-tree`, a thrown oracle call)
  keep `projectRoot: '/p'` unchanged — no disk write occurs on those paths —
  and gain an assertion that the outcome carries no `artifacts`.
- `test/core/eval/invariant-gate.test.ts`: extends the existing mutation case
  (`'threads spawner from InvariantGateInput...'`) with an assertion that
  `result.outcomes[0].artifacts` is populated, proving persisted evidence
  surfaces through the gate unchanged.
- Proof of work: `pnpm build && pnpm vitest run mutation` plus the full suite
  and coverage gate green at or above the enforced `COVERAGE_THRESHOLD`.

**Documentation strategy (`documentation` standard).**

- `docs/eval-invariants.md`: in the evaluator-dispatch Overview diagram
  (the `flowchart TD` with `EVAL -->|mutation| MUT[...]`), replace the single
  `MUT --> OUTCOME` edge with a small cache-check sub-flow — `EVAL -->|mutation|
  MUTCACHE{{💾 persisted outcome for this run?}}`, `MUTCACHE -->|✓ hit| MUTHIT[📂
  read outcome.json — no agent spawn]`, `MUTCACHE -->|✗ miss| MUT[🧬 seed · run
  test oracle<br/>kill/survive per mutant]`, `MUT --> MUTSAVE[💾 persist
  diff/output + outcome.json]`, with both `MUTHIT --> OUTCOME` and `MUTSAVE -->
  OUTCOME` — plus a new `classDef cache` (light-blue fill, dark text) applied to
  `MUTCACHE`/`MUTHIT`/`MUTSAVE`. Update the "How each kind is evaluated"
  `mutation` bullet to state that each mutant's diff/oracle output is now
  persisted as run evidence referenced from `InvariantOutcome.artifacts`, and
  that a second evaluation of the same run reads the persisted outcome instead
  of re-running the harness. Remove the "remains a follow-on change" sentence
  under the manifest's `kind: mutation` section (keep the still-true
  `init-mutation-scaffold` follow-on mention).
- `docs/eval-mutation-harness.md`: add one paragraph after "Wired into
  `evaluateInvariant`" cross-referencing that `evaluateMutation` now persists
  every mutant's diff and oracle output under
  `.ratchet/evals/runs/<runId>/artifacts/invariants/<id>/` and memoizes the
  reduced outcome per run, so a survived mutant is replayable from disk and a
  repeated evaluation of the same run never spawns the agent a second time.
- `README.md`: extend the `mutation` bullet under "Invariants" with a short
  clause noting that each mutant's diff/test output is persisted as run
  evidence, reproducible from the run record without re-invoking the agent.

## Tasks

- [x] 1.1 In `src/core/eval/mutation-harness.ts`: add and export `interface
      MutantEvidence { index: number; outcome: 'killed' | 'survived'; diffPath:
      string; testOutputPath: string }`.
- [x] 1.2 In `src/core/eval/run.ts`: import `type { MutantOutcome,
      MutantEvidence }` from `./mutation-harness.js` and `type {
      InvariantOutcome }` from `./invariant-evaluator.js`; add
      `invariantArtifactsDir(projectRoot, runId, invariantId)`,
      `persistMutationEvidence(projectRoot, runId, invariantId, mutants)`
      (writes `mutant-<index>.diff` and `mutant-<index>.log` per mutant,
      returns `MutantEvidence[]` with project-relative paths), and
      `persistMutationOutcome` / `loadPersistedMutationOutcome` (round-trip a
      full `InvariantOutcome` to/from `outcome.json` in the same directory),
      per the Design section.
- [x] 1.3 In `src/core/eval/invariant-evaluator.ts`: add `artifacts?:
      MutantEvidence[]` to `InvariantOutcome` (import `type MutantEvidence`
      from `./mutation-harness.js`); import `persistMutationEvidence`,
      `persistMutationOutcome`, `loadPersistedMutationOutcome` from
      `./run.js`; restructure `evaluateMutation` per the Design section's code
      sketch — check the persisted-outcome cache first, persist every mutant
      the harness ran (regardless of final status) plus the reduced outcome
      when at least one mutant ran, otherwise persist nothing.
- [x] 1.4 Update the module docstring's `mutation` bullet at the top of
      `invariant-evaluator.ts` to describe the persisted-evidence and
      per-run-memoized behavior.
- [x] 2.1 In `test/core/eval/run.test.ts`: add
      `describe('persistMutationEvidence / persistMutationOutcome /
      invariantArtifactsDir')` covering
      `features/mutation-evidence-recording/replayable-evidence.feature` per
      the Testing strategy in the Design section.
- [x] 2.2 In `test/core/eval/invariant-evaluator.test.ts`: update the three
      mutant-seeding tests in `describe('evaluateInvariant: mutation')` to use
      a real `makeProject()` tmpdir and assert `.artifacts`; add the two new
      `it`s for same-run memoization (no second harness/agent call) and
      cross-run independence; assert the two non-seeding tests
      (`unusable-working-tree`, thrown oracle call) carry no `artifacts`.
      Update the file header to also name
      `features/mutation-evidence-recording/replayable-evidence.feature`.
- [x] 2.3 In `test/core/eval/invariant-gate.test.ts`: extend the existing
      mutation-invariant case with an assertion that
      `result.outcomes[0].artifacts` is populated.
- [x] 2.4 Run `pnpm build && pnpm vitest run mutation` and the full suite +
      coverage gate; confirm green at or above the enforced
      `COVERAGE_THRESHOLD`.
- [x] 3.1 (documentation — mandatory, `documentation` standard) Update
      `docs/eval-invariants.md`'s evaluator-dispatch diagram and "How each
      kind is evaluated" mutation bullet, and the manifest section's `kind:
      mutation` paragraph, per the Design section's Documentation strategy.
- [x] 3.2 (documentation — mandatory) Add the evidence cross-reference
      paragraph to `docs/eval-mutation-harness.md`, per the Design section.
- [x] 3.3 (documentation — mandatory) Update `README.md`'s mutation bullet
      under "Invariants" per the Design section.
