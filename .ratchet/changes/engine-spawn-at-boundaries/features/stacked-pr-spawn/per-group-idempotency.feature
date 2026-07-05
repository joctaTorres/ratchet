Feature: Per-group PR outcome is recorded so a resumed loop never double-opens a group
  As the ratchet batch engine driven by a resumable apply loop
  I want each group's PR outcome recorded in run-state keyed by that group
  So that re-running the loop opens each group's PR exactly once and a failed open stays retryable

  Background:
    Given a batch running under a stacked grouping mode
    And the shared pr-open command is registered for every coding agent

  Scenario: A successful PR-open is journaled keyed by its group
    Given prGrouping is "per-change"
    When the engine runs the PR step for a fired change group and the agent reports completion
    Then a PR completion outcome is recorded in run-state keyed by that group's identity
    And the recorded key distinguishes this group from every other group in the batch

  Scenario: A resumed run does not re-open a group whose PR is already recorded
    Given prGrouping is "per-phase"
    And the first phase group's PR-open outcome is already recorded in run-state
    When the engine runs the PR step for the first phase group again
    Then no PR agent is spawned for that group
    And the step reports nothing-ready

  Scenario: Groups are guarded independently
    Given prGrouping is "per-change"
    And the first change group's PR-open outcome is already recorded
    And the second change group has no recorded outcome
    When the engine runs the PR step for the second change group
    Then exactly one PR agent is spawned for the second group
    And the first group's recorded outcome is left untouched

  Scenario: A commit, push, or PR-open failure surfaces as a reported step failure
    Given prGrouping is "per-phase"
    When the engine runs the PR step for a fired group and the PR agent exits non-zero
    Then the step result is a reported failure
    And no PR completion outcome is recorded for that group
    And a subsequent run for the same group spawns the PR agent again

  Scenario: The whole-batch group keeps its existing single-group run-state key
    Given prGrouping is "whole-batch"
    When the engine runs the PR step at batch completion
    Then the recorded PR outcome uses the batch-level key unchanged from before
    And a resumed run at completion does not re-open the batch PR
