Feature: Batch status derived from change state on disk
  As a developer tracking a batch
  I want batch status computed live from the referenced changes and phases
  So that the batch never stores stale progress or estimates

  Background:
    Given a batch "q3-auth" with a phase referencing changes "add-user-model", "add-login-api", and "add-oauth"
    And "add-login-api" and "add-oauth" are after "add-user-model"

  Scenario: A manifest intent with no change directory yet is pending
    Given none of the changes have been created yet
    When I run "ratchet batch status q3-auth"
    Then "add-user-model" is reported as ready to start
    And "add-login-api" and "add-oauth" are reported as blocked by "add-user-model"
    And no entry is reported as an error for not existing yet

  Scenario: A change with all plan tasks checked counts as done
    Given "add-user-model" exists and every task checkbox in its plan.md is checked
    When I run "ratchet batch status q3-auth"
    Then "add-user-model" is reported as done
    And "add-login-api" and "add-oauth" are reported as ready

  Scenario: An archived change counts as done
    Given "add-user-model" has been archived to .ratchet/changes/archive
    When I run "ratchet batch status q3-auth"
    Then "add-user-model" is reported as done

  Scenario: A change with partial task progress is in progress
    Given "add-user-model" exists with 2 of 5 plan tasks checked
    When I run "ratchet batch status q3-auth"
    Then "add-user-model" is reported as in progress with task counts

  Scenario: Machine-readable status for agents and the engine
    When I run "ratchet batch status q3-auth --json"
    Then the output is JSON containing each phase and each change with its status, task progress, and after edges
    And the JSON lists which step is next to run and whether it is gated or blocked
