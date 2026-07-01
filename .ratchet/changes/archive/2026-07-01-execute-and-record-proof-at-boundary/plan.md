# Execute and record proof-of-work at the phase boundary

## Why

`runProofOfWork` (in `src/core/batch/engine/proof-of-work.ts`) is modeled and
unit-tested but has **no live caller** — the single-step `batch apply` path
advances changes only, so a phase's `proofOfWork` never actually runs. Before the
gate can block a later phase on a real verdict (the sibling change
`gate-next-phase-on-recorded-proof`), the host loop must first *execute* the prior
phase's proof-of-work at the boundary and *record* the outcome durably. This thin
slice makes `batch apply` the live caller and persists the verdict; it deliberately
does **not** yet change gating.

## What Changes

- The host loop (`pickNextStep` / `batchApplyCommand` in
  `src/commands/batch/apply.ts`) becomes `runProofOfWork`'s first live caller:
  when a phase's changes are all done and the next reachable phase has outstanding
  work, `batch apply` runs that prior phase's proof-of-work — resolving cwd, policy,
  and success criteria — **at most once per boundary**, then returns.
- A durable proof-of-work record is added to the batch run journal
  (`src/core/batch/journal.ts`): a new `proof-of-work` journal entry kind carrying a
  `ProofOfWorkRecord` (`phase`, `passed`, `gatePassed`, `policy`, `reason`,
  `detail`), plus a writer and a reader returning the **latest recorded outcome per
  phase** so the verdict survives across the stateless single-step apply invocations.
- Implements
  `features/proof-of-work-boundary/execute-and-record.feature` and
  `features/proof-of-work-boundary/recorded-proof-reader.feature`.
- **Out of scope (sibling changes):** deriving the phase gate from the recorded
  outcome and removing the DEFERRED notes (`gate-next-phase-on-recorded-proof`); the
  blackbox e2e script and fixture (`blackbox-proof-gate-e2e`). This slice records a
  failing proof but does not yet block on it.

## Design

**Boundary selection (host loop, not status).** The definition of done names
`pickNextStep` / `batch apply` as the live caller, so the boundary decision lives in
the selection seam, mirroring the existing `decompose` target. `ApplyTarget` gains a
third variant `{ kind: 'proof-of-work'; phase: Phase }`. `pickNextStep` walks phases
in order; the first ungated phase `Q` that has a runnable change defines the
boundary, and its immediate predecessor `P` (which is `done` — that is *why* `Q` is
ungated) is the phase whose proof must run. If `P` exists and has **no recorded
proof outcome**, `pickNextStep` returns the `proof-of-work` target for `P` *before*
returning `Q`'s change. The first phase (no predecessor) and the "batch fully done"
case yield no boundary, so no proof runs there — consistent with "the next reachable
phase has outstanding work". To keep `pickNextStep` honest about "at most once",
it takes the set of phases that already have a recorded proof (built from the
reader) as an added argument; once `P`'s proof is recorded, the next `apply` skips
straight to `Q`'s change.

**Executing the proof.** `batchApplyCommand` routes a `proof-of-work` target to a
small `runProofAtBoundary` handler that calls the existing
`runProofOfWork(phase.proofOfWork, settings.proofOfWork, projectRoot, phase.success)`.
The cwd is the **project root** and the command is the phase's *configured*
`proofOfWork.run` — no ratchet-specific command, package manager, or test runner is
introduced (`generalizable-defaults`: the executed command is project-derived, never
a baked-in toolchain literal). `integration`/`blackbox` kinds run via the real bash
runner; `llm-judge` without a judge fails closed exactly as today (no judge wiring in
this slice).

**Durable recording + reader.** The batch run journal
(`.ratchet/batches/<name>/run/journal.jsonl`) is the existing durable, append-only
store that already survives across stateless apply invocations, so the verdict lives
there rather than in a new file. `journal.ts` adds:
- `'proof-of-work'` to `JournalEntryKind`;
- an optional `proof?: ProofOfWorkRecord` field on `JournalEntry`, where
  `ProofOfWorkRecord = { phase, passed, gatePassed, policy, reason, detail }` (defined
  in `journal.ts` so the durable record shape stays decoupled from the engine's
  runtime `ProofOfWorkResult`; `apply.ts` maps result → record);
- `proofOfWorkJournalKey(phase)` (mirrors `decompositionJournalKey`) used as the
  entry's `change` key;
- a writer `recordProofOfWork(projectRoot, batch, phase, record)`;
- readers `readLatestProofOfWork(projectRoot, batch, phase)` and
  `readProofOfWorkByPhase(projectRoot, batch)` (latest-per-phase map). "Latest wins"
  falls out of scanning the append-only journal newest-last.

**Standards.**
- `delegated-lifecycle`: executing the gate's proof-of-work and journaling its
  outcome is *orchestration* ("enforce gates, journal outcomes"), explicitly the
  engine/CLI's job — this slice adds no lifecycle instruction text and re-authors no
  transition. No second definition of "done" is introduced.
- `generalizable-defaults`: the boundary runs the phase's own configured command in
  the project root; ratchet ships no default command string.
- `documentation`: a mandatory, non-optional documentation task updates the
  Reference docs that this change makes stale.
- `multi-agent-support`: not applicable — this change adds no agent-facing skill,
  command, or generated artifact; it is pure host-loop/journal logic.

**Why not change the gate now.** Keeping execution+recording separate from gating
(`computeBatchStatus`) keeps this a thin, reviewable vertical slice and leaves the
existing "prior phase all changes done" gate untouched until its dedicated change
flips it onto the recorded `gatePassed`.

## Tasks

- [x] 1.1 Add a failing test (TDD) for the durable proof record: `recordProofOfWork`
      then `readLatestProofOfWork` / `readProofOfWorkByPhase` round-trips a
      `ProofOfWorkRecord` (phase, passed, gatePassed, policy, reason, detail), latest
      recording wins, and unknown phase returns undefined.
- [x] 1.2 Implement in `src/core/batch/journal.ts`: the `'proof-of-work'`
      `JournalEntryKind`, the optional `proof?: ProofOfWorkRecord` field +
      `ProofOfWorkRecord` type, `proofOfWorkJournalKey(phase)`, the
      `recordProofOfWork` writer, and the `readLatestProofOfWork` /
      `readProofOfWorkByPhase` readers; make 1.1 pass.
- [x] 2.1 Add a failing test (TDD) for `pickNextStep`: at a boundary where phase 1 is
      done and phase 2 has work with no recorded proof, it returns a `proof-of-work`
      target for phase 1; once phase 1 is in the recorded-proof set, it returns phase
      2's change; the first phase with no predecessor returns its change (no proof).
- [x] 2.2 Implement the `{ kind: 'proof-of-work'; phase: Phase }` `ApplyTarget`
      variant and the boundary selection in `pickNextStep` (taking the
      already-recorded phases), without altering existing change/decompose selection;
      make 2.1 pass.
- [x] 3.1 Add a failing integration test (real bash, fixture batch) that
      `batchApplyCommand` runs the prior phase's proof-of-work at the boundary and
      journals a `ProofOfWorkResult` (passing command → passed true; failing command
      → passed false with a clear detail), and that a second apply does not re-run it.
- [x] 3.2 Implement `runProofAtBoundary` and route the `proof-of-work` target in
      `batchApplyCommand`: call `runProofOfWork(phase.proofOfWork, settings.proofOfWork,
      projectRoot, phase.success)`, map the result to a `ProofOfWorkRecord`, persist via
      `recordProofOfWork`, render the outcome, and return; make 3.1 pass.
- [x] 4.1 **Documentation (required, non-optional — `documentation` standard).**
      Update `docs/engine/run-state.md` to document the `proof-of-work` journal entry
      kind, the `ProofOfWorkRecord` shape, and the writer/readers; update
      `docs/engine/overview.md` (and `docs/commands/batch.md` if it describes apply's
      step selection) to describe that `batch apply` executes and records the prior
      phase's proof-of-work at the boundary, refreshing the affected flow diagram so it
      stays accurate; update `README.md` if it describes this surface.
- [x] 4.2 Run the full check suite (typecheck, lint, the project's test runner) and
      confirm the new tests and the existing batch-engine/cli-e2e suites pass.
