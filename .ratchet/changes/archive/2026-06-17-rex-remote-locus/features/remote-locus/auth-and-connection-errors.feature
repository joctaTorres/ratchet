Feature: Authentication and connection failures surface as actionable errors
  As an operator who may misconfigure host, port, or token
  I want clear, actionable errors instead of hangs or raw tracebacks
  So that I can fix the configuration quickly

  Scenario: A valid X-API-Key authenticates the runtime
    Given a swerex-remote server started with a known auth token
    And the runtime is configured with the matching token
    When the runtime calls any endpoint
    Then it sends the token in the "X-API-Key" request header
    And the server accepts the request and the step proceeds

  Scenario: A bad or missing token yields a clear auth error
    Given a swerex-remote server started with a known auth token
    And the runtime is configured with a wrong token
    When the runtime calls an endpoint and the server responds 401 "Invalid API Key"
    Then the runtime resolves with a non-zero exitCode
    And the stderr contains a clear authentication-failure message naming the host
    And the message is not a raw stack trace and the call does not hang

  Scenario: An unreachable server yields an actionable error, not a hang
    Given no server is listening at the configured host and port
    When the runtime attempts the GET /is_alive health check
    And the fetch is rejected or times out within a bounded window
    Then the runtime resolves with a non-zero exitCode
    And the stderr contains an actionable "server unreachable" message naming host and port
    And the run does not hang indefinitely

  Scenario: A swerex runtime exception is surfaced, not swallowed
    Given the server returns a body shaped like {"swerexception": {message, class_path, traceback}}
    When the runtime receives that response
    Then it resolves with a non-zero exitCode
    And the stderr carries the swerexception message in a readable form
