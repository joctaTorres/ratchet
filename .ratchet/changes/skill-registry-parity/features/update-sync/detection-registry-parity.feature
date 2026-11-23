Feature: Tool detection covers every shipped workflow
  As a developer running ratchet update
  I want tool detection to recognize every generated skill and command
  So that decompose-phase and open-pr installations are seen, counted, and
  drift-checked like every other workflow

  Scenario: Decompose-phase and open-pr skills count toward skill detection
    Given a project with only the ratchet-decompose-phase and ratchet-open-pr skills installed for a tool
    When ratchet checks that tool's skill status
    Then both skills are counted as detected ratchet skills

  Scenario: Open-pr command is part of command detection
    Given a project with only the open-pr command installed for a tool
    When ratchet checks whether that tool has any generated ratchet command
    Then the tool is detected as command-configured

  Scenario: Detection registry covers every shipped workflow
    Given the set of workflows ratchet generates skills and commands for
    When the detection registry is compared against that set
    Then every workflow's skill directory name is in the detected skill names
    And every workflow's command id is in the detected command ids

  Scenario: Legacy detection entries do not break parity
    Given the detection registry contains a legacy command id with no current workflow
    When the detection registry is compared against the shipped workflow set
    Then every shipped workflow is still covered
