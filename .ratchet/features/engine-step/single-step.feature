Feature: Single-step execution
  As the batch execution engine
  I want each invocation to drive exactly one transition forward
  So that the caller keeps inspection points and agents run with fresh context

  Scenario: Pick the next ready step from the batch DAG
    Given a batch with one ready change and several blocked changes
    When the engine is asked to run a step
    Then it selects a ready change permitted by the active phase and DAG edges
    And it does not select a blocked or gated change

  Scenario: Run exactly one transition then return
    Given a ready change "add-login-api" whose next transition is propose
    When the engine runs a step
    Then it performs only the propose transition
    And it returns control without proceeding to apply

  Scenario: The per-change transition order is propose then apply then verify
    Given a change with no directory yet
    When the engine runs three successive steps for that change
    Then the transitions performed are propose, then apply, then verify

  Scenario: Nothing to do is reported, not an error
    Given a batch where every change is done or gated
    When the engine is asked to run a step
    Then it returns a result indicating no runnable step and why

  Scenario: A fresh agent session is spawned per step
    Given two successive steps for the same change
    When each step runs
    Then each transition is driven by a newly spawned agent process
    And no agent context is carried over between steps except via the run journal
