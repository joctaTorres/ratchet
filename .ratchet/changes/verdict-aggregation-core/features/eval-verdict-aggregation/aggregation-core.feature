Feature: Single verdict-aggregation core decides an eval run's pass
  As a ratchet maintainer
  I want one module that decides an eval run's overall pass as a logical AND over named contributors
  So that the gate has a single source of truth and new gate capabilities plug in at a defined extension point

  Background:
    Given an eval run with a snapshot of judged cases and a baseline diff
    And the verdict-aggregation core that evaluates a set of named contributors over that run

  Scenario: The run passes only when every contributor passes
    Given the deterministic, llm-judge, and regression contributors all report pass
    When the aggregation core computes the run's overall verdict
    Then the overall verdict is pass
    And the result lists each contributor with its own pass status

  Scenario: A single failing contributor fails the whole run (logical AND)
    Given the deterministic contributor reports fail because a bound check case failed
    And every other contributor reports pass
    When the aggregation core computes the run's overall verdict
    Then the overall verdict is fail
    And the failing contributor is identified in the per-contributor breakdown
    And the contributor breakdown names the case ids that caused its failure

  Scenario: A regression alone fails the run even when no case failed this run
    Given no case in the current run is judged fail
    But a case that passed in the baseline is now not passing, so the regression contributor reports fail
    When the aggregation core computes the run's overall verdict
    Then the overall verdict is fail
    And the regression contributor is the one reporting fail in the breakdown

  Scenario: A registered contributor with nothing to report is neutral to the AND
    Given the invariants contributor is registered as a defined extension point
    And the invariants contributor currently has nothing to evaluate, so it reports pass
    When the aggregation core computes the run's overall verdict over all registered contributors
    Then the empty contributor does not change the overall verdict
    And the overall verdict equals the AND of the remaining contributors

  Scenario: report.ts routes its overall verdict through the aggregation core
    Given a persisted run with at least one failing bound case
    When the eval report is built for that run
    Then the report's overall verdict is the value returned by the aggregation core
    And no inline pass/fail expression decides the overall verdict outside the aggregation core

  Scenario: the eval run command surfaces the aggregated verdict and its contributors
    Given a completed eval run whose deterministic contributor reports fail
    When ratchet eval run renders its result
    Then the rendered output reports the overall verdict decided by the aggregation core
    And the output breaks the verdict down by contributor
