Feature: Eval report verb
  As a user inspecting a run's scorecard and baseline diff
  I want `ratchet eval report` to render the scorecard, failures and regressions
  So that regressions are surfaced first and the overall verdict is clear

  Background:
    Given an isolated tmpdir fixture repo with resolveCurrentPlanningHomeSync
      pointed at the fixture root
    And console.log is spied so emitted output can be asserted

  Scenario: Reporting a run as JSON
    Given a persisted run
    When evalReportCommand runs with --json
    Then the JSON payload is the full report including scorecard and diff

  Scenario: Reporting a clean run as text
    Given a persisted run with passing cases and no baseline
    When evalReportCommand runs without --json
    Then the text output shows the overall verdict and the pass/fail/unjudged counts

  Scenario: Regressions are surfaced first with their evidence
    Given a baseline run and a current run that regressed a previously-passing case
    When evalReportCommand runs without --json
    Then a REGRESSIONS section lists the regressed case before other failures
    And the regressed case's evidence is shown

  Scenario: An incomplete run is flagged
    Given a persisted run with at least one unjudged case
    When evalReportCommand runs without --json
    Then the text output prints the "Run is incomplete" notice

  Scenario: New and retired cases are reported against the baseline
    Given a baseline run and a current run that adds one case and drops another
    When evalReportCommand runs without --json
    Then the output lists the new case and the retired case

  Scenario: A missing --run is rejected
    Given no --run option is supplied
    When evalReportCommand runs without --run
    Then it throws an error naming the required --run option
