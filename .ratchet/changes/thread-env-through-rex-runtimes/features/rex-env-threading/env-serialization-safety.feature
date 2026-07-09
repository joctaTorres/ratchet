Feature: Request env is serialized into the launch command safely
  As a batch engine maintainer
  I want env serialization to be shell-safe and shared by both rex runtimes
  So that arbitrary env values cannot break or inject into the launch command,
  and the two runtimes cannot drift apart in how they apply env

  Scenario: Env values containing shell metacharacters are quoted safely
    Given an AgentSpawnRequest env entry whose value contains single quotes, spaces, and "$" characters
    When the env is serialized into the launch command
    Then the launched agent observes the value byte-for-byte unchanged
    And the metacharacters are not interpreted by the shell

  Scenario: Env entries with names that are not valid shell identifiers are skipped
    Given an AgentSpawnRequest env containing an entry whose name is not a valid shell identifier
    When the env is serialized into the launch command
    Then that entry is omitted from the serialized exports
    And all valid-identifier entries are still exported

  Scenario: Both runtimes serialize env through one shared helper
    Given the rex sidecar runtime and the rex remote runtime
    When each constructs its agent launch command from an AgentSpawnRequest
    Then both delegate env serialization to the same shared helper function
