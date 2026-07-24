Feature: Registry drift guard
  As a ratchet maintainer
  I want a test that fails when the agent registries drift apart
  So that "agents are a subset of init" and "every agent has spawn argv" stay enforced

  Scenario: The three agent registries agree on the same set of ids
    Given the set of agentBinary-marked AI_TOOLS ids
    And the set of BUILTIN_ADAPTERS keys
    And the set of AGENT_BINARIES keys
    When the drift-guard test compares the three sets
    Then all three sets are equal

  Scenario: Each agent's spawn command equals its declared init binary
    Given each agent has a BUILTIN_ADAPTERS spawn adapter
    And each agent has an AI_TOOLS agentBinary
    When the drift-guard test builds each adapter's spawn request
    Then each adapter's resolved command equals that agent's AI_TOOLS agentBinary

  Scenario: An init agent without a spawn adapter fails the guard
    Given an init tool declares an agentBinary
    But no matching BUILTIN_ADAPTERS entry exists for it
    When the drift-guard test runs
    Then the test fails reporting the mismatched id

  Scenario: A spawn adapter without an init agent entry fails the guard
    Given a BUILTIN_ADAPTERS entry exists for an id
    But no agentBinary-marked AI_TOOLS entry exists for it
    When the drift-guard test runs
    Then the test fails reporting the mismatched id
