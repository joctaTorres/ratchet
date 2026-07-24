# mutation-invariant-schema

## Why

The `mutation-invariant` phase needs a way to prove a project's test suite
isn't vacuous: seed a small fault, run the user's own tests as the oracle, and
hard-fail if a mutant survives. Before the agent-driven seeding harness, the
evaluator fold, or the `ratchet init` scaffold can be built, the invariant
manifest's typed loader needs a fourth kind — `kind: mutation` — so a
`test`/`budget`/`threshold` entry can be declared and parsed at all. This slice
adds only that: the schema and its type, mirroring how `invariant-manifest-schema`
first shipped `deterministic`/`monotonic`/`snapshot` before anything consumed
them.

## What Changes

This is the schema-only vertical slice of the mutation invariant. It
implements `features/eval-invariants/mutation-kind.feature`:

- Add `MutationInvariantSchema` (`kind: 'mutation'`) to the `InvariantSchema`
  discriminated union in `src/core/eval/invariants.ts`, alongside the existing
  `deterministic`/`monotonic`/`snapshot` members, carrying the shared `id` /
  `active` / optional `description` fields plus three kind-specific required
  fields:
  - `test: string` (min length 1) — the user's test command, the oracle for
    every seeded mutant. No auto-detection: mirrors `check.run` on the
    deterministic kind, which is likewise author-supplied with no inference.
  - `budget: number` (positive integer) — the ceiling on how many mutants are
    seeded per run.
  - `threshold: number` (positive integer) — the floor on how many mutants
    must actually be evaluated (seeded, applied, run against `test` to a
    kill/survive verdict) for the invariant to be evaluable at all.
- Widen the exported `InvariantKind` type to include `'mutation'` and export
  the inferred `MutationInvariant` type, matching the existing per-kind export
  pattern (`DeterministicInvariant` / `MonotonicInvariant` / `SnapshotInvariant`).
- Update the file's module docstring to describe four kinds instead of three.
- No loader-logic change: `loadInvariantManifest`, `ManifestSchema`, and the
  duplicate-id/parse-error handling in `invariants.ts` already validate any
  entry generically through `InvariantSchema.safeParse` — extending the union
  is sufficient for the new kind to be parsed, typed, and fail closed the same
  way the other three are.
- No evaluator *logic* change: seeding mutants via the agent spawn seam, running
  `test`, kill/survive, evidence is the downstream `mutation-oracle-harness` /
  `mutation-evaluator-fold` change. **Correction found during apply:**
  `evaluateInvariant`'s switch in `src/core/eval/invariant-evaluator.ts`
  dispatches on `Invariant`'s discriminated union and TypeScript requires it to
  be exhaustive, so widening `InvariantKind` to include `'mutation'` does force
  one new `case 'mutation':` arm (the build fails with "Function lacks ending
  return statement" otherwise) — the "evaluator stays correct and unaffected"
  claim above was wrong about the switch needing zero touch. The new arm is a
  minimal fail-closed placeholder (`evaluateMutation`, returning `unevaluable`
  with an explicit "not implemented yet" evidence string), not real mutation
  evaluation — it adds no seeding, no spawn, no budget/threshold logic, so the
  downstream harness change's scope is unaffected. Covered by a unit test in
  `test/core/eval/invariant-evaluator.test.ts`.
- Reference documentation: extend `docs/eval-invariants.md`'s manifest-schema
  section with a `### kind: mutation` subsection, and add a `README.md`
  pointer update, per `.ratchet/standards/documentation.md`.

## Design

**Extend the one discriminated union, don't fork it.** `invariants.ts` is
already the single place `InvariantKind` is defined; a fourth kind is a fourth
`z.object({...})` member added to the same `z.discriminatedUnion('kind', [...])`
call, following the exact shape precedent set by `DeterministicInvariantSchema`
/ `MonotonicInvariantSchema` / `SnapshotInvariantSchema`. No new file, no new
loader — the generic per-entry `safeParse` + duplicate-id check in
`loadInvariantManifest` already covers any additional kind without a code
change.

**`test` is a bare command string, not a `check`-style predicate object.** The
deterministic kind's `check: { run, pass }` couples a command to a pass
condition vocabulary (`exit-zero` / `contains:` / `regex:` / substring) because
a deterministic check is itself the pass/fail decision. A mutation invariant's
pass/fail is decided per-mutant by the harness (kill vs survive), not by the
test command's own exit code semantics in isolation — so `test` only needs to
name the oracle command, with no `pass` vocabulary attached. This keeps the
field mirroring `check.run`'s "user-supplied, no auto-detection" contract
(per the done criteria) without inheriting fields it doesn't need.

**`budget` is a ceiling, `threshold` is a floor — two distinct anti-gaming
numbers, not one.** `budget` bounds cost: at most this many mutants are seeded
per run (enforced by the downstream harness). `threshold` is the minimum number
of mutants that must actually reach a kill/survive verdict for the invariant to
be *evaluable*: if the harness can't seed and test at least `threshold` mutants
(e.g. too little surface area, or the harness failing before applying any
fault), the result is `unevaluable` rather than a vacuous pass on zero evidence.
This is deliberately distinct from "any survived mutant is a hard fail," which
concerns the outcome *given* enough mutants ran — `threshold` concerns whether
enough mutants ran at all to trust the outcome. Fixing the exact interaction
(and the runtime `unevaluable`/`skipped` semantics on a no-tests project) is
`mutation-evaluator-fold`'s job; this slice only commits to the field's type
(a positive integer, like `budget`) so the schema is ready for that change to
consume without re-deriving it. Both fields reject zero/negative/non-integer
values the same way (`z.number().int().positive()`), matching the "validated
and typed by the loader" done criterion.

**Ecosystem-agnostic by construction.** `test` is a free-form, user-authored
command string (like `check.run` and `produce.run` already are) — the schema
itself bakes in no package manager, test runner, or toolchain, satisfying
`.ratchet/standards/generalizable-defaults.md` trivially since no default value
is shipped for any of the three new fields (all three are required, none
`.default(...)`).

**Tool-agnostic core.** This slice touches only `src/core/eval/invariants.ts`
(pure schema/type), which is identical for every coding agent. No skill,
command, or template changes, so `.ratchet/standards/multi-agent-support.md` is
not implicated.

**Testing strategy (`testing` standard).** The schema is proven at the
**unit** layer, extending `test/core/eval/invariants.test.ts` (tmpdir fixture
pattern already in place, `afterEach` cleanup) rather than adding a new test
file, since it exercises the same `loadInvariantManifest` entry point. The
test header gains a second line naming
`features/eval-invariants/mutation-kind.feature` alongside the existing
`manifest-loader.feature` reference. Cases cover: a `kind: mutation` entry
exposing `test`/`budget`/`threshold`; a manifest carrying all four kinds
together (proving the new kind doesn't break the existing three); each
required field (`test`/`budget`/`threshold`) missing ⇒ throws
`InvariantManifestError` naming the invariant; and a non-positive `budget` or
`threshold` (0) ⇒ throws. No integration/E2E layer is touched — there is no new
CLI surface in this slice. The full suite and coverage gate stay green at or
above the enforced `COVERAGE_THRESHOLD`.

**Documentation strategy (`documentation` standard).** `docs/eval-invariants.md`
already documents the three existing kinds in a `## Manifest schema` section
with one subsection per kind; this change adds a matching `### kind: mutation`
subsection (fields table + example YAML) in the same style, updates the
"invariant kinds" bullet in the intro and the `kind` field's allowed-values
description to list `mutation`, and extends the first Overview diagram's typed
node label to include `mutation` (that diagram describes what the *loader*
parses, which now includes the new kind) — the second Overview diagram
(evaluator dispatch) and the "How each kind is evaluated" section are left
unchanged, since `evaluateInvariant` doesn't handle `mutation` yet in this
slice and the doc must describe actual, not aspirational, behavior. The new
subsection explicitly notes that evaluation lands in a follow-on change.
`README.md`'s invariants paragraph is updated from "three kinds" to name
`mutation` as a fourth, schema-only-so-far kind. The documentation task is
mandatory and blocking.

## Tasks

- [x] 1.1 In `src/core/eval/invariants.ts`, add `MutationInvariantSchema =
      z.object({ id, kind: z.literal('mutation'), active, description?, test:
      z.string().min(1), budget: z.number().int().positive(), threshold:
      z.number().int().positive() })` and add it as a fourth member of
      `InvariantSchema`'s `z.discriminatedUnion('kind', [...])`.
- [x] 1.2 Widen the exported `InvariantKind` type to
      `'deterministic' | 'monotonic' | 'snapshot' | 'mutation'`, export
      `MutationInvariant = z.infer<typeof MutationInvariantSchema>`, and update
      the module docstring to describe four kinds.
- [x] 2.1 Extend `test/core/eval/invariants.test.ts`: update the file header to
      also name `features/eval-invariants/mutation-kind.feature`; add cases for
      loading a `kind: mutation` entry and asserting `test`/`budget`/`threshold`;
      a manifest with one of each of the four kinds together; each of
      `test`/`budget`/`threshold` omitted ⇒ throws `InvariantManifestError`
      naming the invariant; `budget: 0` and `threshold: 0` ⇒ throws.
- [x] 2.2 Run `pnpm build && pnpm vitest run invariant` and the full suite +
      coverage gate; confirm green at or above the enforced
      `COVERAGE_THRESHOLD`.
- [x] 3.1 (documentation — mandatory, `documentation` standard) Update
      `docs/eval-invariants.md`: add a `### kind: mutation` subsection (fields
      table for `test`/`budget`/`threshold`, example YAML) to `## Manifest
      schema`, update the intro's kind list and the shared-fields `kind` row to
      include `mutation`, and extend the first Overview diagram's typed-set
      node label to `deterministic · monotonic · snapshot · mutation`.
      **Amended during apply:** since the evaluator now has a real (placeholder)
      `mutation` case (see the "Correction found during apply" note above), the
      evaluator-dispatch diagram gained a `MUT` node funneling straight to
      `unevaluable`, and "How each kind is evaluated" gained a short `mutation`
      bullet describing the fail-closed placeholder — both stay accurate to the
      actual code rather than the originally-planned "leave unchanged".
- [x] 3.2 (documentation — mandatory) Update `README.md`'s invariants paragraph
      to name `mutation` as a fourth kind (schema-typed in this change,
      evaluated in a follow-on change) alongside the existing three.
