Feature: Attributed model failure for the decompose stage
  As a batch author whose decompose model id is wrong
  I want the failure to name the decompose stage, agent, model, and supplying scope
  So that I can find and fix the bad model without guessing

  Scenario: A named decompose model that dies with the argv-rejection signature is attributed
    Given the batch agent setting routes "decompose" to "opencode:not-a-real-model"
    And the decompose spawn exits non-zero with no completion and an empty session journal
    When the failure is surfaced
    Then the opening hint names the stage "decompose"
    And it names the agent "opencode" and the model "not-a-real-model"
    And it names the scope that supplied the setting
    And the hint is phrased as "if this model id is invalid" rather than a diagnosis
    And the verbatim stderr tail is shown below the hint

  Scenario: The supplying scope in the hint reflects where the decompose entry came from
    Given the batch manifest supplies the decompose entry that named the model
    When a decompose model failure is attributed
    Then the named scope is the manifest, not the project config

  Scenario: A decompose failure without an explicitly named model is not attributed
    Given the batch agent setting routes "decompose" to a bare agent name with no model
    And the decompose spawn fails
    When the failure is surfaced
    Then no attribution hint is added
    And the failure surface is byte-for-byte unchanged
