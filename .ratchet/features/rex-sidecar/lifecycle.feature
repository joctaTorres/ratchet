Feature: ReX sidecar lifecycle over stdio JSON-lines
  As the batch engine that needs to drive a coding agent through SWE-ReX
  I want a Python sidecar that speaks newline-delimited JSON on stdin/stdout
  So that the Node side can start a ReX deployment, run commands, and shut down cleanly

  Background:
    Given the ratchet-owned Python runtime has been bootstrapped with swe-rex importable
    And the sidecar script is launched with REX_LOCUS unset (defaulting to "local")

  Scenario: Sidecar announces readiness after starting a local deployment
    Given the sidecar process has been started
    When it has started a LocalDeployment and opened a bash session
    Then it emits a single JSON line {"event":"ready","locus":"local"} on stdout
    And it does not emit any other event before "ready"

  Scenario: Sidecar shuts down cleanly on a shutdown op
    Given the sidecar has emitted "ready"
    When the Node side writes the line {"op":"shutdown"} to the sidecar's stdin
    Then the sidecar stops the ReX deployment
    And it emits {"event":"closed"} on stdout
    And the process exits with code 0

  Scenario: Sidecar selects the deployment by the REX_LOCUS switch
    Given REX_LOCUS is set to "local"
    When the sidecar starts
    Then it constructs a LocalDeployment (not a DockerDeployment)
    And the "ready" event reports "locus":"local"

  Scenario: An exception surfaces as an error event, not a crash
    Given the sidecar has emitted "ready"
    When an operation raises an exception inside the sidecar
    Then the sidecar emits a JSON line with an "event":"error" carrying the failure detail
    And the sidecar remains usable or shuts down cleanly rather than dying with an unhandled traceback
