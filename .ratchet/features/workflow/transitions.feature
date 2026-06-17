Feature: Propose, apply, verify transitions
  As the batch execution engine
  I want each transition to advance a change to its next state
  So that a change is driven from intent to verified work across three steps

  Scenario: Propose creates the change toward the phase goal
    Given a change intent with no directory yet
    When the engine runs the propose transition
    Then the agent creates the change with its features and plan
    And the change targets the active phase goal under the resolved strategy

  Scenario: Vertical-slice strategy shapes the propose
    Given the resolved strategy is "vertical-slice"
    When the engine runs propose for the first change of a greenfield phase
    Then the agent is instructed to scope a thin end-to-end slice
    And not a complete feature

  Scenario: Apply implements the planned tasks
    Given a change whose plan exists and is approved or ungated
    When the engine runs the apply transition
    Then the agent implements the change's tasks
    And progress is reflected in the change's plan task checkboxes

  Scenario: Verify checks the work against the change
    Given a change whose apply has completed
    When the engine runs the verify transition
    Then the agent verifies the implementation against the feature scenarios
    And the change is marked done only if verification passes

  Scenario: Advance to the next DAG step after a change is done
    Given a change that has just become done
    When the engine is next asked to run a step
    Then it selects the next ready change unlocked by that completion
