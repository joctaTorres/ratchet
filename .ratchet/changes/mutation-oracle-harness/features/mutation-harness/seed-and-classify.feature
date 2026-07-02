Feature: Mutant seeding, oracle run, and kill/survive classification
  As the eval harness
  I want to drive the configured agent to seed one small fault at a time and run
  the user's own test command against it
  So that a `kind: mutation` invariant can classify each mutant as killed or
  survived without any external mutation framework

  Scenario: A survived mutant is recorded when the test command still passes
    Given a mutation invariant with a test command and a budget of at least 1
    When the harness seeds one mutant through the configured agent's spawn seam
    And the seeded fault leaves the test command passing
    Then the harness classifies that mutant as survived
    And the fault is reverted before the harness returns

  Scenario: A killed mutant is recorded when the test command now fails
    Given a mutation invariant with a test command and a budget of at least 1
    When the harness seeds one mutant through the configured agent's spawn seam
    And the seeded fault makes the test command fail
    Then the harness classifies that mutant as killed
    And the fault is reverted before the harness returns

  Scenario: The harness never seeds more mutants than the invariant's budget
    Given a mutation invariant with a budget of 3
    When the harness runs to completion
    Then at most 3 mutant-seeding attempts are made
    And no further attempt is made once the budget is exhausted

  Scenario: Each mutant is reverted before the next one is seeded
    Given a mutation invariant with a budget of at least 2
    When the harness seeds a second mutant
    Then the first mutant's fault was already reverted before the second attempt
    And the second mutant is seeded against the unmutated project

  Scenario: An attempt where the agent seeds no fault is not counted as a mutant
    Given a mutation invariant with a budget of at least 1
    When the harness asks the agent to seed a mutant and the agent makes no change
    Then the attempt is not recorded as a killed or survived mutant
    And the test command is never run for that attempt

  Scenario: Mutant seeding is agent-neutral
    Given a mutation invariant evaluated with any supported coding agent configured
    When the harness seeds a mutant
    Then the fault is seeded through the same resolved agent adapter and spawn
      seam the llm-judge binding uses, never a hardcoded agent binary
    And the invocation does not depend on any specific coding agent's runner
