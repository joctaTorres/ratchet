Feature: after decomposition the apply loop continues into the new changes and done stays honest
  As the batch engine driving a multi-phase batch to completion
  I want the freshly-authored change intents to become ordinary runnable steps on
  the next `ratchet batch apply`, and the batch to report `done` only once every
  reachable phase is decomposed AND all its changes are done
  So that a multi-phase batch with later empty phases is driven all the way to
  completion with no manual stop/propose/resume detour, and never reports a
  false-done while decomposition work remains (#30).

  # This is the "loop continues" half of the slice: once the decomposition step
  # has written concrete change intents into `batch.yaml`, the previously-empty
  # phase is decomposed, so status/selection now pick its first ready change as a
  # normal propose/apply/verify step — the same single done-rule from
  # `journal-aware-done` and the same recognition rule from `empty-phase-is-not-
  # done`, now actually advanced by the engine.

  Background:
    Given a batch whose first phase is done and whose later phase was just decomposed by the decomposition step
    And the previously-empty phase now holds concrete change intents in `batch.yaml`

  Scenario: the next apply advances the first new change, not the decomposition step
    Given `ratchet batch apply` is invoked again on the now-decomposed batch
    When it picks the next runnable step
    Then the selected step is the first ready change in the newly-decomposed phase
    And it is no longer a decomposition step (the phase is decomposed)

  Scenario: the batch is not done while the decomposed phase still has unfinished changes
    Given the newly-decomposed phase has at least one change that is not yet done
    When the batch status is computed
    Then the batch status is NOT "done"

  Scenario: the batch is done only once every reachable phase is decomposed and all changes done
    Given every reachable phase has concrete change intents and every change is done
    When the batch status is computed
    Then the batch status is "done"
    And `ratchet batch apply` reports there is nothing left to do

  # End-to-end guard: a multi-phase batch with an empty later phase is NOT reported
  # done after the first phase; successive `batch apply` calls decompose the empty
  # phase and then drive its changes — no manual detour anywhere in the chain.
  Scenario: a multi-phase batch with an empty later phase is driven to completion without a manual detour
    Given a batch whose first phase is fully done and whose second phase has empty `changes`
    When `ratchet batch apply` is run repeatedly until nothing is ready
    Then one of those runs decomposes the second phase by spawning the canonical decomposition skill
    And subsequent runs advance the second phase's authored changes to done
    And at no point is a manual stop/propose/resume detour required
    And the batch reports `done` only after every reachable phase is decomposed and all changes are done
