Feature: Mutation evaluator maps a non-green baseline to unevaluable
  As a ratchet user relying on the mutation invariant to close a gaming hole
  I want a mutation invariant whose suite is already red on the clean tree to evaluate unevaluable
  So that "zero survivors" is never reported as a pass when no mutant was meaningfully tested

  Background:
    Given a mutation invariant evaluated over a run with a clean working tree

  Scenario: A non-green baseline evaluates unevaluable, never pass
    Given the oracle test command is already red on the clean, unmutated tree
    When the invariant is evaluated
    Then the outcome status is "unevaluable"
    And the outcome status is never "pass"
    And it is treated as an invariant violation, not a silent pass
    And the evidence explains the baseline was not green and the mutation result would be vacuous

  Scenario: A non-green baseline persists and caches nothing, so a later run may retry
    Given the oracle test command is already red on the clean, unmutated tree
    When the invariant is evaluated
    Then no mutant ran, so no run evidence artifacts are persisted for it
    And no prior-evaluation cache entry is written for this run and invariant

  Scenario: A green baseline still folds the harness result into a scored outcome
    Given the oracle test command passes on the clean, unmutated tree
    And the seeded mutants are classified by the harness
    When the invariant is evaluated
    Then the outcome reflects the mutants evaluated and how many survived
    And the outcome is not forced to "unevaluable" by the baseline gate
