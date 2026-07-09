Feature: batch apply surfaces and routes the per-boundary PR step
  As a ratchet user who enabled stacked PR grouping (per-phase or per-change)
  I want `ratchet batch apply` to surface one PR step per detected group boundary once the batch is done
  So that each completed unit is opened as exactly one stacked pull request through the loop, without changing apply behavior when grouping is off or whole-batch

  Background:
    Given a completed batch whose changes and terminal proof are all done
    And the bundled engine's `runPrStep` is the entry point for a per-boundary PR step
    And the pure policies `detectPrGroupBoundaries` and `selectStackedBases` are the single home of "where the groups are" and "what each group stacks on"

  Scenario: A completed per-phase batch routes one PR step per phase boundary in order
    Given the batch resolves `prGrouping: per-phase` over two phases each with changes
    And no per-group PR-open completion is recorded in the run-state journal
    When `batch apply` runs on the completed batch
    Then `batch apply` selects the first phase's boundary as its PR apply target
    And it invokes the engine's `runPrStep` exactly once for that boundary
    And no change-scoped `runStep` is invoked
    And a subsequent `batch apply` selects the second phase's boundary and invokes `runPrStep` once for it
    And the step outcome of each boundary is persisted and rendered through the same paths a change step uses

  Scenario: The stacked PR step context carries the boundary and its resolved stacked base
    Given the batch resolves `prGrouping: per-phase` over two phases each with changes
    And no per-group PR-open completion is recorded in the run-state journal
    When `batch apply` runs on the completed batch for the second phase boundary
    Then the `PrStepContext` handed to the engine carries that phase's boundary
    And it carries the resolved work branch naming the group's own branch
    And it carries the resolved base branch naming the previous group's branch
    And the branches are resolved by the CLI, not by the engine

  Scenario: The first group bases on the batch base branch
    Given the batch resolves `prGrouping: per-change`
    And no per-group PR-open completion is recorded in the run-state journal
    When `batch apply` runs on the completed batch for the first change's boundary
    Then the `PrStepContext` base branch is the repository's base branch
    And the work branch names the first change's own group branch

  Scenario: A completed per-change batch drives one stacked PR per change
    Given the batch resolves `prGrouping: per-change` over three changes
    And no per-group PR-open completion is recorded in the run-state journal
    When `batch apply` is run repeatedly until nothing is left to do
    Then it invokes the engine's `runPrStep` exactly once per change boundary
    And each boundary's PR is keyed independently in the run-state journal

  Scenario: A resumed loop never re-surfaces a group whose PR is already recorded
    Given the batch resolves `prGrouping: per-phase` over two phases each with changes
    And a PR-open completion for the first phase's group key is recorded in the run-state journal
    When `batch apply` runs on the completed batch
    Then the first phase's boundary is not re-surfaced and its `runPrStep` is not re-invoked
    And `batch apply` selects the second phase's boundary instead

  Scenario: When every group's PR is recorded the terminal output is the unchanged done message
    Given the batch resolves `prGrouping: per-change` over three changes
    And a PR-open completion is recorded for every change's group key
    When `batch apply` runs on the completed batch
    Then no PR step is surfaced and the engine's `runPrStep` is never invoked
    And the output reports the batch has nothing left to do

  Scenario: PR grouping off leaves existing apply behavior unchanged
    Given the batch resolves `prGrouping: off`
    And every change and the terminal proof are done
    When `batch apply` runs on the completed batch
    Then no PR step is surfaced and the engine's `runPrStep` is never invoked
    And the output is exactly the existing "Nothing to do — all changes are done." message

  Scenario: PR grouping whole-batch behavior is left unchanged
    Given the batch resolves `prGrouping: whole-batch`
    And no PR-open completion is recorded in the run-state journal
    When `batch apply` runs on the completed batch
    Then it surfaces a single completion PR step carrying no group boundary
    And the `PrStepContext` work branch is the current branch resolved from git
    And the engine's `runPrStep` is invoked exactly once

  Scenario: The per-boundary PR step is not surfaced while the batch still has outstanding work
    Given the batch resolves `prGrouping: per-phase`
    And a change in the batch is still ready to advance
    When `batch apply` runs
    Then it selects that change step and drives `runStep`
    And it does not surface or route any per-boundary PR step

  Scenario: A failed per-boundary PR step surfaces as a reported step failure and stays retryable
    Given the batch resolves `prGrouping: per-change`
    And no PR-open completion is recorded for the first change's group key
    And the engine's `runPrStep` returns a blocked result for that boundary
    When `batch apply` runs on the completed batch
    Then the blocked outcome is parked in run-state under that group's per-group PR journal key
    And the failure is rendered to the user as a reported step failure
    And no PR-open completion is recorded for that group, so a subsequent run re-surfaces it
