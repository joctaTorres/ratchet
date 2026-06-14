Feature: Live proof-of-work boots a local swerex-remote server
  As the batch phase gate
  I want a blackbox test that runs a real step against a real REST server
  So that the remote runtime is proven end-to-end on this machine

  Scenario: The proof-of-work boots a server and runs a streamed step
    Given the bootstrapped venv provides the "swerex-remote" console script
    When the test boots a local swerex-remote server with a known auth token on a free port
    And it points the RexRemoteRuntime at localhost and that port
    And it drives a stub agent step that emits output incrementally
    Then the output streams incrementally over REST
    And the captured exit code equals the stub agent's exit code
    And the server is torn down at the end of the test

  Scenario: The proof-of-work asserts the auth-failure path
    Given a booted local swerex-remote server with a known auth token
    When the runtime is pointed at it with a wrong token
    Then the run surfaces a clear auth error with a non-zero result
    And the server is torn down

  Scenario: The proof-of-work skips cleanly when swerex-remote is unavailable
    Given Python or swe-rex or the swerex-remote script is genuinely unavailable
    When the proof-of-work runs
    Then it prints an explicit SKIP message and exits 0
    But it never silently passes when the prerequisites are present
