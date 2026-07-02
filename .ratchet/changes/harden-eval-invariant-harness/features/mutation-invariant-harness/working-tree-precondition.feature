Feature: Mutation harness working-tree precondition
  As a ratchet user running an eval suite with a mutation invariant
  I want the mutation gate to ignore ratchet's own transient run records
  So that the invariant can actually evaluate in a repo that tracks .ratchet/

  Background:
    Given a git repository that tracks the .ratchet/ directory
    And an eval suite with an active mutation invariant

  Scenario: Mutation invariant evaluates despite a freshly persisted run record
    Given "eval run" has persisted a run record under .ratchet/evals/runs/
    When the mutation harness checks the working tree before seeding
    Then the persisted run record under .ratchet/evals/runs/ is not counted as a dirty working tree
    And the mutation invariant is evaluated rather than reported as unevaluable

  Scenario: Genuine uncommitted user changes still block seeding
    Given the working tree has an uncommitted change outside .ratchet/evals/runs/
    When the mutation harness checks the working tree before seeding
    Then the working tree is reported as unusable for mutation seeding
    And the mutation invariant is reported as unevaluable with a reason naming the dirty tree
