Feature: A reachable phase with empty `changes` keeps the batch not-done
  As the batch engine deriving batch status from the manifest + disk + journal
  I want a ready, ungated phase whose `changes` list is empty to count as an
  outstanding decomposition step rather than nothing
  So that `ratchet batch status` never reports a multi-phase batch `done` while a
  later phase is still undecomposed (#30) — fixing the false-done where the engine
  counted only DECLARED change intents and treated undeclared phases as vacuously
  complete.

  # PRIOR STATE (defect): `computeBatchStatus` in src/core/batch/status.ts marks
  # the batch `done` when `doneCount === changeCount` — counts derived ONLY from
  # `phase.changes`. A phase with an empty `changes` list contributes zero changes,
  # so once the first phase's declared changes are done the batch reports `done`
  # even though later phases have no concrete change intents yet. (`derivePhaseStatus`
  # also computes `allDone = changes.length > 0 && ...`, so an empty phase is not
  # itself `done`, but that fact never reaches the batch-level done rule.) The batch
  # is `done` only once EVERY reachable phase is decomposed AND all its changes done.

  Background:
    Given a batch manifest with multiple ordered phases
    And the first phase has concrete change intents in its `changes` list
    And a later phase has an empty `changes` list (no concrete intents yet)

  Scenario: first phase fully done but a later phase still empty is NOT done
    Given every change in the first phase is done (tasks checked and verify journaled)
    And the later phase is ungated (its prior phases are all done) and still has empty `changes`
    When the batch status is computed
    Then the batch status is NOT "done"
    And the later empty phase is reported as outstanding work, not terminal

  Scenario: the batch is done only once every reachable phase is decomposed and its changes done
    Given every phase has at least one concrete change intent in its `changes` list
    And every change in every phase is done
    When the batch status is computed
    Then the batch status is "done"

  Scenario: an empty phase still gated by an unfinished prior phase does not flip the batch done
    Given the first phase has an unfinished change
    And a later phase has an empty `changes` list and is gated by the first phase
    When the batch status is computed
    Then the batch status is NOT "done"

  # Regression guard: a single-phase batch whose only phase has concrete changes,
  # all done, must still report done — the empty-phase rule must not block batches
  # that have no empty phases.
  Scenario: a fully-decomposed batch with all changes done still reports done
    Given a batch whose every phase has concrete change intents
    And every change is done
    When the batch status is computed
    Then the batch status is "done"
