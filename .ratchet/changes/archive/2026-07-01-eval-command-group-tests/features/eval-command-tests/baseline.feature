Feature: Eval baseline verb
  As a user pinning a run as the comparison baseline
  I want `ratchet eval baseline` to promote a run id and confirm it
  So that subsequent reports diff against a known-good baseline

  Background:
    Given an isolated tmpdir fixture repo with resolveCurrentPlanningHomeSync
      pointed at the fixture root
    And console.log is spied so emitted output can be asserted

  Scenario: Promoting a run to the baseline
    Given a persisted run with a known run id
    When evalBaselineCommand runs with that run id
    Then .ratchet/evals/baseline.json records the run id
    And a success confirmation is printed

  Scenario: Promoting a run emits a JSON payload
    Given a persisted run with a known run id
    When evalBaselineCommand runs with --json and that run id
    Then the JSON payload reports the baseline run id

  Scenario: A missing run id is rejected
    Given no run id argument is supplied
    When evalBaselineCommand runs with no run id
    Then it throws an error naming the required <run-id> argument
