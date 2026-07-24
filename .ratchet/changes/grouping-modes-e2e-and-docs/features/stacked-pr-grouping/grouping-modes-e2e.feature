Feature: Stacked PR grouping modes — end-to-end through the built CLI
  As a ratchet user driving a batch with prGrouping: per-phase or per-change
  I want the built CLI to open one stacked PR per group with the correct stacked base
  So that each PR's diff stays scoped to its unit, dependent code still compiles,
  and a resumed loop never opens a duplicate

  Background:
    Given a git repository with a semantic / Conventional-Commit history and a configured origin remote whose HEAD names the base branch "main"
    And a completed batch "b" whose every change is done, verified, and past its recorded passing boundary proofs
    And the fake agent spawn seam (RATCHET_BATCH_AGENT_CMD) stands in for the coding agent, recording each PR-open action it is handed

  Scenario: per-phase opens one stacked PR per completed phase, based on the previous phase's branch
    Given the batch "b" has two phases "p1" and "p2", each with its own done change
    And the batch "b" is configured with "prGrouping: per-phase"
    When I run "ratchet batch apply b" repeatedly against the fake spawn seam until it reports nothing to do
    Then exactly two PR-open actions are recorded, in boundary order
    And the first action's work branch is "p1" and its base branch is "main"
    And the second action's work branch is "p2" and its base branch is "p1"
    And run-state carries exactly one pr completion for "pr:b:p1" and one for "pr:b:p2"
    And every apply invocation exits with code 0

  Scenario: per-change opens one stacked PR per change, based on the previous change's branch
    Given the batch "b" has one phase with two done changes "c1" and "c2"
    And the batch "b" is configured with "prGrouping: per-change"
    When I run "ratchet batch apply b" repeatedly against the fake spawn seam until it reports nothing to do
    Then exactly two PR-open actions are recorded, in boundary order
    And the first action's work branch is "c1" and its base branch is "main"
    And the second action's work branch is "c2" and its base branch is "c1"
    And run-state carries exactly one pr completion for "pr:b:c1" and one for "pr:b:c2"

  Scenario: a loop resumed after the first group opens only the remaining group
    Given the batch "b" is configured with "prGrouping: per-phase" over phases "p1" and "p2"
    And a first "ratchet batch apply b" has already opened the "p1" group's PR exactly once
    When I run "ratchet batch apply b" again against the fake spawn seam
    Then the resumed run spawns a PR agent only for the "p2" group
    And the "p1" group's PR-open action is still recorded exactly once
    And in total exactly two PR-open actions are recorded

  Scenario: re-running the fully-opened loop never double-opens any group
    Given the batch "b" is configured with "prGrouping: per-change"
    And every group's stacked PR has already been opened by prior apply runs
    When I run "ratchet batch apply b" once more against the fake spawn seam
    Then no additional PR agent is spawned
    And the recorded PR-open actions are unchanged
    And the output reads "Nothing to do — all changes are done."
    And the command exits with code 0

  Scenario: the spawned PR agent is handed the stacked base as delegation input
    Given the batch "b" is configured with "prGrouping: per-phase"
    When the fake spawn seam receives a PR step's instructions
    Then the instructions delegate to "/rct:pr-open"
    And they carry the group's own branch as the work branch and the computed stacked base as the base branch
    And they name the per-group report key "pr:b:<groupId>" as the completion channel
