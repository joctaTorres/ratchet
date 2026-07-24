# Schedule and run verify: selection picks `awaiting-verify`, apply runs the gate

## Why

The prior change in this phase (`journal-aware-done`) collapsed the two
divergent done-rules into one journal-aware predicate (`isChangeDone` in
`src/core/batch/engine/transition.ts`) and made `status.ts` derive the
in-between `awaiting-verify` state. Its test drives propose → apply → verify by
handing the engine a **forced** `context()` directly to `runStep` — it proves
the predicate and the status surface, but it never exercises the path that
decides WHICH change/transition `ratchet batch apply` runs next.

That selection seam is exactly where the verify gate is won or lost. `ratchet
batch apply` does not call `runStep` with a hand-fed transition; it calls its
own `pickNextStep` (`src/commands/batch/apply.ts`) over the derived batch status
to choose the next change, and the engine then derives the transition from disk
via `computeNextTransition`. If `pickNextStep` (and the pure `selectRunnableStep`
used by the engine/tests) does not treat `awaiting-verify` as runnable work, an
all-tasks-checked change is silently stranded and **verify never runs** (#32
claim 2) — even though the status now says `awaiting-verify`.

This change closes the loop end to end through the real selection seam: an
`awaiting-verify` change is selected by both `pickNextStep` and
`selectRunnableStep`, `ratchet batch apply` runs its `verify` transition
(delegating to the canonical `/rct:verify` skill, per phase 1 — the engine
orchestrates the run, it does not re-author verify), and the change flips to
`done` only once that verify completion is journaled. Status, selection, and
transition all honor the one journal-aware done-rule.

## What Changes

- **Selection treats `awaiting-verify` as runnable work.** The CLI's
  `pickNextStep` returns an `awaiting-verify` change as the next step (its
  runnable transition is the verify gate), and the pure `selectRunnableStep`
  agrees because `SelectableChange.done` is fed from the same `isChangeDone`
  predicate (an unverified change is `done: false`). Neither invents a second
  done-rule.
- **`ratchet batch apply` runs the verify transition for that change.** Once
  selected, the engine derives `verify` from disk + journal via
  `computeNextTransition` and runs it — and that run delegates to
  `/rct:verify <change>` (phase 1's delegating spawn), not an inline verify
  prompt.
- **Done is gated on the journaled verify completion.** The change becomes
  `done` exactly when a `completion` entry with `transition === 'verify'` is
  journaled; until then it stays `awaiting-verify` and selectable, and once
  journaled selection drains (`selectRunnableStep` → `all-done`, `pickNextStep`
  → nothing, `batch apply` → "nothing to do").
- **Thin vertical slice.** Scope is the selection → run → done wiring proven
  through the real selection seam — not the status-derivation surface
  (`journal-aware-done`), the internal autonomous loop, or proof-of-work gating
  (later phases). Reuse the existing predicate and delegating spawn; add no new
  lifecycle instruction text to the engine.

Implements
`features/schedule-verify/select-awaiting-verify-runs-verify.feature` and
`features/schedule-verify/verify-completion-flips-to-done.feature`.

## Design

- **One predicate, three consumers — no new rule.** `pickNextStep` keys off the
  derived `ChangeStatus` (`awaiting-verify` is selectable alongside
  `ready` / `in-progress`); `selectRunnableStep` keys off
  `SelectableChange.done`, which callers feed from `isChangeDone(disk, journal)`;
  `computeNextTransition` returns `verify` for an applied-but-unverified change.
  All three derive from the same journal-aware authority — this change wires the
  selection seams to it, it does not add a parallel done-test
  (`delegated-lifecycle`: "'Done' has one definition").
- **The run path delegates, it does not re-author.** The verify transition the
  engine runs goes through `buildAgentInstructions`, which already emits
  `/rct:verify <change>` (phase 1). This change must not introduce any inline
  verify-step text in the engine/CLI (`delegated-lifecycle`: the CLI orchestrates;
  it does not re-author the lifecycle).
- **Selection-seam test, not a re-run of the status test.** The new test drives
  the change through propose → apply with a stub agent, then asserts the SELECTION
  decides the next step: `pickNextStep` / `selectRunnableStep` return the
  `awaiting-verify` change with `verify` as its next transition; running that
  selected step journals a verify completion and flips the change to `done` with
  nothing further runnable. It also asserts the spawned verify prompt invokes
  `/rct:verify <change>` rather than describing verify inline, and guards that a
  partially-applied change is selected for `apply`, not `verify`.
- **No regressions.** `ready` / `blocked` / `in-progress` / `awaiting-approval`
  selection behavior is unchanged; gated phases and parked changes are still
  skipped.

## Tasks

- [x] Make the CLI selection seam (`pickNextStep` in
      `src/commands/batch/apply.ts`) return an `awaiting-verify` change as the
      next runnable step (its runnable transition is the verify gate), without
      regressing the `ready` / `in-progress` selection or skipping gated/parked
      work.
- [x] Confirm/keep the pure `selectRunnableStep`
      (`src/core/batch/engine/selection.ts`) selecting an `awaiting-verify`
      change by feeding `SelectableChange.done` from the shared
      `isChangeDone(disk, journal)` predicate (an unverified change is
      `done: false`), so selection and the next-transition logic agree by
      construction — no second done-rule.
- [x] Ensure that when `ratchet batch apply` runs the selected `awaiting-verify`
      change, the engine derives and runs the `verify` transition
      (`computeNextTransition`) and that run delegates to `/rct:verify <change>`
      (phase 1's `buildAgentInstructions`) — no inline verify steps added to the
      engine/CLI (`delegated-lifecycle`).
- [x] Ensure a change flips to `done` only once a `completion` entry with
      `transition === 'verify'` is journaled: until then it stays
      `awaiting-verify` and selectable; once journaled `selectRunnableStep`
      returns `all-done`, `computeNextTransition` returns `undefined`, and
      `batch apply` reports nothing to do.
- [x] Add a test under `test/batch-engine/` that drives propose → apply with a
      stub agent and then exercises the SELECTION seam (not a hand-fed context):
      assert (a) `pickNextStep` / `selectRunnableStep` return the
      `awaiting-verify` change with `verify` as its next transition; (b) running
      the selected step spawns a verify transition whose prompt invokes
      `/rct:verify <change>` (delegation, not inline steps); (c) the journaled
      verify completion flips the change to `done` with no further runnable step;
      (d) a partially-applied change is selected for `apply`, not `verify`; and
      (e) `ready` / `blocked` selection is not regressed.
- [x] Run `pnpm vitest run test/batch-engine` and confirm exit code 0 — this is
      the phase proof-of-work: verify is scheduled by selection AND run as the
      gate, an all-checked-but-unverified change is selected (not treated as
      done), and status / selection / transition agree on the one done-rule.
- [x] **Documentation (mandatory — `documentation` standard).** This change
      alters the `ratchet batch apply` selection behavior (it now schedules and
      runs the verify gate from selection), so update these specific docs:
      - `docs/commands/batch.md` — the **`batch apply`** section (~line 15)
        MUST state that apply selects an `awaiting-verify` change and runs its
        `verify` transition (delegating to `/rct:verify`) as the gate before
        `done`, complementing the existing `awaiting-verify` status-table row.
      - `docs/engine/overview.md` — the **"Step selection"** section (~line 191,
        `selectRunnableStep` / `pickNextStep`) and the lifecycle flow listing
        "select first ready/in-progress change" (~line 366) MUST be updated to
        include `awaiting-verify` as a selectable step so verify is scheduled;
        a stale diagram/flow is a documentation defect, so the flow itself must
        be updated, not only the prose.
      No new CLI command/flag/config key is added; `batch apply` selection
      behavior changes but its output surface does not gain a new state (the
      `awaiting-verify` glyph was added by `journal-aware-done`), so update
      `README.md` only if it describes `batch apply`'s selection/verify-gate
      behavior; otherwise state explicitly that it does not.
