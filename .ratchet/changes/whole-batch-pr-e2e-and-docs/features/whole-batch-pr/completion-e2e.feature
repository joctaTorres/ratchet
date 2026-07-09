Feature: Whole-batch PR opening — end-to-end at batch completion
  As a ratchet user driving a batch with prGrouping: whole-batch
  I want the built CLI to open exactly one PR at completion through a spawned PR agent
  So that the whole batch's work lands as a single reviewable pull request, and
  nothing changes when PR grouping is off

  Background:
    Given a git repository whose "git log" history follows semantic / Conventional Commits
    And a work branch checked out that carries the prior stage agents' uncommitted work
    And a single-phase batch "b" whose only change "c1" is done, verified, and past its terminal proof
    And the fake agent spawn seam (RATCHET_BATCH_AGENT_CMD) stands in for the coding agent

  Scenario: A completed whole-batch batch opens exactly one PR with a semantic commit
    Given the batch "b" is configured with "prGrouping: whole-batch"
    When I run "ratchet batch apply b" against the fake spawn seam
    Then the PR agent is spawned exactly once for the "pr" stage
    And its instructions delegate to "/rct:pr-open" and carry the resolved work and base branch
    And exactly one PR-open action is recorded
    And the commit authored on the work branch follows the repository's semantic / Conventional-Commit style
    And the command exits with code 0

  Scenario: prGrouping off spawns no PR agent and leaves the terminal output unchanged
    Given the batch "b" is configured with "prGrouping: off"
    When I run "ratchet batch apply b" against the fake spawn seam
    Then no PR agent is ever spawned
    And no PR-open action is recorded
    And the output reads "Nothing to do — all changes are done."
    And the command exits with code 0

  Scenario: prGrouping unset behaves exactly like off
    Given the batch "b" has no prGrouping setting configured
    When I run "ratchet batch apply b" against the fake spawn seam
    Then no PR agent is ever spawned
    And no PR-open action is recorded
    And the output reads "Nothing to do — all changes are done."

  Scenario: Re-running the completed loop never double-opens the PR
    Given the batch "b" is configured with "prGrouping: whole-batch"
    And a first "ratchet batch apply b" has already opened the PR exactly once
    When I run "ratchet batch apply b" a second time against the fake spawn seam
    Then no additional PR agent is spawned
    And still exactly one PR-open action is recorded in total
    And the output reads "Nothing to do — all changes are done."

  Scenario: A PR-open failure surfaces as a reported step failure
    Given the batch "b" is configured with "prGrouping: whole-batch"
    And the fake PR agent exits non-zero without reporting a completion
    When I run "ratchet batch apply b" against the fake spawn seam
    Then the PR step is reported as a failure in the observable output
    And no PR-open completion is recorded in run-state
    And a subsequent run is still free to retry the PR step
