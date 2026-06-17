Feature: Run a batch step over REST against a swerex-remote server
  As an operator running ratchet against remote execution infrastructure
  I want locus=remote to drive a coding agent through a swerex-remote server
  So that agents run on my own infra (not the host) with the same orchestration

  Background:
    Given a project whose batch settings select locus "remote"
    And a reachable swerex-remote server at the configured host and port
    And the configured auth token matches the server's auth token

  Scenario: A step runs on the remote runtime over the REST API
    Given a step whose agent command is a stub that prints output and exits
    When the engine selects a runtime for the step
    Then it selects the native-Node RexRemoteRuntime, not the Python sidecar runtime
    And the runtime checks server health via GET /is_alive before doing any work
    And the runtime creates a session via POST /create_session
    And the runtime launches the agent command on the server via POST /execute
    And the run resolves with an AgentSpawnResult carrying the accumulated stdout
    And the captured exit code equals the stub agent's exit code

  Scenario: The remote runtime needs no local Python venv
    Given the host has no bootstrapped ReX Python venv on the remote path
    When a step runs on the RexRemoteRuntime
    Then the run completes using only native-Node fetch calls to the server
    And no Python sidecar process is spawned on the host
    And the Python dependency lives only on the swerex-remote server
