# One journal-aware definition of done; surface `awaiting-verify`

## Why

The engine carries two divergent done-rules, and the divergence is exactly the
defect the `delegated-lifecycle` standard names ("'Done' has one definition"):

- `deriveChangeBase` in `src/core/batch/status.ts` (line ~119) computes
  `done = progress.total > 0 && progress.completed === progress.total` — task
  checkboxes ALONE. It never reads the run journal.
- `computeNextTransition` in `src/core/batch/engine/transition.ts` treats a
  change whose tasks are all checked but that has NO journaled verify completion
  as still needing `verify` (returns `'verify'`); only a journaled verify
  completion (`kind === 'completion' && transition === 'verify'`) makes it
  terminal.

So `batch status` reports a change `done` the moment its checkboxes are all
checked, while the transition logic still wants verify to run. Because status
already says "done", selection never picks the change, and **verify never runs**
(#32 claim 2). This change collapses both rules into one journal-aware predicate
honored uniformly by status, selection, and transition, and surfaces the
in-between state — tasks complete but unverified — as a new `awaiting-verify`
status that is explicitly NOT `done`.

## What Changes

- **One done predicate, one place.** A single function decides whether a change
  is done: plan tasks all checked AND the run journal carries a `completion`
  entry with `transition === 'verify'` for that change. Both `status.ts` and the
  transition path consume it; neither re-derives done on its own.
- **`status.ts` becomes journal-aware.** `deriveChangeBase` /
  `computeBatchStatus` consult the journal so an all-tasks-checked change with no
  journaled verify is derived as `awaiting-verify`, not `done`. The archived
  shortcut still returns `done`.
- **New `ChangeStatus` member.** `'awaiting-verify'` is added to the
  `ChangeStatus` union, and every consumer (phase aggregation, batch
  aggregation/`next`, the `batch view` renderer) handles it without regressing
  the existing `done` / `blocked` / `ready` / `in-progress` / `awaiting-approval`
  states.
- **Selection & transition agree by construction.** Selection already keys off a
  `done` boolean (`SelectableChange.done`); that boolean is fed from the same
  journal-aware predicate, so an `awaiting-verify` change is `done: false` and is
  selected — letting verify actually run as the gate before done.
- **Thin vertical slice.** Scope is the single done-rule + the `awaiting-verify`
  state end to end (status, selection, transition agreement), proven by the
  batch-engine tests — not a full host/internal-loop rework.

Implements `features/single-done-rule/awaiting-verify-status.feature` and
`features/single-done-rule/status-selection-transition-agree.feature`.

## Design

- **Single seam for the predicate.** Add one journal-aware done helper (e.g.
  `isChangeDone(diskState, journalForChange)` or an exported predicate in
  `engine/transition.ts`, the place that already reads the journal) and make it
  THE authority. `transition.ts` already encodes the verify-completion rule;
  factor that rule so `status.ts` can call the same code rather than duplicating
  the checkbox-only test.
- **Thread the journal into status.** `computeBatchStatus` currently receives
  only `RunState` (parked). It must also receive the change journal (or read it
  via the existing `readJournal`) so `deriveChangeBase` can ask the shared
  predicate. Callers (`src/commands/batch/view.ts`, any headless status path)
  pass the journal they already load.
- **Derive `awaiting-verify` precisely.** In `deriveChangeBase` /
  `derivePhaseStatus`: tasks all checked + journaled verify -> `done`; tasks all
  checked + no journaled verify -> `awaiting-verify`; partial tasks ->
  `in-progress`; archived -> `done`. Phase `allDone` stays keyed on
  `status === 'done'` (so a phase with an `awaiting-verify` change is NOT done);
  `anyProgress` and the batch `next` selection treat `awaiting-verify` as
  actionable work (it has a runnable verify step), not as finished.
- **Renderer.** `symbolFor` in `view.ts` gains an `awaiting-verify` case (its
  `default` currently catches it as the neutral `·`); pick a distinct glyph
  signalling "verify pending" without implying done.
- **No lifecycle re-authoring.** This change only fixes the done-computation and
  status surface; it does not add lifecycle instruction text to the engine
  (`delegated-lifecycle`: the CLI orchestrates, it does not re-author).

## Tasks

- [x] Introduce ONE journal-aware done predicate as the single authority: a
      change is done iff its plan tasks are all checked AND the run journal has a
      `completion` entry with `transition === 'verify'` for the change. Factor it
      out of / co-locate it with `computeNextTransition` in
      `src/core/batch/engine/transition.ts` so the verify-completion rule lives in
      exactly one place.
- [x] Make `src/core/batch/status.ts` journal-aware: thread the change journal
      into `computeBatchStatus` / `deriveChangeBase` (read via `readJournal`
      and/or accept it as an argument) and replace the checkbox-only `done`
      derivation with the shared predicate.
- [x] Add `'awaiting-verify'` to the `ChangeStatus` union in `status.ts`.
- [x] In `deriveChangeBase` / `derivePhaseStatus`, derive an all-tasks-checked
      change with NO journaled verify completion as `awaiting-verify` (not
      `done`); keep `done` for archived and for tasks-checked-AND-verified; keep
      `in-progress` for partial plans; do not regress `ready` / `blocked` /
      `awaiting-approval`.
- [x] Update phase + batch aggregation in `status.ts` so `awaiting-verify` is
      treated as actionable progress, not done: phase `allDone` stays
      `status === 'done'` only; include `awaiting-verify` in `anyProgress`; and
      make the batch `next` selection treat `awaiting-verify` as a selectable
      next step (the verify step that must run).
- [x] Ensure selection (`src/core/batch/engine/selection.ts`) and the transition
      path agree by feeding `SelectableChange.done` from the same journal-aware
      predicate, so an `awaiting-verify` change is `done: false` and verify is
      selected to run.
- [x] Add the `awaiting-verify` case to `symbolFor` in
      `src/commands/batch/view.ts` with a distinct glyph (verify-pending, not the
      done ✓), and pass the journal through from `batchViewCommand` to
      `computeBatchStatus`.
- [x] Add tests under `test/batch-engine/` that drive propose -> apply -> verify
      with a stub agent and assert: (a) after apply, an all-tasks-checked change
      with no journaled verify is `awaiting-verify` (NOT `done`) and the next
      scheduled step is `verify`; (b) once a verify completion is journaled the
      change is `done` and there is no next transition; (c) status / selection /
      transition agree on the single done-rule (status never reports `done` for a
      change the transition logic still wants to verify); (d) existing
      `done` / `blocked` / `ready` / `in-progress` states are not regressed.
- [x] Run `pnpm vitest run test/batch-engine` and confirm exit code 0 — this is
      the phase proof-of-work: verify is scheduled and runs as a gate, an
      all-checked-but-unverified change is `awaiting-verify` (not done), and
      status/selection/transition agree on one done-rule.
- [x] **Documentation (mandatory — `documentation` standard).** The new
      `awaiting-verify` state + single journal-aware done-rule touch these specific
      docs (named, not "any reference"):
      - `docs/commands/batch.md` — the user-facing **"Change statuses:" table**
        (~line 109) MUST gain an `awaiting-verify` row, and the new `batch status`
        / `batch view` glyph MUST be documented in the symbol legend (this is a
        user-visible output change).
      - `docs/engine/overview.md` — update the **lifecycle flowchart** (~line 26)
        and the status/StepResult reference so they show the single journal-aware
        done-rule and `awaiting-verify` between apply and done; a stale diagram is
        a documentation defect, so the diagram itself must be updated (vertical,
        high-contrast, every `classDef` sets `color:`), not just the prose.
      - `docs/engine/change-step.md` — if it enumerates the `ChangeStatus` union,
        add `awaiting-verify` there too.
      No new CLI command/flag/config key is added, but `batch status` OUTPUT
      changes (a new visible state), so update `README.md` only if it describes the
      batch status surface/symbols; otherwise state explicitly that it does not.
