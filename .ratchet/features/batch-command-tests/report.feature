Feature: batch report verb behavior is proven by tests
  As a maintainer holding ratchet to the testing standard
  I want `batchReportCommand`'s single-report-kind channel under test
  So that each report kind writes the right journal/park state and malformed
    invocations are rejected

  Background:
    Given an isolated tmpdir fixture repo built under os.tmpdir()
    And `resolveCurrentPlanningHomeSync` is pointed at the fixture root
    And a batch with a change to report against

  Scenario: a missing --change is rejected
    When batchReportCommand runs with no --change
    Then it throws an error that --change is required

  Scenario: providing no report kind is rejected
    When batchReportCommand runs with a change but no report kind
    Then it throws an error listing the valid report kinds

  Scenario: providing more than one report kind is rejected
    When batchReportCommand runs with both --status and --complete
    Then it throws an error that exactly one report kind is allowed

  Scenario: a status report appends progress to the journal
    When batchReportCommand runs with --status "<note>"
    Then a progress entry is appended to the change journal
    And it prints that progress was recorded

  Scenario: a blocker report parks the step as blocked
    When batchReportCommand runs with --blocker "<question>"
    Then a blocker entry is journaled
    And the step is parked as blocked with that reason

  Scenario: a needs-input report parks the step awaiting input
    When batchReportCommand runs with --needs-input "<request>"
    Then a needs-input entry is journaled
    And the step is parked as blocked with that reason

  Scenario: a completion report records completion
    When batchReportCommand runs with --complete "<summary>"
    Then a completion entry is journaled
    And it prints that completion was recorded

  Scenario: a completion under an after-propose gate parks for approval
    When batchReportCommand runs with --complete and awaitingApproval set
    Then the step is parked awaiting approval with that reason

  Scenario: an answer report records the answer for resume
    When batchReportCommand runs with --answer "<answer>"
    Then the answer is recorded against the parked step
    And it prints that the next apply will resume the agent

  Scenario: a reject report records reject feedback
    When batchReportCommand runs with --reject "<feedback>"
    Then the reject feedback is recorded
    And it prints that the next apply re-runs propose
