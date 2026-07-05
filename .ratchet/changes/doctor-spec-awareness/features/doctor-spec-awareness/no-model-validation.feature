Feature: Doctor validates no model id and keeps the registry-wide probe unchanged
  As a ratchet user
  I want doctor to stay silent about the model part of an `agent[:model]` spec
  So that doctor never guesses at model-id validity and existing preflight behavior is preserved

  Scenario: The report emits no model-related check
    Given a project config with batch agent set to "opencode:this/model-does-not-exist"
    And the "opencode" binary is on PATH
    When doctor runs its checks
    Then the agent check passes
    And no check in the report mentions the model string "this/model-does-not-exist"
    And the report contains no model-related check id

  Scenario: Registry-wide probe is unchanged when no agent is configured
    Given a project config with no batch agent setting
    And only the "claude" binary is on PATH
    When doctor runs its checks
    Then the agent check passes listing the detected agents
    And every supported agent binary in the registry was probed

  Scenario: Registry-wide no-agent failure is unchanged
    Given a project config with no batch agent setting
    And no supported agent binary is on PATH
    When doctor runs its checks
    Then the agent check fails naming every supported agent CLI

  Scenario: A bare-name configured agent probes its binary without any model handling
    Given a project config with batch agent set to "claude"
    And the "claude" binary is on PATH
    When doctor runs its checks
    Then the agent check passes
    And no check in the report mentions a model
