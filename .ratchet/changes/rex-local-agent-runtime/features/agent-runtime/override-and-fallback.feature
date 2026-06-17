Feature: The agent-command override and the direct-spawn fallback
  As a developer and as the test harness
  I want RATCHET_BATCH_AGENT_CMD to run through the streaming runtime
  And the old direct-spawn Spawner preserved as a fallback seam
  So that deterministic tests exercise the streaming path and a fallback exists for one release

  Scenario: RATCHET_BATCH_AGENT_CMD runs through the streaming runtime
    Given RATCHET_BATCH_AGENT_CMD is set to a stub command
    And the execution locus is "local"
    When the engine runs a step
    Then the stub command runs through the AgentRuntime, not a bare spawn
    And its output is streamed line-by-line via onEvent
    And the accumulated result and exit code are returned to mapSessionToOutcome

  Scenario: A blank override is treated as unset
    Given RATCHET_BATCH_AGENT_CMD is set to whitespace only
    When the engine runs a step
    Then the configured agent adapter is used to build the run command
    And the step still runs through the streaming runtime

  Scenario: The direct-spawn Spawner remains as a fallback seam
    Given the AgentRuntime seam is the default path for the local locus
    When the runtime is unavailable or explicitly bypassed
    Then the legacy direct-spawn Spawner path is still reachable for one release
    And the default for local remains the ReX-local runtime

  Scenario: A fake runtime is injectable for tests without Python
    Given a fake AgentRuntime injected into the engine
    When a step runs
    Then no real Python or sidecar process is started
    And the engine drives the run through the injected runtime
