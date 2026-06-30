Feature: A disabled contributor leaves the run incomplete and unpromotable
  As a ratchet maintainer
  I want a disabled contributor to record its cases unjudged so the run is incomplete
  So that a partial run can never be promoted to the baseline future runs are judged against

  Background:
    Given an eval set with cases bound as deterministic checks and cases bound as llm-judge
    And a contributor gate that selects which contributors execute

  Scenario: a disabled kind contributor records its cases unjudged rather than executing them
    Given the llm-judge contributor is disabled for the run
    When "ratchet eval run" executes the in-scope set
    Then every llm-judge-bound case is recorded unjudged with a reason that names the disabled contributor
    And no llm-judge case is executed or recorded pass
    And the deterministic-bound cases are still judged normally

  Scenario: a run with a disabled contributor is incomplete
    Given a run executed with the llm-judge contributor disabled and at least one llm-judge-bound case
    When the run's scorecard is computed
    Then the run is reported incomplete because some cases are unjudged

  Scenario: an incomplete run from a disabled contributor cannot be promoted to baseline
    Given a persisted run that is incomplete because a disabled contributor left cases unjudged
    When promotion of that run to baseline is attempted
    Then promotion is refused with an error that the run is incomplete
    And the baseline file is left unchanged

  Scenario: a complete run with every contributor enabled can be promoted
    Given a run executed with every contributor enabled and every case judged pass or fail
    When promotion of that run to baseline is attempted
    Then the run is promoted and recorded as the baseline
