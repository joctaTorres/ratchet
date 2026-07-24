Feature: Config load warning names the failing batch keys and preserves valid siblings
  As a ratchet user with a typo in one batch setting
  I want readProjectConfig to warn with the actual failing key path and offending value
  So that I can fix the real defect and my valid sibling settings are not silently reverted to defaults

  Scenario: an invalid agent value is warned by name and value, not the generic text
    Given a .ratchet/config.yaml whose batch section sets gate "after-propose", locus "docker", and agent "claude:"
    When readProjectConfig loads the project config
    Then a warning is emitted that contains "agent" and "claude:"
    And the warning does not use the generic "check gate/strategy/proofOfWork values" text

  Scenario: valid sibling settings survive one invalid batch key
    Given a .ratchet/config.yaml whose batch section sets gate "after-propose", locus "docker", and agent "claude:"
    When readProjectConfig loads the project config
    Then the returned config's batch section still contains gate "after-propose" and locus "docker"
    And the batch section contains no agent key

  Scenario: a malformed per-stage map entry is warned with its stage path and value
    Given a .ratchet/config.yaml whose batch agent maps apply to "claude :m"
    When readProjectConfig loads the project config
    Then a warning is emitted that contains "agent.apply" and "claude :m"

  Scenario: an invalid enum sibling is warned independently of a valid agent
    Given a .ratchet/config.yaml whose batch section sets gate "bogus" and agent "claude:fable"
    When readProjectConfig loads the project config
    Then a warning is emitted that contains "gate" and "bogus"
    And the returned config's batch section still contains agent "claude:fable"

  Scenario: a fully valid batch section loads with no warning, byte-for-byte unchanged
    Given a .ratchet/config.yaml whose batch section sets gate "after-propose", locus "docker", and agent "claude:fable"
    When readProjectConfig loads the project config
    Then no warning is emitted
    And the returned batch section equals the values written
