Feature: Spawn one PR agent at batch completion
  As a ratchet user who enabled whole-batch PR grouping
  I want the engine to spawn a single instruction-following PR agent when the batch is complete
  So that the accumulated stage-agent work is committed and opened as exactly one pull request, once

  Background:
    Given a completed batch whose changes and terminal proof are all done
    And the shared `pr-open` command is guaranteed in the spawn locus

  Scenario: Whole-batch grouping spawns exactly one PR agent delegating to the shared command
    Given the batch resolves `prGrouping: whole-batch`
    And no PR-open outcome is recorded in the run-state journal
    When the engine runs the completion PR step
    Then exactly one agent is spawned
    And its instructions invoke the shared `/rct:pr-open` command, not an inline engine-authored PR prompt
    And its instructions carry the resolved work branch and base branch as data
    And a PR-open completion is recorded in the run-state journal under the batch locus

  Scenario: The PR step resolves the adapter for the `pr` stage of the agent map
    Given the batch resolves `prGrouping: whole-batch`
    And the `agent` setting maps the `pr` stage to a specific agent
    When the engine runs the completion PR step
    Then the spawned agent is the one the `pr` stage maps to
    And the invocation token uses that agent's own command syntax

  Scenario: The `pr` stage falls back to the scalar or default agent when unmapped
    Given the batch resolves `prGrouping: whole-batch`
    And the `agent` setting is a scalar string with no stage-map
    When the engine runs the completion PR step
    Then the spawned agent is the scalar agent
    And an unset `agent` setting spawns the default agent instead

  Scenario: PR grouping off never spawns a PR agent
    Given the batch resolves `prGrouping: off`
    When the engine runs the completion PR step
    Then no agent is spawned
    And no PR-open outcome is recorded

  Scenario: PR grouping unset behaves exactly as off
    Given the batch has no `prGrouping` setting configured
    When the engine runs the completion PR step
    Then `prGrouping` resolves to `off`
    And no agent is spawned

  Scenario: A resumed run never double-opens the PR
    Given the batch resolves `prGrouping: whole-batch`
    And a PR-open completion is already recorded in the run-state journal
    When the engine runs the completion PR step again
    Then no agent is spawned
    And no second PR-open outcome is recorded

  Scenario: A commit, push, or PR-open failure surfaces as a reported step failure
    Given the batch resolves `prGrouping: whole-batch`
    And the spawned PR agent exits non-zero without reporting a completion
    When the engine runs the completion PR step
    Then the step result state is a failure
    And no PR-open completion is recorded in the run-state journal
    And a subsequent run is therefore free to retry the PR step

  Scenario: An unrenderable spawn locus fails before any agent is spawned
    Given the batch resolves `prGrouping: whole-batch`
    And the spawn locus is one the engine cannot render the `pr-open` command into
    When the engine runs the completion PR step
    Then the step result state is a failure carrying an actionable bootstrap message
    And no agent is spawned
