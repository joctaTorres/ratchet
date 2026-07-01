Feature: batch apply selects an awaiting-verify change and runs its verify transition
  As `ratchet batch apply` choosing the next runnable step
  I want the selection seam — the CLI's `pickNextStep` and the pure
  `selectRunnableStep` — to return a change whose tasks are all checked but
  which has no journaled verify completion (the `awaiting-verify` state)
  So that apply actually SCHEDULES and RUNS the `verify` transition as the gate
  before done, instead of skipping it because the change looked finished
  (delegated-lifecycle: status, selection, and transition honor ONE done-rule —
  the journal-aware predicate `isChangeDone`; an unverified change is selectable
  work, not done).

  # The prior change in this phase (journal-aware-done) made `status.ts` derive
  # the `awaiting-verify` state and proved the engine core (`runStep`) drives
  # propose -> apply -> verify when handed a forced context. THIS change closes
  # the loop at the SELECTION seam: the path that decides WHICH change/transition
  # `ratchet batch apply` runs next must pick the awaiting-verify change and run
  # `verify`, which delegates to the canonical `/rct:verify` skill (phase 1) —
  # the engine orchestrates the run; it does not re-author the verify steps.

  Background:
    Given a batch with one phase containing a change "schedule-and-run-verify"
    And the change's plan.md has a "## Tasks" checklist with every task checked
    And no verify completion has been journaled for the change

  Scenario: the CLI selection seam returns the awaiting-verify change as the next step
    Given the batch status derives the change as "awaiting-verify"
    When `ratchet batch apply` picks the next runnable step (`pickNextStep`)
    Then the selected step is the "schedule-and-run-verify" change in its phase
    And the change is not skipped as already done

  Scenario: the pure selection function agrees the awaiting-verify change is runnable
    Given a selectable phase whose only change has `done: false` fed from the
      journal-aware predicate `isChangeDone` (tasks checked, no journaled verify)
    When `selectRunnableStep` is called on that phase view
    Then it returns that change as the runnable step (not the reason "all-done")

  Scenario: running the selected step spawns a verify transition that delegates to /rct:verify
    Given the selected step for the awaiting-verify change
    When the engine runs that step with a stub agent
    Then the transition it runs is "verify"
    And the spawned agent prompt invokes the canonical `/rct:verify schedule-and-run-verify`
      skill rather than describing verify steps inline

  Scenario: a change still in apply is not yet selected for verify
    Given the change's plan.md has at least one unchecked task
    When `ratchet batch apply` picks the next runnable step
    Then the next transition for the selected change is "apply", not "verify"
