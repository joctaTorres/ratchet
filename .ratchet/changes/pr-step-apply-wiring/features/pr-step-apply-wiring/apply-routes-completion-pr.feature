Feature: batch apply surfaces and routes the completion PR step
  As a ratchet user who enabled whole-batch PR grouping
  I want `ratchet batch apply` to surface the completion PR step once the batch is done
  So that the accumulated stage-agent work is opened as exactly one pull request through the loop, without changing apply behavior when grouping is off

  Background:
    Given a batch whose changes and terminal proof are all done
    And the bundled engine's `runPrStep` is the entry point for the completion PR step

  Scenario: A completed whole-batch batch routes exactly one PR step to the engine
    Given the batch resolves `prGrouping: whole-batch`
    And no PR-open completion is recorded in the run-state journal
    When `batch apply` runs on the completed batch
    Then `batch apply` selects the completion PR step as its apply target
    And it invokes the engine's `runPrStep` exactly once
    And no change-scoped `runStep` is invoked
    And the step outcome is persisted and rendered through the same paths a change step uses

  Scenario: The PR step context carries the resolved work and base branch as data
    Given the batch resolves `prGrouping: whole-batch`
    And no PR-open completion is recorded in the run-state journal
    When `batch apply` runs on the completed batch
    Then the `PrStepContext` handed to the engine carries the resolved work branch
    And it carries the resolved base branch
    And the branches are resolved by the CLI, not by the engine

  Scenario: PR grouping off leaves existing apply behavior unchanged
    Given the batch resolves `prGrouping: off`
    And every change and the terminal proof are done
    When `batch apply` runs on the completed batch
    Then no PR step is surfaced and the engine's `runPrStep` is never invoked
    And the output is exactly the existing "Nothing to do — all changes are done." message

  Scenario: PR grouping unset behaves exactly as off
    Given the batch has no `prGrouping` setting configured
    And every change and the terminal proof are done
    When `batch apply` runs on the completed batch
    Then no PR step is surfaced and the engine's `runPrStep` is never invoked
    And the output is exactly the existing "Nothing to do — all changes are done." message

  Scenario: A resumed loop never double-opens the PR
    Given the batch resolves `prGrouping: whole-batch`
    And a PR-open completion is already recorded in the run-state journal
    When `batch apply` runs on the completed batch again
    Then no PR step is surfaced and the engine's `runPrStep` is never invoked
    And the output reports the batch has nothing left to do

  Scenario: The PR step is not surfaced while the batch still has outstanding work
    Given the batch resolves `prGrouping: whole-batch`
    And a change in the batch is still ready to advance
    When `batch apply` runs
    Then it selects that change step and drives `runStep`
    And it does not surface or route the completion PR step

  Scenario: A failed PR step surfaces as a reported step failure
    Given the batch resolves `prGrouping: whole-batch`
    And no PR-open completion is recorded in the run-state journal
    And the engine's `runPrStep` returns a blocked result
    When `batch apply` runs on the completed batch
    Then the blocked outcome is parked in run-state under the PR journal key
    And the failure is rendered to the user as a reported step failure
