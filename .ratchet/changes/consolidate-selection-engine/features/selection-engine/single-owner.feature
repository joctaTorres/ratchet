Feature: Single selection engine owns step selection
  As a batch-engine maintainer
  I want exactly one selection implementation, owned by the engine
  So that selection fixes land once and the CLI copy and engine copy cannot drift

  Scenario: pickNextStep lives in the engine selection module
    Given the engine selection module at src/core/batch/engine/selection.ts
    When a caller imports pickNextStep from the batch engine
    Then it receives the same selection implementation `batch apply` runs
    And that module is the only implementation of runnable-step selection in the codebase

  Scenario: the dead pure selector is deleted
    Given selectRunnableStep has no non-test caller
    When the consolidation lands
    Then selectRunnableStep and its SelectablePhase, SelectableChange, and SelectionResult types no longer exist
    And no source or test file references selectRunnableStep

  Scenario: status derivation and step selection share one eligibility walk
    Given a batch whose derived status surfaces a change-level next step
    When `computeBatchStatus` derives `next` and `pickNextStep` picks its target
    Then both name the same phase and change
    And the runnable-change eligibility walk (ungated phase, runnable change status) exists once, in the engine selection module

  Scenario: batch apply selects the same steps after the move
    Given a batch whose first ungated phase holds a ready change
    When `ratchet batch apply` picks the next step
    Then it selects that change exactly as it did before the move
    And the full test suite passes with the selection order unchanged
