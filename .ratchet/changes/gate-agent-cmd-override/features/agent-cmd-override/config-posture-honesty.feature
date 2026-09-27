Feature: Operator surfaces report the real posture under an active override
  As an operator inspecting my batch settings
  I want "ratchet batch config" to tell me when an override voids the posture
  So that no surface displays a permission posture as enforced while it is not

  Scenario: Text output marks the posture as not enforced
    Given "RATCHET_BATCH_AGENT_CMD" is set to a non-blank value
    When I run "ratchet batch config"
    Then the posture line states the posture is NOT enforced
    And names "RATCHET_BATCH_AGENT_CMD" as the reason
    And states overridden spawns are refused unless "--allow-agent-override" is passed
    And the plain enforced-looking posture line does not appear

  Scenario: JSON output reports the override state
    Given "RATCHET_BATCH_AGENT_CMD" is set to a non-blank value
    When I run "ratchet batch config --json"
    Then the output carries "agentOverride" with "active": true, the env var name, and "permissionsEnforced": false

  Scenario: Without an override the posture displays as before
    Given "RATCHET_BATCH_AGENT_CMD" is unset or blank
    When I run "ratchet batch config" with and without "--json"
    Then the posture is displayed exactly as today
    And "--json" carries "agentOverride" with "active": false
