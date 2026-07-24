# A reachable empty phase is an outstanding decomposition step, not done

## Why

`ratchet batch apply` reports a multi-phase batch `done` while later phases are
still undecomposed (#30). The cause is that the engine's done arithmetic counts
only DECLARED change intents:

- `computeBatchStatus` in `src/core/batch/status.ts` (~line 345) sets the batch
  `status = 'done'` when `doneCount === changeCount`, and both counts are derived
  purely from `phase.changes` (the loop at ~line 324 iterates `phase.changes`). A
  phase with an empty `changes` list contributes ZERO to `changeCount` and
  `doneCount`. So the moment the first phase's declared changes are done,
  `doneCount === changeCount` holds and the batch is reported `done` — even though
  later phases have no concrete change intents yet.
- `selectRunnableStep` in `src/core/batch/engine/selection.ts` (~line 63)
  computes `allDone = phases.every((p) => p.changes.every((c) => c.done))`. An
  empty phase satisfies `[].every(...)` VACUOUSLY, so selection returns
  `all-done` for the same false-done state. Status and selection agree — both
  wrongly — that there is nothing left to do.

Note `derivePhaseStatus` already does the right thing at the PHASE level:
`allDone = changes.length > 0 && changes.every(...)`, so an empty phase is itself
`pending`, not `done`. But that fact never reaches the batch-level done rule or
selection. The batch is genuinely `done` only once EVERY reachable phase is
decomposed (has concrete change intents) AND all those changes are done.

## What Changes

This is the THIN recognition slice of the `native-lazy-decomposition` phase. It
makes status and selection treat a ready, ungated phase with empty `changes` as
an **outstanding decomposition step** — not terminal — so the batch is not
reported `done` and there is a step to act on. The follow-on change
(`drive-decomposition-step`, which is `after: [empty-phase-is-not-done]`) does
the actual spawning that authors the empty phase's concrete intents. This change
authors NO lifecycle instruction text and spawns NO agent — it only fixes the
done/selection arithmetic (`delegated-lifecycle`: the CLI orchestrates, it does
not re-author).

- **One "reachable phase decomposed" predicate.** A phase is *undecomposed* when
  its `changes` list is empty. A phase is *reachable* when it is ungated (every
  prior phase is `done`). A reachable-but-undecomposed phase is outstanding work.
- **Batch `done` accounts for undecomposed phases.** `computeBatchStatus` reports
  `done` only when `doneCount === changeCount` AND no reachable phase is
  undecomposed. A reachable empty phase keeps the batch out of `done` (in-progress
  / pending as appropriate).
- **`next` / selection surface the empty phase.** `computeBatchStatus.next` and
  `selectRunnableStep` recognize the first reachable undecomposed phase as the
  outstanding step (a decomposition step) instead of skipping it (status `next`
  loops only over `phase.changes`; selection's vacuous `allDone` hides it). A
  still-gated empty phase is NOT surfaced yet — the unfinished prior-phase change
  is selected first.
- **No regressions.** A fully-decomposed batch with all changes done still
  reports `done` and yields `all-done`; ready / blocked / in-progress /
  awaiting-verify derivations from `journal-aware-done` are untouched.

Implements `features/lazy-decomposition/empty-phase-not-done.feature` and
`features/lazy-decomposition/status-selection-recognize-decomposition.feature`.

## Design

- **Status seam (`src/core/batch/status.ts`).** In `computeBatchStatus`, after the
  per-phase derivation loop, identify reachable undecomposed phases: a phase whose
  `phase.changes.length === 0` and whose derived `PhaseStatusInfo.gated === false`.
  Fold that into the final `status` decision so the batch is `done` ONLY when
  `changeCount > 0 && doneCount === changeCount && no reachable undecomposed phase`
  — otherwise `in-progress` (there is decomposition work) rather than `done`. Set
  `next` to the first reachable undecomposed phase when no change-level `next` was
  found (surface it as a phase-scoped step; the concrete `change` is authored by
  the follow-on change, so model `next` to carry the phase here without inventing
  lifecycle semantics). Keep the existing `empty` batch case (no phases / all
  phases empty AND none reachable-with-prior-done — i.e. a brand-new batch) intact.
- **Selection seam (`src/core/batch/engine/selection.ts`).** Teach
  `SelectablePhase` whether it is decomposed (e.g. a `decomposed: boolean` derived
  from `changes.length > 0`, set by the caller that builds `SelectablePhase`s).
  Fix the vacuous `allDone`: a reachable (ungated) phase that is not decomposed is
  outstanding, so `allDone` must be false. In the phase loop, when an ungated phase
  is undecomposed return it as the selected step (model a decomposition step —
  `change` optional / a `decompose` marker — keeping `SelectedStep` minimal; the
  follow-on change consumes this to spawn). A gated undecomposed phase is skipped
  exactly like gated work today (it contributes to `all-gated`, not a runnable
  step). Update `NoStepReason` usage so `all-done` is returned only when every
  reachable phase is decomposed and all changes done.
- **Agreement by construction.** Both seams key off the same two facts —
  "phase decomposed?" (`changes.length > 0`) and "phase reachable?" (ungated) — so
  status and selection cannot disagree about whether a reachable empty phase is
  outstanding (the single-source-of-truth discipline `delegated-lifecycle`
  requires for "done").
- **Thin slice / non-goals.** No agent spawn, no `batch.yaml` authoring, no
  transition changes — `computeNextTransition` / `isChangeDone` in
  `transition.ts` are unchanged (they are per-change; decomposition is per-phase).
  The actual decomposition run is `drive-decomposition-step`.

## Tasks

- [x] In `src/core/batch/status.ts`, derive whether each phase is *reachable and
      undecomposed*: `phase.changes.length === 0` AND the phase's derived
      `gated === false`. (Phase-level `derivePhaseStatus` already reports such a
      phase as `pending`, not `done`; this task surfaces it to the batch level.)
- [x] In `computeBatchStatus`, change the batch `done` rule so it is `done` ONLY
      when `changeCount > 0 && doneCount === changeCount` AND there is no reachable
      undecomposed phase; a reachable undecomposed phase yields `in-progress`
      instead of `done`. Preserve the existing `empty` case for a brand-new batch
      with no actionable phase.
- [x] In `computeBatchStatus`, set `next` to the first reachable undecomposed
      phase as the outstanding decomposition step when no change-level `next` is
      found, so the apply loop has a step to act on (without authoring lifecycle
      text here).
- [x] In `src/core/batch/engine/selection.ts`, add a `decomposed` signal to
      `SelectablePhase` (derived from `changes.length > 0`) and fix
      `selectRunnableStep`: a reachable (ungated) undecomposed phase makes
      `allDone` false and is returned as the selected decomposition step; a gated
      undecomposed phase is skipped (counts toward `all-gated`); `all-done` is
      returned only when every reachable phase is decomposed and all changes done.
- [x] Ensure status and selection agree by construction (both key off
      `changes.length > 0` for "decomposed" and the phase's ungated/reachable
      state) so neither reports finished while the other has a decomposition step.
- [x] Add tests under `test/batch-engine/` (e.g.
      `empty-phase-is-not-done.test.ts`) using a fixture batch with a fully-done
      first phase and an empty later phase, asserting: (a) `computeBatchStatus`
      does NOT report `done` and surfaces the empty phase as outstanding;
      (b) `selectRunnableStep` does NOT return `all-done` and surfaces the empty
      phase as the decomposition step; (c) a gated empty phase is not selected
      while the prior phase still has an unfinished change; (d) a fully-decomposed,
      all-done batch still reports `done` and `all-done`; (e) no regression of the
      `journal-aware-done` ready/blocked/in-progress/awaiting-verify states.
- [x] Run `pnpm vitest run test/batch-engine` and confirm exit code 0 — the phase
      proof-of-work: a fixture batch with an empty later phase is NOT reported done
      after the first phase, and status stays not-done until every reachable phase
      is decomposed and its changes done.
- [x] **Documentation (mandatory — `documentation` standard).** This change alters
      `batch status` semantics (a previously-done batch with a later empty phase is
      now not-done), so update these specific docs (named, not "any reference"):
      - `docs/commands/batch.md` — the **batch status / lifecycle section**: document
        that a multi-phase batch is `done` only once every reachable phase is
        decomposed AND all changes done; a ready phase with empty `changes` is an
        outstanding decomposition step, not terminal.
      - `docs/engine/overview.md` — update the **lifecycle/phase flowchart** and the
        status reference so they show the reachable-empty-phase decomposition step
        between "phase changes done" and batch "done" (vertical, high-contrast,
        every `classDef` sets `color:`); a stale diagram is a documentation defect.
      No new CLI command/flag/config key is added; update `README.md` only if it
      describes when a batch is considered done/complete — otherwise state
      explicitly that it does not.
