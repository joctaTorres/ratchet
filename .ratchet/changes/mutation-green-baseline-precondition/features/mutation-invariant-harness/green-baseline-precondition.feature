Feature: Mutation harness requires a green baseline before seeding mutants
  As a ratchet user gating a run on a mutation invariant
  I want the harness to prove the test suite is green on the clean tree before it seeds any mutant
  So that a suite that is already red cannot score every mutant "killed" and pass vacuously

  Background:
    Given a mutation invariant with an oracle test command and a seed budget
    And a git working tree the cleanliness probe reports as clean

  Scenario: A red baseline seeds nothing and reports oracle-not-green
    Given the oracle test command exits non-zero on the clean, unmutated tree
    When the harness runs
    Then it seeds no mutant and spawns no agent
    And it never stages or diffs the tree for a fault
    And it returns an "oracle-not-green" outcome whose reason names the test command and its non-zero baseline exit

  Scenario: The baseline oracle runs only after the cleanliness check and reverts itself
    Given the oracle test command passes on the clean, unmutated tree
    When the harness runs
    Then the working-tree cleanliness probe runs first
    And then the baseline oracle test command runs once
    And then the scoped revert runs before any mutant is seeded
    So that anything the baseline oracle wrote cannot leak into the first mutant's diff and the tree is left as clean as it was found

  Scenario: A green baseline preserves the existing seed and classify behavior
    Given the oracle test command passes on the clean, unmutated tree
    And each seeded fault makes the oracle exit non-zero
    When the harness runs
    Then it seeds mutants up to the budget and classifies each one killed or survived
    And a mutant whose oracle still passes is classified survived
    And the harness returns a "completed" outcome carrying those mutants

  Scenario: A baseline oracle that cannot run at all propagates instead of reporting red
    Given the oracle test command throws when invoked on the clean tree, because its binary is missing
    When the harness runs
    Then the thrown error propagates to the caller as "could not run at all"
    And it is not swallowed as an "oracle-not-green" result
    And no mutant is seeded and no agent is spawned
