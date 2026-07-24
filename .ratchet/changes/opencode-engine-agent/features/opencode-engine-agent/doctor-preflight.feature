Feature: Doctor probes the opencode binary automatically
  As a ratchet operator
  I want ratchet doctor to report whether the opencode agent binary is on PATH
  So that I know whether headless opencode-driven batches will spawn successfully

  Background:
    Given doctor enumerates the supported coding agents from AGENT_BINARIES
    And AGENT_BINARIES is derived from the agentBinary-marked init tools

  Scenario: doctor includes opencode in its agent preflight
    Given the opencode init tool declares agentBinary "opencode"
    When doctor enumerates the supported coding agents
    Then opencode is among the probed agent binaries
    And no edit to doctor's agents check was required beyond the registry derivation

  Scenario: doctor reports opencode missing when it is not on PATH
    Given the opencode binary is not resolvable on PATH
    When doctor runs the agent preflight
    Then it reports opencode as missing
    And the "at least one installed agent" rule still passes when another agent binary resolves
