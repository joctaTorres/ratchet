Feature: Approval and rejection resume flows under the gate matrix
  As a batch operator
  I want approving one parked transition to advance the batch to the next checkpoint
  So that every-phase gating pauses at each transition without trapping the batch

  Scenario: approving a parked propose does not exempt the subsequent apply
    Given the batch gate is "every-phase"
    And a propose transition completed and parked awaiting approval
    When the user approves the parked step
    And the next batch apply runs the apply transition to a corroborated completion
    Then the apply step outcome is "awaiting-approval"

  Scenario: approving a parked apply selects verify next
    Given the batch gate is "every-phase"
    And an apply transition completed with all plan tasks checked and parked awaiting approval
    When the user approves the parked step
    Then the next selected transition for the change is "verify"

  Scenario: a rejected transition re-runs with feedback and does not re-park on completion
    Given the batch gate is "every-phase"
    And a propose transition completed and parked awaiting approval
    When the user rejects the parked step with feedback
    And the propose transition re-runs to a corroborated completion
    Then the step outcome is "advanced"

  Scenario: rejection resume framing names the parked transition
    Given the batch gate is "every-phase"
    And an apply transition parked awaiting approval was rejected with feedback
    When the engine builds the resume instructions for the apply transition
    Then the resume guidance names the "apply" transition
    And the resume guidance does not instruct the agent to re-run propose

  Scenario: awaiting-approval park message names the completed transition
    Given the batch gate is "every-phase"
    When a verify transition completes and parks
    Then the outcome message states that verify is complete and awaiting approval
