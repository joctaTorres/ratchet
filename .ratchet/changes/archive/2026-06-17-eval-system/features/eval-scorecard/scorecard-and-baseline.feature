Feature: Eval scorecard and baseline regression diff
  As a developer ratcheting the spec forward
  I want each run scored and compared against a baseline run
  So that a scenario that once passed can never silently regress

  Scenario: The report scores a run
    Given a run with recorded pass, fail and unjudged verdicts
    When I run "ratchet eval report --run <run-id> --json"
    Then the scorecard counts pass, fail and unjudged cases
    And each failing case is listed with its evidence

  Scenario: Unjudged cases keep a run incomplete
    Given a run where some cases are unjudged
    When the report is produced
    Then those cases are counted as unjudged
    And the run is not declared complete

  Scenario: A run can be promoted to baseline
    Given a completed run "<run-id>"
    When I run "ratchet eval baseline <run-id>"
    Then ".ratchet/evals/baseline.json" points at that run

  Scenario: Regressions against the baseline are flagged
    Given a baseline run where case "status-as-json" passed
    And a new run where the same case failed
    When I run "ratchet eval report --run <run-id> --json"
    Then the report flags "status-as-json" as a regression
    And the overall verdict is failing while any regression exists

  Scenario: New and retired cases are diffed, not failed
    Given a baseline run and a new run whose eval sets differ
    When the report is produced
    Then cases only in the new run are listed as new
    And cases only in the baseline are listed as retired
    And neither category counts as a regression
