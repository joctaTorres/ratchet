Feature: Coding-agent registry derived from init tools
  As a ratchet maintainer
  I want the batch coding-agent registry to be derived from the init tool registry
  So that init (AI_TOOLS) is the single source of truth for which coding agents exist

  Background:
    Given AI_TOOLS in src/core/config.ts is the registry of init tools
    And each AIToolOption may carry an optional agentBinary field naming a spawnable coding-agent binary

  Scenario: AGENT_BINARIES is derived from agentBinary-marked init tools
    Given the init tools claude, codex, cursor, and gemini each declare an agentBinary
    And the init tools github-copilot and opencode declare no agentBinary
    When AGENT_BINARIES is computed
    Then AGENT_BINARIES has exactly the keys claude, codex, cursor, and gemini
    And AGENT_BINARIES maps each id to its AI_TOOLS agentBinary
    And cursor maps to the binary "cursor-agent"
    And AGENT_BINARIES excludes github-copilot and opencode

  Scenario: Adding an init agent tool with an agentBinary makes doctor probe it automatically
    Given a new init tool is added to AI_TOOLS with an agentBinary
    And a matching spawn adapter is registered in BUILTIN_ADAPTERS
    When checkAgents enumerates the supported agents
    Then the new agent's binary is among the probed binaries
    And no edit to doctor's agents check was required

  Scenario: Non-agent init tools are never probed as coding agents
    Given github-copilot and opencode are init tools without an agentBinary
    When checkAgents enumerates the supported agents
    Then github-copilot and opencode are not among the probed agent binaries
