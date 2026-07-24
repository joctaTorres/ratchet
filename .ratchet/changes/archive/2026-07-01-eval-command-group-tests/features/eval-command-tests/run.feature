Feature: Eval run verb
  As a user judging the eval set
  I want `ratchet eval run` to snapshot, judge, persist and score a run
  So that I get a reproducible scorecard over an isolated fixture repo

  Background:
    Given an isolated tmpdir fixture repo with resolveCurrentPlanningHomeSync
      pointed at the fixture root
    And console.log is spied so emitted output can be asserted
    And no real coding agent is ever spawned

  Scenario: Running an unbound set produces an incomplete, unjudged run
    Given the store contains a single unbound case
    When evalRunCommand runs without --json
    Then a run is persisted under .ratchet/evals/runs/
    And the text scorecard reports the case as unjudged
    And it prints the "Run is incomplete" notice

  Scenario: Running emits the scorecard and warnings as JSON
    Given the store contains a single unbound case
    When evalRunCommand runs with --json
    Then the JSON payload reports the runId, the scorecard, and any warnings

  Scenario: An invalid judge mode is rejected before any run is persisted
    Given --judge is set to an invalid value
    When evalRunCommand runs
    Then it throws the invalid-judge error
    And no run is persisted
