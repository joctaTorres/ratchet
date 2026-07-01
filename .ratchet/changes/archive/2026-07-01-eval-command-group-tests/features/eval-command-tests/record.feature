Feature: Eval record verb
  As a user overriding a single case verdict
  I want `ratchet eval record` to validate its flags and persist the override
  So that a manual verdict is recorded atomically or the run is left unchanged

  Background:
    Given an isolated tmpdir fixture repo with resolveCurrentPlanningHomeSync
      pointed at the fixture root
    And console.log is spied so emitted output can be asserted

  Scenario: Recording a manual pass verdict
    Given a persisted run containing one case
    When evalRecordCommand runs with --run, --case and --verdict pass
    Then the run records the verdict with source "manual"
    And a success confirmation is printed

  Scenario: Recording a manual verdict emits a JSON payload
    Given a persisted run containing one case
    When evalRecordCommand runs with --json and a valid pass verdict
    Then the JSON payload reports the runId, caseId, verdict, and source "manual"

  Scenario: A missing --run is rejected
    Given no --run option is supplied
    When evalRecordCommand runs without --run
    Then it throws an error naming the required --run option

  Scenario: A missing --case is rejected
    Given --run is supplied but --case is not
    When evalRecordCommand runs without --case
    Then it throws an error naming the required --case option

  Scenario: A missing --verdict is rejected
    Given --run and --case are supplied but --verdict is not
    When evalRecordCommand runs without --verdict
    Then it throws an error naming the required --verdict option

  Scenario: A fail verdict without evidence is rejected and leaves the run unchanged
    Given a persisted run containing one case
    When evalRecordCommand runs with a fail verdict and no --evidence
    Then it throws an error
    And the persisted run is unchanged
