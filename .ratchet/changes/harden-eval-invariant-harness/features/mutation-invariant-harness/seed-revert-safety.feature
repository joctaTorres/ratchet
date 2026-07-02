Feature: Mutation harness seed/revert safety
  As a ratchet user whose real code is mutated during an eval run
  I want the harness to always restore my working tree
  So that a seeded fault can never survive when an attempt fails midway

  Background:
    Given a mutation invariant with a seeding budget

  Scenario: A throw mid-attempt still reverts the seeded mutant
    Given a seeded mutant has been staged for an attempt
    When the oracle command throws before the attempt completes
    Then the working tree is reverted to its original state
    And the error propagates so the invariant is reported as unevaluable

  Scenario: Each completed attempt leaves the tree exactly as it started
    Given an attempt seeds and classifies a mutant
    When the attempt completes
    Then the seeded mutant is reverted before the next attempt begins
