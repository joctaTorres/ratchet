# validate-proof-conditions-at-load

## Why

`evaluatePassCondition` (`src/core/batch/engine/proof-of-work.ts`) has degenerate
cases that make a `hard-gate` proof-of-work vacuous: an empty `contains:` needle
(`stdout.includes('')` is always true), an empty `regex:` pattern (matches
everything), an invalid regex (silently fails closed with no authoring-time
error), and a manifest whose `run` command merely echoes its own pass phrase.
Nothing validates the *content* of pass conditions at manifest load, so a batch
can ship behind a gate that cannot fail. Fixes #82 (confirmed OPEN and unfixed at
decompose, 2026-07-09).

## What Changes

Implements `features/proof-condition-validation/manifest-load-rejection.feature`
and `features/proof-condition-validation/verdict-matched-evidence.feature`.

- `ProofOfWorkSchema` (`src/core/batch/manifest.ts`) rejects at parse:
  - an empty or whitespace-only `contains:` needle,
  - an empty `regex:` pattern,
  - an invalid `regex:` — the message surfaces the RegExp compile error,
  - the echo-your-own-pass-phrase shape: the literal needle of a `contains:` or
    bare-string pass condition appearing verbatim in the `run` command string.
- Errors flow through the existing `formatManifestIssues` path, so both
  `ratchet validate` and `loadBatchManifest` (the `batch apply` load) reject with
  located, actionable messages — no new plumbing.
- `evaluatePassCondition` additionally reports which condition kind was evaluated
  (`exit-zero` | `contains` | `regex` | `substring`) and, on a pass, the matched
  excerpt (the needle for `contains`/`substring`, the actual matched text for
  `regex`).
- `ProofOfWorkResult` (engine) and the durable `ProofOfWorkRecord`
  (`src/core/batch/journal.ts`) gain optional `conditionKind` /
  `matchedExcerpt` fields; `runProofAtBoundary` (`src/commands/batch/apply.ts`)
  maps them into the journaled record so gate evidence is reviewable.
- Behavioral hardening (not an API break): manifests that previously loaded with
  a degenerate pass condition now fail at load with an actionable error — that
  is the fix. Existing journal records without the new fields stay readable
  (fields are optional; readers ignore absence, no migration).

## Design

**Validate in the schema, not a second pass.** The self-satisfying lint needs
`run` and `pass` together; both live on the same `ProofOfWorkSchema` object, so a
`superRefine` on that schema sees both and every manifest consumer inherits the
validation through `parseBatchManifest` (`BatchManifestSchema.safeParse`). Issues
carry zod paths, so `formatManifestIssues` locates them
(`phases.N.proofOfWork.pass`) with zero changes to the error-reporting seam.

**Reject, don't warn.** The phase success criteria require these shapes
*rejected* at manifest load, and `parseBatchManifest` is a pure parser with no
warning channel — fail-closed rejection is both the mandated and the thinnest
design. The lint is scoped tightly to avoid false positives: exit-zero
directives are exempt (they never substring-match stdout), and `regex:` patterns
are exempt (a pattern appearing in `run` is not the echo shape); only the
literal needle of `contains:`/bare-string conditions is checked against `run`.

**Evidence is additive.** `PassEvaluation` grows `conditionKind` and optional
`matchedExcerpt`; regex evaluation switches from `.test()` to `.exec()` to
capture the matched text. The eval-side callers (`src/core/eval/judge.ts`,
`src/core/eval/invariant-evaluator.ts`) read only `passed`/`reason`, so the
extension is backward-compatible. Runtime evaluation keeps its silent fail-closed
behavior for invalid regexes as a backstop — load validation now makes that
branch unreachable for manifests, while eval-authored checks still benefit from
it.

**Testing standard.** All new behavior is provable at the unit level (pure
schema parse and pure evaluator over in-memory inputs — no filesystem, no
spawn), per the test-pyramid rule; the one disk-touching scenario
(`loadBatchManifest` rejection) reuses the existing tmpdir fixture pattern. New
suites live under `test/batch-engine/` so the phase proof-of-work
(`npm test -- test/batch-engine/`) exercises them.

**Documentation standard.** This change alters user-facing manifest validation
and the journaled record shape, so per the `documentation` standard the docs
task below is mandatory: `docs/commands/batch.md` (pass-condition authoring +
load-time validation rules) and `docs/engine/run-state.md` (the
`ProofOfWorkRecord` shape) are updated in this change.

## Tasks

- [x] 1.1 Write failing unit tests in `test/batch-engine/proof-condition-validation.test.ts` covering every scenario in `manifest-load-rejection.feature`: empty/whitespace `contains:` needle rejected, empty `regex:` rejected, invalid `regex:` rejected with compile error surfaced, echo-shape `contains:` and bare-string conditions rejected, exit-zero prose and well-formed conditions load, and `loadBatchManifest` (tmpdir fixture) rejects identically
- [x] 1.2 Implement the `superRefine` on `ProofOfWorkSchema` in `src/core/batch/manifest.ts` (empty-needle, empty/invalid regex with compile error, self-satisfying needle-in-run lint) with located, actionable messages; tests from 1.1 go green
- [x] 2.1 Extend `test/batch-engine/proof-of-work.test.ts` with the `verdict-matched-evidence.feature` scenarios: `conditionKind` for exit-zero/contains/regex/substring, `matchedExcerpt` on pass (regex excerpt is the actual matched text), no excerpt on fail
- [x] 2.2 Implement `conditionKind`/`matchedExcerpt` in `evaluatePassCondition` and thread them through `runProofOfWork` into `ProofOfWorkResult` (`src/core/batch/engine/proof-of-work.ts`)
- [x] 2.3 Add optional `conditionKind`/`matchedExcerpt` to `ProofOfWorkRecord` (`src/core/batch/journal.ts`), map them in `runProofAtBoundary` (`src/commands/batch/apply.ts`), and assert the journaled record carries them in `test/batch-engine/proof-of-work-journal.test.ts`
- [x] 3.1 Documentation (per the `documentation` standard, mandatory): update `docs/commands/batch.md` with the load-time pass-condition validation rules (empty/invalid/self-satisfying shapes and their errors) and `docs/engine/run-state.md` with the new `ProofOfWorkRecord` fields
- [x] 3.2 Run `npm test -- test/batch-engine/` (the phase proof-of-work) and `npm test -- test/core/batch/manifest.test.ts`; confirm exit code 0 with the new suites green
