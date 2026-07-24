Feature: status, selection, and transition honor one journal-aware done-rule
  As the batch engine orchestrating propose -> apply -> verify
  I want the three consumers of "done" — batch status derivation, next-step
  selection, and next-transition computation — to agree on a single predicate
  So that verify is actually selected and runs as a gate before a change is done,
  rather than being skipped because status already reported the change done on
  task-checkboxes alone (delegated-lifecycle: divergent done-rules are a defect).

  # The single done predicate: a change is DONE iff its plan tasks are all checked
  # AND the run journal carries a completion entry with transition "verify" for it.
  # Tasks-checked-but-unverified is the new in-between state (awaiting-verify); it
  # is NOT done, and verify is the next runnable transition for it.

  Background:
    Given a batch with a change "journal-aware-done" whose plan has at least one task

  Scenario: tasks complete + no journaled verify => awaiting-verify, and verify is the next transition
    Given every task in the change's plan is checked
    And no verify completion has been journaled for the change
    When the next transition for the change is computed
    Then the next transition is "verify"
    And the computed batch status for the change is "awaiting-verify" (not "done")

  Scenario: a journaled verify completion makes the change done and leaves nothing runnable
    Given every task in the change's plan is checked
    And a verify completion has been journaled for the change
    When the next transition for the change is computed
    Then there is no next transition (the change is done)
    And the computed batch status for the change is "done"

  # Drive the whole stack with a stub agent: propose -> apply (checks tasks) ->
  # verify is scheduled and runs (journals a verify completion) -> done.
  Scenario: driving propose -> apply -> verify schedules and runs verify before done
    Given a stub agent that completes each transition it is given
    When the change is driven through propose then apply
    Then the change is reported "awaiting-verify" and the next scheduled step is "verify"
    When the verify step runs and journals a verify completion
    Then the change is reported "done"

  # The single-rule guarantee: status must never report done for a change that the
  # transition logic still wants to verify.
  Scenario: status never disagrees with the transition logic about done
    Given any change whose tasks are all checked but with no journaled verify completion
    When the batch status and the next transition are computed for that change
    Then the batch status for that change is not "done"
    And the next transition for that change is "verify"
