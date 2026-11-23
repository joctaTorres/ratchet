Feature: Multi-agent support standard neutrality
  As a ratchet maintainer
  I want the multi-agent-support standard to be atemporal and harness-neutral
  So that it stays correct as coding agents come and go, and it defines the
  agent-neutrality rules rendered skills and commands must follow

  Scenario: The standard enumerates no agent list
    Given the multi-agent-support standard file
    When its body text is read
    Then it names no individual coding agent
    And it refers to the set of supported agents only as the supported-tools
      registry, as a concept

  Scenario: The standard cites no internal file paths
    Given the multi-agent-support standard file
    When its body text is read
    Then it contains no internal repository source path
    And it describes the shared-template and adapter layers by role, not by
      file location

  Scenario: The standard requires capability phrasing with a plain-prose fallback
    Given the multi-agent-support standard file
    When its body text is read
    Then it requires that any reference to an agent-specific capability in
      shared content be phrased as the capability itself with a plain-prose
      fallback that works in any agent
    And it forbids instructing the agent to use a bare agent-specific tool
      name

  Scenario: The standard requires canonical skill references
    Given the multi-agent-support standard file
    When its body text is read
    Then it requires that shared content referencing another ratchet workflow
      use the canonical /rct:<name> form

  Scenario: The standard forbids agent-branching prose
    Given the multi-agent-support standard file
    When its body text is read
    Then it forbids prose in shared content that branches on which agent is
      running
