Feature: Raw per-agent override escape hatch is honored
  As an advanced ratchet operator
  I want to inject raw permission flags for a specific agent
  So that I can handle uncommon cases the abstracted posture does not cover

  Scenario: raw per-agent override flags are appended for the matching agent
    Given a permission policy with a raw override for agent "claude" listing extra flags
    And the configured agent is "claude"
    When the engine builds the agent spawn request
    Then the configured raw override flags are appended to the claude argv

  Scenario: a raw override for a different agent is ignored
    Given a permission policy with a raw override for agent "codex"
    And the configured agent is "claude"
    When the engine builds the agent spawn request
    Then the codex raw override flags are not present in the claude argv

  Scenario: secret-bearing policy fields are redacted when settings are printed
    Given a resolved permission policy that includes a sensitive raw override value
    When the batch settings are rendered for display or logging
    Then the sensitive value is redacted in the output
