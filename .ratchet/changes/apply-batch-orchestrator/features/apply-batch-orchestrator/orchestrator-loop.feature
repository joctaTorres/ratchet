Feature: Autonomous batch orchestration loop
  As a ratchet user
  I want /rct:apply-batch to drive a batch to completion on my behalf
  So that I do not have to invoke each transition manually

  Background:
    Given a batch named "q3-auth" exists with multiple changes and phases

  Scenario: The orchestrator selects a batch when none is named
    Given no batch name is supplied to /rct:apply-batch
    And more than one batch exists
    When the orchestrator starts
    Then it runs "ratchet batch list --json"
    And it asks the user which batch to drive

  Scenario: The orchestrator loops until the batch is complete
    Given the batch "q3-auth" has several ready transitions and no halts
    When the orchestrator runs
    Then it repeatedly invokes "ratchet batch apply q3-auth"
    And after each advance it reports brief progress to the user
    And it continues the loop without asking permission between steps
    And it stops only when "ratchet batch status q3-auth --json" shows the batch is done
    And on completion it summarizes the finished batch for the user

  Scenario: The underlying CLI advances exactly one transition per invocation
    Given the orchestrator is looping
    When it invokes "ratchet batch apply q3-auth" once
    Then the bundled engine advances exactly one transition
    And the loop that calls apply repeatedly lives in the skill, not in the CLI
