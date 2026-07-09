Feature: Decompose is a routable agent stage
  As a batch author
  I want to select the agent and model for the decompose step
  So that phase decomposition runs on the agent I choose, like every other stage

  Background:
    Given the batch agent setting accepts a per-stage map
    And the stage vocabulary is the single source shared by project config and the batch manifest

  Scenario: The stage vocabulary admits decompose alongside the existing stages
    Given the per-stage agent map schema
    When its accepted stage keys are enumerated
    Then they are exactly "propose", "apply", "verify", "pr", and "decompose"
    And any other stage key (for example "deploy") is still rejected as unknown

  Scenario: A decompose entry in project config routes the decompose spawn
    Given ".ratchet/config.yaml" sets "batch.agent.decompose" to "opencode:zai/glm-5.2"
    When the engine runs a phase-decomposition step
    Then it spawns the "opencode" agent
    And the spawned argv carries the model flag for "zai/glm-5.2"

  Scenario: A decompose entry in the batch manifest routes the decompose spawn
    Given the batch manifest sets "settings.agent.decompose" to "opencode:qwen/qwen-3.7"
    When the engine runs a phase-decomposition step
    Then it spawns the "opencode" agent
    And the spawned argv carries the model flag for "qwen/qwen-3.7"

  Scenario: The manifest decompose entry wins over project config nearest-wins
    Given ".ratchet/config.yaml" sets "batch.agent.decompose" to "opencode:zai/glm-5.2"
    And the batch manifest sets "settings.agent.decompose" to "claude:fable"
    When the engine runs a phase-decomposition step
    Then it spawns the "claude" agent with the model flag for "fable"
    And the project-config decompose entry does not apply

  Scenario: A scalar agent setting still covers the decompose step
    Given the batch agent setting is the scalar "opencode:zai/glm-5.2"
    When the engine runs a phase-decomposition step
    Then it spawns the "opencode" agent with the model flag for "zai/glm-5.2"

  Scenario: An unmapped decompose under a per-stage map falls to the default agent
    Given a per-stage agent map that names "apply" and "verify" but not "decompose"
    When the engine runs a phase-decomposition step
    Then it spawns the default agent
    And no model flag is emitted
    And the spawned argv is byte-for-byte the argv produced before decompose was routable

  Scenario: The rendered decompose command and invocation match the routed agent
    Given the batch agent setting routes "decompose" to a non-default agent
    When the engine prepares the decomposition spawn
    Then the decompose command file is rendered in that agent's command format
    And the instruction tells the agent to invoke the decompose command in that agent's syntax

  Scenario: A malformed decompose spec is rejected at config load
    Given ".ratchet/config.yaml" sets "batch.agent.decompose" to "claude:"
    When the configuration is loaded
    Then loading fails naming the offending value "claude:"
    And no agent is spawned
