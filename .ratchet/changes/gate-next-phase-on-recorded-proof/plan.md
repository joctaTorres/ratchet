# Gate the next phase on the recorded proof-of-work outcome

## Why

The sibling change `execute-and-record-proof-at-boundary` made `batch apply` the
live caller of `runProofOfWork`: it now *runs* the prior phase's proof-of-work at
the boundary and *journals* a durable `ProofOfWorkRecord` (with `gatePassed`). But
the gate that decides whether the next phase may be entered still keys off "prior
phase all changes done" alone and never consults that recorded verdict — so under
`proofOfWork: hard-gate` a recorded **failing** proof is journaled with a clear
detail yet does not block progression. Two DEFERRED notes (`status.ts`,
`proof-of-work.ts`) mark this gap. This change closes it: the gate derives from the
recorded `gatePassed`, making `hard-gate` real rather than declarative.

## What Changes

- `computeBatchStatus` (`src/core/batch/status.ts`) derives each phase's
  prior-phase gate from the **recorded proof outcome** for the immediately
  preceding phase, not from "all changes done" alone: a phase whose predecessor is
  done but whose recorded boundary proof has `gatePassed: false` is `blocked`, and
  its `gatedBy` cites the failing proof. A predecessor that is done with **no**
  recorded proof yet keeps the gate open (so the boundary proof step can run), and
  a recorded `gatePassed: true` keeps it open.
- `pickNextStep` (`src/commands/batch/apply.ts`) consumes the proof-derived `gated`
  flag, so it refuses to select a change in a proof-blocked phase. When no step is
  runnable because a phase is proof-blocked, `batch apply`'s "no step" output cites
  the failing proof rather than the generic "everything is blocked, gated, or
  parked" message.
- `selectRunnableStep` (`src/core/batch/engine/selection.ts`) continues to gate on
  the single `gated` input that callers populate from `computeBatchStatus`, so
  status and selection agree on the proof-derived gate by construction. Its
  doc-comment is updated to record that `gated` now folds in the recorded proof.
- A small shared, pure reader derives the latest-per-phase proof records from a
  `JournalEntry[]` so `computeBatchStatus` (which already receives the run journal)
  derives the gate from the same entries it is given, with no extra disk read.
- The two **DEFERRED (by design)** notes in `status.ts` (`computeBatchStatus`) and
  `proof-of-work.ts` (`runProofOfWork`) are removed and their prose updated to
  describe the now-live gate.
- **Out of scope (sibling change):** the blackbox e2e driver/fixture
  (`test/e2e/proof-of-work-gate.sh`) that proves this end-to-end through the real
  `batch apply` belongs to `blackbox-proof-gate-e2e`. This change ships the gating
  logic and its integration tests.

## Design

**Where the gate lives — one source, two consumers.** The gate decision is
centralized in `computeBatchStatus`, exactly as it is today: it walks phases in
order and sets each phase's `gated` / `gatedBy`. `pickNextStep` reads that derived
`gated`; `selectRunnableStep` receives `gated` as an input its callers populate
from the same `computeBatchStatus` output (this is the existing pattern — the
`selectableFor` test helper feeds `gated` straight from `status.phases[i].gated`).
Centralizing keeps status and selection in agreement **by construction**: there is
one gate rule, and both selection seams read its result rather than re-deriving it.

**The proof-aware gate rule.** Today: `priorPhaseDone = phaseStatus.status ===
'done'`, and the next phase's `gated = !priorPhaseDone`. New rule, given the prior
phase `P`'s latest recorded proof `rec`:

- `P` not done → next phase gated (unchanged — the prior phase still has work).
- `P` done, **no** `rec` yet → gate **open**. The boundary proof has not run; the
  phase is reachable so `pickNextStep` can return `P`'s `proof-of-work` boundary
  step (the sibling's behavior). The gate is not asserted before a verdict exists.
- `P` done, `rec.gatePassed === true` → gate **open** (passed, or `warn` — see
  below). The next phase advances.
- `P` done, `rec.gatePassed === false` → gate **closed**: next phase `blocked`,
  `gatedBy` citing `P`'s failing proof and its `detail`.

Because `gatePassed = passed || policy === 'warn'` (computed in
`runProofOfWork`/`applyPolicy` and persisted on the record), `warn` always records
`gatePassed: true` — so a failing proof under `warn` never closes the gate; the
failure is surfaced when the boundary proof runs (the sibling's `renderProofOutcome`
already prints `⚠ failed (warn)`), and the phase advances. No policy branching is
needed in the gate itself: consulting `gatePassed` expresses both policies.

**Deriving the records.** `computeBatchStatus` already takes the run `journal:
JournalEntry[]` (defaulting to `readJournal(projectRoot, manifest.name)`). The
proof records are journal entries (`kind: 'proof-of-work'`, carrying `proof`). To
avoid a second disk read and to keep the function honest about deriving only from
the journal it is given, `journal.ts` adds a pure
`proofRecordsFromEntries(entries): Map<phase, ProofOfWorkRecord>` (latest-wins by
append order), and `readProofOfWorkByPhase` is refactored to call it over
`readJournal(...)`. `computeBatchStatus` derives the per-phase map from its
`journal` param via the same helper, so the injected-journal tests stay
deterministic.

**Gate reason / clear report.** `PhaseStatusInfo.gatedBy` stays `string | undefined`
and is set to a message that cites the failing proof, e.g.
`p1 — proof-of-work failed: <detail>`, so `ratchet batch status` and the apply
"no step" output both render a report that names the blocking proof. `batch apply`'s
no-target branch inspects the derived status for a phase blocked by a failing proof
and prints that reason instead of the generic gated message.

**Standards.**
- `delegated-lifecycle`: this is **orchestration** — "enforce gates, journal
  outcomes" — explicitly the engine/CLI's job, not lifecycle authoring. The change
  adds no inline lifecycle prompt and re-authors no transition. It also introduces
  no second definition of "done": the journal-aware done-rule from phase 2 is
  untouched; the proof gate is a separate *phase-entry* gate layered on top, and it
  is computed in one place (`computeBatchStatus`) and honored by both selection
  seams — "done has one definition", and so does the gate.
- `generalizable-defaults`: the gate consults the **recorded verdict** only; it
  introduces no command, package manager, test runner, or toolchain literal. The
  proof command itself remains the phase's own configured `proofOfWork.run` (run by
  the sibling change). No ratchet-specific default is shipped here.
- `documentation`: a mandatory, non-optional documentation task (below) updates the
  Reference docs this change makes stale — the gating now consults the recorded
  proof, which `docs/engine/run-state.md`, `docs/engine/overview.md`, and
  `docs/commands/batch.md` currently describe as deferred/declarative — and
  refreshes the affected gating/flow diagram so it stays accurate.
- `multi-agent-support`: **not applicable** — this change adds no agent-facing
  skill, command, template, or generated artifact; it is pure host-loop /
  status / selection logic with no per-agent surface to enumerate.

**Why not branch on policy in the gate.** Folding `warn` into the recorded
`gatePassed` keeps the gate a single boolean check and removes any chance of the
gate and the recorder disagreeing about what `warn` means — the recorder already
encoded the policy when it wrote `gatePassed`.

## Tasks

- [x] 1.1 Add a failing test (TDD) for the pure record reader: `proofRecordsFromEntries`
      returns the latest-per-phase `ProofOfWorkRecord` from a `JournalEntry[]`
      (latest append wins; non-proof entries ignored; unknown phase absent).
- [x] 1.2 Implement `proofRecordsFromEntries(entries)` in `src/core/batch/journal.ts`
      and refactor `readProofOfWorkByPhase` to delegate to it; make 1.1 pass without
      regressing the existing proof-journal tests.
- [x] 2.1 Add a failing test (TDD) for the proof-aware gate in `computeBatchStatus`:
      with phase `p1` done and `p2` outstanding under `hard-gate` — (a) no recorded
      proof → `p2` not blocked on a proof; (b) recorded `gatePassed:false` → `p2`
      `blocked` with `gatedBy` citing `p1`'s failing proof; (c) recorded
      `gatePassed:true` → `p2` not blocked; (d) later passing record overrides an
      earlier failing one; (e) under `warn`, a `passed:false`/`gatePassed:true` record
      leaves `p2` unblocked.
- [x] 2.2 Implement the proof-aware gate in `computeBatchStatus`: derive the
      per-phase record map from the `journal` param via `proofRecordsFromEntries`, and
      gate the next phase on `priorPhaseDone && (no record || record.gatePassed)`,
      setting `gatedBy` to cite the failing proof's detail when closed; make 2.1 pass.
- [x] 3.1 Add a failing test (TDD) that `pickNextStep` and `selectRunnableStep` agree
      with the proof-aware status: a recorded failing `hard-gate` proof for `p1` makes
      `pickNextStep` return no `p2` change (and surfaces the proof-blocked reason),
      while a recorded passing proof returns `p2`'s outstanding change; assert
      `selectRunnableStep` over the same derived `gated` agrees.
- [x] 3.2 Make `batch apply`'s no-target branch cite the failing proof when a phase is
      proof-blocked (instead of the generic gated message), and update
      `selectRunnableStep`'s doc-comment to record that `gated` now folds in the
      recorded proof; make 3.1 pass.
- [x] 4.1 Remove the **DEFERRED (by design)** note in `computeBatchStatus`
      (`src/core/batch/status.ts`) and update its docstring to describe the now-live
      proof-derived gate; remove the matching DEFERRED note in `runProofOfWork`
      (`src/core/batch/engine/proof-of-work.ts`) and update its prose to say the
      verdict is now gated on.
- [x] 4.2 **Documentation (required, non-optional — `documentation` standard).**
      Update `docs/engine/run-state.md` to state the proof-of-work record now drives
      the phase gate (not just recorded); update `docs/engine/overview.md` and
      `docs/commands/batch.md` to describe that `batch apply` blocks entry into the
      next phase when the prior phase's recorded `hard-gate` proof failed (and that
      `warn` advances while surfacing it), refreshing the affected gating/flow diagram
      so it stays accurate; update `README.md` if it describes this surface.
- [x] 4.3 Run the full check suite (typecheck, lint, the project's test runner) and
      confirm the new tests and the existing batch-engine / cli-e2e suites pass.
