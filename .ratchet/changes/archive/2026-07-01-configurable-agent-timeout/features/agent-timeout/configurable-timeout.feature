Feature: Configurable per-agent timeout
  As an operator driving a batch whose proof-of-work is long-running
  I want to raise the per-agent ReX timeout via config or environment
  So that a slow-but-passing transition is not killed mid-run at the hardcoded 600s

  Background:
    Given a ratchet project whose batches drive agents through a ReX runtime
    And the built-in default per-agent timeout is 600000ms

  Scenario: Default timeout is unchanged when nothing is configured
    Given no agent-timeout key in ".ratchet/config.yaml"
    And no agent-timeout environment variable is set
    When the engine constructs a ReX agent runtime
    Then the runtime's per-agent timeout is 600000ms

  Scenario: A config key raises the per-agent timeout
    Given ".ratchet/config.yaml" sets "batch.agentTimeoutMs" to 1800000
    And no agent-timeout environment variable is set
    When the engine constructs a ReX agent runtime
    Then the runtime's per-agent timeout is 1800000ms

  Scenario: An environment variable raises the per-agent timeout
    Given no agent-timeout key in ".ratchet/config.yaml"
    And the environment variable "RATCHET_AGENT_TIMEOUT_MS" is "1800000"
    When the engine constructs a ReX agent runtime
    Then the runtime's per-agent timeout is 1800000ms

  Scenario: The environment variable takes precedence over the config key
    Given ".ratchet/config.yaml" sets "batch.agentTimeoutMs" to 1800000
    And the environment variable "RATCHET_AGENT_TIMEOUT_MS" is "2400000"
    When the engine constructs a ReX agent runtime
    Then the runtime's per-agent timeout is 2400000ms

  Scenario: The resolved timeout is honored by the local sidecar runtime
    Given ".ratchet/config.yaml" sets "batch.agentTimeoutMs" to 1800000
    When the engine constructs a local sidecar runtime
    Then the sidecar runtime is given a per-agent timeout of 1800000ms

  Scenario: The resolved timeout is honored by the remote runtime
    Given ".ratchet/config.yaml" sets "batch.agentTimeoutMs" to 1800000
    When the engine constructs a remote runtime
    Then the remote runtime is given a per-agent timeout of 1800000ms

  Scenario Outline: A non-positive or non-numeric value falls back to the default
    Given the environment variable "RATCHET_AGENT_TIMEOUT_MS" is "<value>"
    And no agent-timeout key in ".ratchet/config.yaml"
    When the engine constructs a ReX agent runtime
    Then the runtime's per-agent timeout is 600000ms

    Examples:
      | value     |
      | 0         |
      | -1        |
      | not-a-num |
      |           |
