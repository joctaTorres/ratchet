Feature: Corroborate reported completions against disk evidence
  As a batch operator
  I want a claimed `--complete` on propose/apply/verify to be corroborated
  against the on-disk change state the engine already snapshots
  So that a step can never advance on a self-attested completion with no real
  evidence behind it (fail-closed, like the rest of outcome mapping)

  # `mapSessionToOutcome` already receives `diskEvidence: { before, after }`
  # (ChangeDiskState snapshots taken around the agent session). Today it only
  # consults that evidence on the zero-exit-no-completion path; these scenarios
  # make it corroborate the completion path too.

  Scenario: Propose completion with no plan on disk fails closed as blocked
    Given a session for the "propose" transition whose entries contain a completion
    And the after-session disk state has no change directory and no plan.md
    When the session is mapped to an outcome
    Then the outcome state is "blocked" and not "advanced"
    And the blocker says the step was reported complete but disk disagrees
    And the blocker names the missing propose evidence (no plan.md on disk)

  Scenario: Propose completion with a change directory but no plan.md is blocked
    Given a session for the "propose" transition whose entries contain a completion
    And the after-session disk state has a change directory but hasPlan is false
    When the session is mapped to an outcome
    Then the outcome state is "blocked"
    And the blocker says the step was reported complete but disk disagrees

  Scenario: Propose completion with a plan on disk advances
    Given a session for the "propose" transition whose entries contain a completion
    And the after-session disk state has the change directory and plan.md present
    When the session is mapped to an outcome
    Then the outcome state is "advanced"
    And the outcome message is the completion message, byte-for-byte as today

  Scenario: Apply completion with no task progress and tasks unchecked is blocked
    Given a session for the "apply" transition whose entries contain a completion
    And the plan has 4 tasks with 1 checked before the session and 1 checked after
    When the session is mapped to an outcome
    Then the outcome state is "blocked"
    And the blocker says the step was reported complete but disk disagrees
    And the blocker names the apply evidence gap (no tasks checked off this session)

  Scenario: Apply completion that progressed tasks this session advances
    Given a session for the "apply" transition whose entries contain a completion
    And the plan has 4 tasks with 1 checked before the session and 3 checked after
    When the session is mapped to an outcome
    Then the outcome state is "advanced"

  Scenario: Apply completion on an already fully-checked plan advances
    Given a session for the "apply" transition whose entries contain a completion
    And the plan was fully checked before the session and remains fully checked after
    When the session is mapped to an outcome
    Then the outcome state is "advanced"

  Scenario: Verify completion on an unapplied change is blocked
    Given a session for the "verify" transition whose entries contain a completion carrying a verdict
    And the after-session disk state is not applied (unchecked tasks remain)
    When the session is mapped to an outcome
    Then the outcome state is "blocked"
    And the blocker says the step was reported complete but disk disagrees

  Scenario: A corroboration mismatch still parks with the session journal refs
    Given a session for the "propose" transition whose entries contain a completion
    And the after-session disk state has no plan.md
    When the session is mapped to an outcome
    Then the outcome carries the session's journalRefs
    And the outcome message says the step was reported complete but disk disagrees
