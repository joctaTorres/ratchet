Feature: Eval runs
  As a developer ratcheting the spec forward
  I want a run to judge every in-scope case and persist the verdicts
  So that the result is a reproducible, scored artifact

  Scenario: A run judges in-scope cases and is persisted
    Given a project with bound eval cases in scope
    When I run "ratchet eval run --json"
    Then each bound case is judged through the engine backend
    And a run is persisted under ".ratchet/evals/runs/" with one verdict per case
    And the command reports the run id and the scorecard

  Scenario: Verdicts are pass, fail or unjudged
    Given a run over a mix of bound and unbound cases
    When the run completes
    Then each case carries a verdict of "pass", "fail" or "unjudged"
    And failing cases carry the judge's reason as evidence

  Scenario: Scope flags select which cases run
    Given a feature store and an active change "add-login"
    When I run "ratchet eval run --change add-login"
    Then only cases from "add-login" feature files are judged

  Scenario: A verdict can be overridden manually
    Given a persisted run with an "unjudged" case
    When I run "ratchet eval record --run <run-id> --case <case-id> --verdict pass --evidence '<why>'"
    Then the run stores the manual verdict and its evidence
    And the override is marked as manually recorded

  Scenario: A failing manual override requires evidence
    Given a persisted run with an "unjudged" case
    When I record a "fail" verdict without evidence
    Then the command exits non-zero
    And the run is left unchanged
