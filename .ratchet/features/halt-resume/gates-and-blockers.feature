Feature: Halt and resume on gates and blockers
  As the batch execution engine
  I want to honor gates and agent-raised blockers and resume cleanly
  So that the user stays aligned without losing run progress

  Scenario: A voluntary blocker parks the step
    Given the resolved gate is "voluntary"
    And an agent raises a blocker during a transition
    When the engine evaluates the step result
    Then the step is parked as blocked with the question
    And the engine performs no further transition for that change

  Scenario: Resume a blocked step with the user's answer
    Given a step parked as blocked with a recorded answer
    When the engine runs the next step for that change
    Then it re-spawns the agent with the question and answer in context

  Scenario: An after-propose gate parks for approval
    Given the resolved gate is "after-propose"
    When a propose transition completes
    Then the step is parked as awaiting-approval
    And no apply transition runs until the user approves

  Scenario: Approval lets apply proceed
    Given a step parked as awaiting-approval that the user has approved
    When the engine runs the next step
    Then it proceeds to the apply transition

  Scenario: Reject-with-feedback re-runs propose without rolling back
    Given a step parked as awaiting-approval that the user rejected with feedback
    When the engine runs the next step
    Then it re-runs propose with the prior draft and feedback in context
    And no other change or phase is rolled back

  Scenario: Autonomous gate never parks for approval
    Given the resolved gate is "autonomous"
    When transitions complete without blockers
    Then the engine advances through propose, apply, and verify without approval pauses
    And blockers raised by an agent still park the step
