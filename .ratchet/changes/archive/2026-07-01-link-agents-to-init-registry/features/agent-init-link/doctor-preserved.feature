Feature: Doctor agent check preserved after the refactor
  As a ratchet user
  I want doctor to still fail when no coding-agent CLI is installed
  So that batch runs are not attempted without a spawnable agent

  Scenario: No agent binary on PATH is a required failure
    Given none of the AGENT_BINARIES is present on PATH
    When I run the doctor agent check
    Then the check status is "fail"
    And the check severity is "required"
    And doctor exits non-zero

  Scenario: Every probed agent corresponds to an init agent tool
    Given the doctor agent check enumerates AGENT_BINARIES
    When the probed agent ids are compared to AI_TOOLS
    Then every probed id is an init tool that declares an agentBinary

  Scenario: A single installed agent satisfies the check
    Given only one agent binary is present on PATH
    When I run the doctor agent check
    Then the check status is "pass"
    And the detected agent is named in the detail
