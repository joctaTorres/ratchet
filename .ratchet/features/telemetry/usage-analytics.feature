Feature: Usage telemetry gating
  As a privacy-conscious user
  I want telemetry disabled by default and easy to opt out of
  So that nothing is sent unless analytics are explicitly configured and permitted

  Scenario: Telemetry is disabled when no analytics key is configured
    Given the shipped binary has no analytics key configured
    When any command runs
    Then telemetry is reported as disabled
    And no events are sent and no first-run notice is shown

  Scenario: Opt-out environment variables disable telemetry
    Given telemetry would otherwise be enabled
    And an opt-out signal such as "RATCHET_TELEMETRY=0" or "DO_NOT_TRACK=1" is set
    When a command runs
    Then telemetry is disabled
    And nothing is sent

  Scenario: Telemetry is auto-disabled in CI
    Given the environment variable "CI" is set to "true"
    When a command runs
    Then telemetry is disabled automatically
    And no events are captured

  Scenario: The first-run notice is shown only when telemetry is enabled
    Given telemetry is enabled and the notice has not been seen
    When the next command runs
    Then a one-time notice about anonymous usage stats with an opt-out hint is printed
    And the notice is marked seen so it is not shown again

  Scenario: Telemetry failures never break the CLI
    Given telemetry is enabled but the analytics backend is unreachable
    When a command completes and attempts to send an event
    Then the failure is swallowed silently
    And the command's own result is unaffected
