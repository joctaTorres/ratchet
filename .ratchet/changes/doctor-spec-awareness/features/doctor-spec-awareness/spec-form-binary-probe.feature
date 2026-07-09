Feature: Doctor probes the agent-part binary of a spec-form agent value
  As a ratchet user who configured an `agent[:model]` spec
  I want `ratchet doctor` to probe the binary of the agent part of my configured spec
  So that a missing configured agent CLI surfaces before a batch run fails at spawn

  Scenario: Spec-form configured agent probes the agent-part binary
    Given a project config with batch agent set to "opencode:zai/glm-5.2"
    And the "opencode" binary is on PATH
    When doctor runs its checks
    Then the agent check passes
    And the configured-agent consultation resolved the binary through the parsed agent part "opencode"

  Scenario: The whole spec string is never treated as a binary name
    Given a project config with batch agent set to "opencode:zai/glm-5.2"
    And a binary literally named "opencode:zai/glm-5.2" is on PATH
    And the "opencode" binary is not on PATH
    When doctor runs its checks
    Then the agent check fails naming the configured agent "opencode" as not installed

  Scenario: A configured agent whose binary is missing fails the check even when another agent is detected
    Given a project config with batch agent set to "opencode:zai/glm-5.2"
    And the "claude" binary is on PATH
    And the "opencode" binary is not on PATH
    When doctor runs its checks
    Then the agent check fails naming the configured agent "opencode" as not installed
    And the remedy names the missing binary to install

  Scenario: Every value of a per-stage agent map is parsed and probed
    Given a project config with a batch agent map of propose "claude:fable" and apply "opencode:zai/glm-5.2"
    And the "claude" and "opencode" binaries are on PATH
    When doctor runs its checks
    Then the agent check passes
    And both configured agent binaries were consulted through their parsed agent parts

  Scenario: An unknown agent part is left to spawn-time rejection
    Given a project config with batch agent set to "notreal:some-model"
    And the "claude" binary is on PATH
    When doctor runs its checks
    Then the agent check passes as it does today
    And the report contains no check about the unknown agent "notreal"
