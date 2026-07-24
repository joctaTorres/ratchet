Feature: status and selection agree a ready empty phase is an outstanding decomposition step
  As the batch engine orchestrating a lazily-decomposed multi-phase batch
  I want batch-status derivation and runnable-step selection to agree that a
  ready, ungated phase with empty `changes` is outstanding work (a decomposition
  step), not "all done"
  So that the apply loop has a runnable step to act on instead of stopping —
  selection recognizes the empty phase here, and the follow-on change
  (`drive-decomposition-step`) actually spawns the decomposing agent. The two
  consumers must not disagree (one saying done while the other has work), mirroring
  the single-source-of-truth done-rule the `delegated-lifecycle` standard requires.

  # `selectRunnableStep` in src/core/batch/engine/selection.ts today computes
  # `allDone = phases.every((p) => p.changes.every((c) => c.done))`. An empty phase
  # passes this VACUOUSLY (`[].every(...)` is true), so selection returns
  # `all-done` the moment the first phase's changes are done — agreeing with the
  # status false-done. This change makes both recognize the empty ungated phase as
  # an outstanding decomposition step.

  Background:
    Given a multi-phase batch whose first phase is fully done
    And a later phase that is ungated (prior phases done) with an empty `changes` list

  Scenario: selection does not report all-done while a reachable empty phase remains
    When the next runnable step is selected
    Then the selection result is NOT "all-done"
    And selection surfaces the empty phase as the outstanding decomposition step

  Scenario: status and selection agree the batch still has work
    When the batch status and the next runnable step are both computed
    Then the batch status is NOT "done"
    And selection reports an outstanding step (it does not report "all-done")

  Scenario: a gated empty phase is not yet the selectable decomposition step
    Given the first phase still has an unfinished change gating the later empty phase
    When the next runnable step is selected
    Then the still-unfinished change in the first phase is selected
    And the gated empty phase is not selected as the decomposition step yet

  # Once every phase is decomposed and its changes done, both consumers agree the
  # batch is finished — no phantom decomposition step lingers.
  Scenario: a fully-decomposed, all-done batch yields all-done and no outstanding step
    Given every phase has concrete change intents and every change is done
    When the batch status and the next runnable step are both computed
    Then the batch status is "done"
    And selection reports "all-done" with no runnable step
