Feature: Non-JSON protocol frames are surfaced, not dropped
  As a developer debugging a sidecar or agent failure
  I want stray protocol-channel output routed to the step's diagnostic transcript
  So that a sidecar bug printing to stdout is visible instead of vanishing

  Scenario: A non-JSON line on the protocol channel reaches the diagnostic transcript
    Given the sidecar runtime is parsing protocol-channel lines
    When a line arrives that is not valid JSON
    Then the raw line is appended to the run's diagnostic transcript with a protocol-diagnostic prefix
    And the run's outcome mapping is unchanged by the diagnostic

  Scenario: An unknown event kind reaches the diagnostic transcript
    Given the sidecar runtime is dispatching parsed protocol events
    When an event arrives whose kind is not a recognized protocol event
    Then the event is recorded in the run's diagnostic transcript with a protocol-diagnostic prefix
    And known events continue to be handled exactly as before
