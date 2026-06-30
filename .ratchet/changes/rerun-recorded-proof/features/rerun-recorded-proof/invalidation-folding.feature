Feature: Proof-of-work invalidation folds through the single record reader
  As the batch status and selection logic
  I want a proof invalidation marker to fold through proofRecordsFromEntries
  So that the gate and step selection both honor an invalidated proof by construction,
  with no extra disk read and no second source of truth

  Background:
    Given proofRecordsFromEntries folds a JournalEntry list into the latest-per-phase record map
    And both computeBatchStatus (the gate) and readProofOfWorkByPhase (selection) read that same folder

  Scenario: An invalidation marker removes the phase from the folded record map
    Given the journal has a proof-of-work record for "p1" followed by an invalidation marker for "p1"
    When proofRecordsFromEntries folds the journal
    Then the resulting map has no entry for "p1"

  Scenario: A later real verdict re-adds a phase that was invalidated
    Given the journal has a proof record for "p1", then an invalidation marker for "p1", then a newer proof record for "p1"
    When proofRecordsFromEntries folds the journal
    Then the map's entry for "p1" is the newest proof record

  Scenario: Invalidation is scoped to its own phase
    Given the journal has proof records for "p1" and "p2" and an invalidation marker for "p1" only
    When proofRecordsFromEntries folds the journal
    Then the map has no entry for "p1"
    But the map still has the recorded proof for "p2"

  Scenario: Gate re-opens after an invalidated failing proof
    Given phase "p1" is done and its recorded boundary proof failed under "hard-gate"
    And "p2" is therefore blocked citing "p1"'s failing proof
    When an invalidation marker for "p1" is appended to the journal
    And computeBatchStatus recomputes from that journal
    Then "p2" is no longer gated on a proof, because "p1" now has no recorded verdict

  Scenario: Selection re-offers the boundary proof step after invalidation
    Given phase "p1" is done and "p2" has an outstanding change
    And "p1"'s recorded proof was invalidated
    When pickNextStep selects the next runnable step for "ratchet batch apply"
    Then it returns the boundary proof-of-work step for "p1" before any "p2" change
    Because "p1" is no longer in the set of phases with a recorded proof
