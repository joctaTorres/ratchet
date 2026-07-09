Feature: Approval gate matrix parks transitions per gate policy
  As a batch operator
  I want each gate value to park exactly the transitions its documentation names
  So that an `every-phase` batch cannot apply and verify its way to done without a human checkpoint

  Background:
    Given a batch with one phase and one change
    And the change-step agent reports a corroborated completion for its transition

  Scenario: voluntary gate never parks a completed transition
    Given the batch gate is "voluntary"
    When a propose transition completes
    Then the step outcome is "advanced"
    And no awaiting-approval park is recorded for the change

  Scenario: after-propose gate parks a completed propose
    Given the batch gate is "after-propose"
    When a propose transition completes
    Then the step outcome is "awaiting-approval"
    And the parked step's kind is "awaiting-approval"

  Scenario: after-propose gate does not park apply or verify
    Given the batch gate is "after-propose"
    When an apply transition completes
    Then the step outcome is "advanced"
    And no awaiting-approval park is recorded for the change

  Scenario Outline: every-phase gate parks every completed change transition
    Given the batch gate is "every-phase"
    When a <transition> transition completes
    Then the step outcome is "awaiting-approval"
    And the awaiting-approval message names the "<transition>" transition

    Examples:
      | transition |
      | propose    |
      | apply      |
      | verify     |

  Scenario: autonomous gate never parks a completed transition
    Given the batch gate is "autonomous"
    When a propose transition completes
    Then the step outcome is "advanced"
    And no awaiting-approval park is recorded for the change

  Scenario: decomposition steps never park for approval under every-phase
    Given the batch gate is "every-phase"
    And a reachable ungated phase with an empty changes list
    When the decomposition step completes
    Then the step outcome is "advanced"
    And no awaiting-approval park is recorded for the phase's decomposition key

  Scenario: PR-open steps never park for approval under every-phase
    Given the batch gate is "every-phase"
    And a fired PR group boundary
    When the PR-open step completes
    Then the step outcome is "advanced"
    And no awaiting-approval park is recorded for the PR key
