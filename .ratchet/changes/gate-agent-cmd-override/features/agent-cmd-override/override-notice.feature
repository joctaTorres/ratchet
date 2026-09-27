Feature: A loud notice on every spawn made under an override
  As an operator
  I want an unmissable signal whenever an override stands in for the agent
  So that I can never mistake a synthetic run for real agent work

  Scenario: Text output prints the notice on each overridden spawn
    Given "RATCHET_BATCH_AGENT_CMD" is set to a stub command
    When "ratchet batch apply --allow-agent-override" spawns the stub
    Then the line "⚠ agent overridden by RATCHET_BATCH_AGENT_CMD" is written to stderr for that spawn

  Scenario: JSON output flags the overridden step
    Given "RATCHET_BATCH_AGENT_CMD" is set to a stub command
    When "ratchet batch apply --allow-agent-override --json" spawns the stub
    Then the JSON step result carries "agentOverride": true
    And stdout remains a single well-formed JSON document

  Scenario: No override, no notice
    Given "RATCHET_BATCH_AGENT_CMD" is unset
    When "ratchet batch apply --json" spawns the configured agent
    Then the JSON step result has no "agentOverride" field
    And no override notice is written

  Scenario: A refused spawn prints no override notice
    Given "RATCHET_BATCH_AGENT_CMD" is set and the opt-in is absent
    When the engine refuses the spawn
    Then the refusal message is reported instead of the override notice
