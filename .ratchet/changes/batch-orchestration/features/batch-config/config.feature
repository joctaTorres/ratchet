Feature: Batch configuration
  As a developer tuning batch autonomy and rigor
  I want batch defaults in .ratchet/config.yaml with per-batch overrides
  So that the same engine behaves differently per project and per batch

  Scenario: Defaults are loaded from the project config
    Given ".ratchet/config.yaml" contains a "batch" section
    When I run "ratchet batch config"
    Then the resolved batch settings reflect the project config values

  Scenario: Sensible defaults when no batch section is present
    Given ".ratchet/config.yaml" has no "batch" section
    When I run "ratchet batch config"
    Then the gate is "voluntary"
    And the strategy is "vertical-slice"
    And the proofOfWork policy is "hard-gate"

  Scenario: The gate policy is a dial
    Given a project using the default gate
    When I run "ratchet batch config --set gate=after-propose"
    Then the gate value in ".ratchet/config.yaml" becomes "after-propose"
    And the accepted gate values are "voluntary", "after-propose", "every-phase", and "autonomous"

  Scenario: A batch manifest overrides project defaults
    Given the project gate is "voluntary"
    And the manifest for "q3-auth" sets gate to "after-propose"
    When the resolved settings for "q3-auth" are computed
    Then the effective gate for "q3-auth" is "after-propose"

  Scenario: Reading effective settings for a specific batch
    When I run "ratchet batch config q3-auth"
    Then the output shows the effective gate, strategy, proofOfWork, and agent for that batch
    And it indicates which values came from the manifest versus the project config

  Scenario: Invalid setting values are rejected
    When I run "ratchet batch config --set gate=whenever"
    Then the command fails listing the allowed gate values
    And the config file is left unchanged
