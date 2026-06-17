Feature: The runtime returns the accumulated transcript and exit code
  As the batch engine
  I want the AgentRuntime to return a full AgentSpawnResult after streaming
  So that mapSessionToOutcome keeps working unchanged on the accumulated result

  Scenario: Streamed lines are also accumulated into the result
    Given a fake sidecar that streams the lines "alpha", "beta", and "gamma"
    And then reports exit code 0
    When the runtime runs the step
    Then the returned AgentSpawnResult stdout contains "alpha", "beta", and "gamma"
    And the returned AgentSpawnResult exitCode is 0
    And the result has the same shape the old Spawner returned

  Scenario: A non-zero agent exit is reported in the result
    Given a fake sidecar that streams one line and then reports exit code 2
    When the runtime runs the step
    Then the returned AgentSpawnResult exitCode is 2
    And the streamed line is present in the accumulated stdout

  Scenario: The outcome mapping is unchanged by the streaming path
    Given a runtime that returns an AgentSpawnResult with a captured transcript and exit code
    When the engine maps the session to an outcome
    Then mapSessionToOutcome consumes the result exactly as it did for the Spawner
