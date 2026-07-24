Feature: a change becomes done only once its verify completion is journaled
  As the batch engine running the verify transition selected by apply
  I want the change to flip to "done" exactly when — and only when — a verify
  completion is journaled for it
  So that the verify gate is real: an all-tasks-checked change stays selectable
  (awaiting-verify) until verify actually runs, and selection then reports
  nothing runnable (delegated-lifecycle: "'Done' has one definition" — computed
  once via `isChangeDone` and honored by status, selection, and transition).

  Background:
    Given a batch with one phase containing a change "schedule-and-run-verify"
      whose plan.md tasks are all checked
    And the change has been selected and its `verify` transition has run

  Scenario: a journaled verify completion flips the change to done and drains the queue
    Given the verify step journaled a completion entry with transition "verify"
    When the batch status, next transition, and selection are recomputed
    Then the change status is "done"
    And the next transition for the change is undefined (nothing more to do)
    And `selectRunnableStep` reports the reason "all-done" (no runnable step)
    And `ratchet batch apply` reports nothing to do

  Scenario: without a journaled verify completion the change stays awaiting-verify and selectable
    Given the verify step did NOT journal a verify completion
    When the batch status, next transition, and selection are recomputed
    Then the change status is "awaiting-verify" and is not "done"
    And the next transition for the change is "verify"
    And `selectRunnableStep` returns the change as the runnable step

  # End-to-end through the selection seam: drive propose -> apply, then let the
  # SELECTION decide the next step (not a hand-fed context), run it, and confirm
  # verify ran and the change is done — proving apply schedules AND runs verify.
  Scenario: driving propose -> apply then applying again schedules and runs verify to done
    Given a stub agent that completes each transition it is given and, on verify,
      journals a verify completion
    When the change is driven through propose then apply
    Then selection reports the change as "awaiting-verify" with "verify" as its next step
    When `ratchet batch apply` runs the next step it selects
    Then the verify transition runs and journals a verify completion
    And the change is reported "done" with no further runnable step
