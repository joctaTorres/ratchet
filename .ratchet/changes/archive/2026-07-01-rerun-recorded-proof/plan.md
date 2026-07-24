# Re-run a recorded boundary proof-of-work

## Why

The batch proof-of-work gate runs each phase's boundary proof at most once and
journals a durable `ProofOfWorkRecord`; once recorded, the gate reads that verdict
and never re-runs the proof. There is no supported way to re-run or invalidate a
recorded proof, so a verdict recorded `FAILED` for a fixable reason (a misconfigured
`pass` condition, a flaky run, an env fix) permanently blocks the next phase — the
only workaround is hand-deleting the entry from the append-only `run/journal.jsonl`,
which is not a supported interface. This change adds a first-class verb to invalidate
a phase's recorded proof so the next `batch apply` re-runs the boundary.

## What Changes

Implements `features/rerun-recorded-proof/cli-surface.feature` and
`features/rerun-recorded-proof/invalidation-folding.feature`.

- **New CLI verb `ratchet batch rerun-proof [name] --phase <phase>`.** Resolves the
  batch via the existing `resolveBatchName` (optional `[name]`, like `batch status`/
  `report`/`apply`); `--phase` is required (like `report`'s required `--change`).
  It validates that `<phase>` exists in the manifest, then appends a **superseding
  invalidation marker** for that phase to the run journal so the next `batch apply`
  re-runs the phase's configured boundary proof-of-work. Supports `--json`. When no
  proof is recorded for the phase, it is a no-op that says so and leaves the journal
  unchanged.
- **New append-only journal marker.** Add a `JournalEntryKind` value
  `'proof-of-work-invalidated'` and a `recordProofOfWorkInvalidation(projectRoot,
  batch, phase)` helper in `src/core/batch/journal.ts` that appends the marker keyed
  by `proofOfWorkJournalKey(phase)`. The journal stays append-only — nothing is
  rewritten or deleted.
- **Fold the marker through the single record reader.** `proofRecordsFromEntries`
  (the one folder both the gate and selection read) is taught to **delete** a phase
  from the latest-per-phase map when it encounters an invalidation marker in append
  order. A later real `proof-of-work` record re-adds the phase. This keeps the
  existing "one source, two consumers" invariant: `computeBatchStatus` (the phase
  gate) and `readProofOfWorkByPhase`/`pickNextStep` (boundary-step selection) both
  honor the invalidation by construction, with no extra disk read.
- **New command file** `src/commands/batch/rerun-proof.ts`, exported from
  `src/commands/batch/index.ts`, wired as a `batchCmd` subcommand in
  `src/cli/index.ts` under `helpGroup('Workflow:')`.
- **Documentation** (`docs/commands/batch.md`, engine run-state/overview docs,
  `README.md`) updated per the `documentation` standard (see Tasks 4.x).

## Design

### Chosen approach — Option A (manual override verb); Option B considered and deferred

Two designs were weighed:

- **(A, chosen) An explicit operator verb** that invalidates/re-runs a phase's
  recorded proof. It directly closes the stated gap (a *supported* interface
  replacing manual journal surgery), is focused and orthogonal to the gate logic,
  and fits the append-only journal model cleanly.
- **(B, deferred) Auto-invalidate when the phase's `proofOfWork` config changes** —
  hash the manifest's `proofOfWork` block, store the hash on the record, and re-run
  when the current hash differs. B is attractive because it automatically handles the
  real-world "I fixed the `pass` condition" case, but it enlarges scope: it changes
  the on-disk `ProofOfWorkRecord` schema (a new hash field), touches the boundary
  recorder in `apply.ts`, and needs a stable canonical hash of the config block. That
  is a separable, larger surface.

A and B are **complementary, not competing**: A is a manual override; B is automatic
safety. This change ships A only and records B as future work. A is sufficient to
unblock the dogfooded failure (the operator fixes the cause, runs one command, and
`batch apply` re-runs the boundary), and it composes with B later — B would simply be
another producer of the same invalidation effect A introduces.

### Append-only invalidation, not journal surgery

The run journal is append-only (`appendJournal` only ever appends; status and
selection fold the full log). The verb therefore must **supersede**, not edit. It
appends a `proof-of-work-invalidated` marker keyed by the same
`proofOfWorkJournalKey(phase)` the recorder uses. The original `proof-of-work` entry
is left in place — the audit trail is preserved — and the fold simply treats the
later marker as removing the phase from the *current* record map.

### One source, two consumers — preserved by construction

`proofRecordsFromEntries(entries): Map<phase, ProofOfWorkRecord>` is the single fold
that both gate and selection consume:

- `computeBatchStatus` derives each phase's gate from the prior phase's record: no
  record → gate **open** (boundary may run); `gatePassed: false` → gate **closed**.
- `pickNextStep` builds `recordedProofPhases = new Set(proofByPhase.keys())` and
  returns the predecessor's boundary `proof-of-work` step only when the predecessor
  is **not** in that set.

Folding invalidation inside `proofRecordsFromEntries` means both consumers see the
phase disappear from the map after a marker: the gate re-opens, and selection re-offers
the boundary step — automatically, with no second code path and no extra disk read.
The fold is order-sensitive (`record` adds, `invalidated` deletes, a newer `record`
re-adds), exactly mirroring the existing "latest append wins" semantics. After the
boundary re-runs, a fresh `proof-of-work` record is appended and the gate derives from
that newest verdict.

### CLI shape

Mirrors `batch report` (the closest existing command: batch + a required key flag +
`--json`). `batchRerunProofCommand(name, options)` resolves the batch, requires
`options.phase`, loads the manifest to validate the phase name, reads the current
folded records to decide recorded-vs-absent, appends the marker when present, and
renders a text or `--json` result. No interactive prompt — invocation is a single
shell command, consistent with the rest of the batch surface.

### Standards

- **`documentation` (followed; mandatory non-optional task — see Tasks 4.x).** The
  verb is a new user-facing CLI surface, so the Reference docs change in lockstep:
  `docs/commands/batch.md` gains a `## batch rerun-proof` section (placed near
  `batch report`/`batch apply`); the engine proof recording/gating docs
  (`docs/engine/run-state.md` and/or `docs/engine/overview.md`) gain the fact that a
  recorded proof can be superseded by an invalidation marker so the boundary re-runs,
  with the affected gating/flow diagram refreshed (kept vertical, high-contrast, every
  `classDef` carrying a `color:`, and accurate to the new fold); `README.md` is
  updated if it lists batch verbs. This task references the `documentation` standard
  and is a required, blocking task on the same footing as implementation and tests.
- **`delegated-lifecycle` (followed — orchestration framing).** This is engine/CLI
  **orchestration** ("enforce gates, journal outcomes"), not lifecycle authoring. The
  verb only appends a journal marker that changes which boundary step the orchestrator
  next offers; it spawns no agent, re-authors no propose/apply/verify transition, and
  adds **no second definition of done**. The boundary proof still runs via the
  existing `runProofAtBoundary` path. There is one gate rule and one record fold;
  both consumers continue to read them.
- **`generalizable-defaults` (followed).** No toolchain literal is shipped. The
  re-run executes the phase's own configured `proofOfWork.run`; the verb embeds no
  package manager, test runner, build tool, or command string. The invalidation
  marker carries only the phase name.
- **`multi-agent-support` (NOT APPLICABLE — declared).** This adds a CLI verb and
  journal/fold logic only; it does not add or modify a generated per-agent
  skill/command/template artifact and does not touch the command-generation or
  template surface (`src/core/command-generation/`, `src/core/templates/`). There is
  no agent-facing generated artifact and therefore no per-agent output to enumerate,
  so the standard is N/A. (The verb name is invoked by a human or a script via the
  CLI, identically regardless of which coding agent drives ratchet — tool-agnostic by
  default.)

## Tasks

- [x] 1.1 Add a failing test (TDD) for `proofRecordsFromEntries`: a
      `proof-of-work-invalidated` marker for a phase deletes that phase from the
      folded map; a later `proof-of-work` record for the same phase re-adds it;
      invalidation is scoped to its own phase (a sibling phase's record is untouched).
      Covers `features/rerun-recorded-proof/invalidation-folding.feature`.
- [x] 1.2 Add `'proof-of-work-invalidated'` to `JournalEntryKind`, a
      `recordProofOfWorkInvalidation(projectRoot, batch, phase)` helper that appends
      the marker keyed by `proofOfWorkJournalKey(phase)`, and teach
      `proofRecordsFromEntries` to delete the phase from the map on that marker
      (preserving append-order semantics). Make 1.1 pass without regressing existing
      proof-journal tests.
- [x] 2.1 Add a failing test (TDD) that the gate and selection re-open after
      invalidation: with `p1` done and a recorded failing `hard-gate` proof (so `p2`
      is blocked), appending an invalidation marker makes `computeBatchStatus` report
      `p2` no longer proof-gated, and `pickNextStep` returns `p1`'s boundary
      proof-of-work step before any `p2` change.
- [x] 2.2 Confirm the gate/selection re-open works end-to-end against the existing
      `computeBatchStatus` and `pickNextStep` (no changes expected beyond the fold
      from 1.2, since both already read `proofRecordsFromEntries`); make 2.1 pass.
- [x] 3.1 Add a failing test (TDD) for `batchRerunProofCommand`: invalidates a
      recorded proof (failing or passing) by appending a marker and reports success;
      errors on a missing `--phase`; errors on an unknown phase; is a no-op that says
      so when no proof is recorded; resolves the batch name when omitted; emits the
      documented `--json` object. Covers
      `features/rerun-recorded-proof/cli-surface.feature`.
- [x] 3.2 Implement `src/commands/batch/rerun-proof.ts`
      (`batchRerunProofCommand(name, options)` + `BatchRerunProofOptions`), export it
      from `src/commands/batch/index.ts`, and wire the
      `batch rerun-proof [name] --phase <phase> [--json]` subcommand into `batchCmd`
      in `src/cli/index.ts` under `helpGroup('Workflow:')`. Make 3.1 pass.
- [x] 4.1 **Documentation (required, non-optional — `documentation` standard).** Add a
      `## batch rerun-proof` section to `docs/commands/batch.md` (synopsis, `--phase`
      required, `--json`, name resolution, behavior: appends a superseding
      invalidation marker so the next `batch apply` re-runs the boundary; no-op when
      nothing is recorded). Update `docs/engine/run-state.md` and/or
      `docs/engine/overview.md` to state a recorded proof can be superseded by an
      invalidation marker (append-only) so the boundary proof re-runs and the gate
      re-derives from the next verdict; refresh the affected proof recording/gating
      diagram so it stays accurate (vertical, high-contrast, every `classDef` sets a
      `color:`). Update `README.md` if it enumerates batch verbs.
- [x] 4.2 Run the full check suite (typecheck, lint, the project's test runner) and
      confirm the new tests plus the existing batch-engine, journal, status/selection,
      and cli-e2e suites pass.
