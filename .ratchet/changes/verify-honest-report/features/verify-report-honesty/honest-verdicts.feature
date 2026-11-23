Feature: Honest verify reporting
  As a ratchet user relying on /rct:verify as the gate before archive
  I want the verify workflow to report only what it actually proved
  So that a change can no longer pass verification on inference, skipped
  checks, or a stale test claim

  Scenario: A scenario with no implementation and no test is CRITICAL
    Given the shared workflow template for verify-change
    When its body is rendered
    Then it directs the agent to add a CRITICAL issue for any scenario with
      no implementation and no test covering it
    And it no longer classifies that case as a WARNING
    And any CRITICAL issue blocks the "Ready for archive" assessment

  Scenario: A check that could not run is reported "Not verified" and blocks readiness
    Given the shared workflow template for verify-change
    When its body is rendered
    Then it directs the agent to report any check that could not run as
      "Not verified" with the reason
    And a check reported "Not verified" is never scored as passing
    And the final assessment names every "Not verified" check and its reason
      instead of claiming readiness
    And "Ready for archive" appears only when every applicable check ran and
      no CRITICAL issues remain

  Scenario: Verify runs the project's own discovered test command and cites the fresh result
    Given the shared workflow template for verify-change
    When its body is rendered
    Then it directs the agent to discover the project's own test command from
      the project itself, without adding new ratchet configuration
    And it directs the agent to run that command fresh during verification
      and cite the fresh result in the report
    And a test command that cannot be discovered or does not pass is reported
      "Not verified" or as a CRITICAL issue, blocking "Ready for archive"

  Scenario: Reasonable inference no longer counts as test evidence
    Given the shared workflow template for verify-change
    When its body is rendered
    Then it states that reasonable inference no longer counts as test
      evidence
    And test evidence means a fresh run of the project's own test command

  Scenario: @holdout handling is unchanged
    Given the shared workflow template for verify-change
    When its body is rendered
    Then it still directs exactly one non-blocking WARNING naming only the
      held-out scenario count when heldOutCount is greater than zero
    And it still forbids guessing or recovering held-out scenario names or
      steps
    And it still forbids treating the absence of held-out scenarios as a
      coverage gap
