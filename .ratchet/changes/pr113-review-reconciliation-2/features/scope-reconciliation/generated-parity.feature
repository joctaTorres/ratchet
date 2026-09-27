Feature: Split reconciliation text reaches every generated surface
  As a user running ratchet init or update
  I want the split reconciliation procedure present in every generated skill and command
  So that the rule has one author and no agent tree lags behind another

  Scenario: Both halves land in the claude and opencode skill trees
    Given a project initialized with ratchet init for the claude and opencode agents
    When the generated propose, propose-batch, and decompose-phase skills are read
    Then the claude and opencode copies of each skill carry identical reconciliation text
    And propose and propose-batch each carry both the enumeration half and the mapping-and-surfacing half
    And decompose-phase carries the enumeration half

  Scenario: Every command adapter renders the split text intact
    Given the propose, propose-batch, and decompose-phase command templates
    When each is rendered through every registered command adapter
    Then every rendering contains the enumeration half verbatim
    And every propose and propose-batch rendering contains the mapping-and-surfacing half verbatim

  Scenario: The propose skill and command still differ only in their two known lines
    Given the propose skill instructions and the propose command content
    When the two bodies are compared
    Then they differ only in the Input line and the closing Prompt line
