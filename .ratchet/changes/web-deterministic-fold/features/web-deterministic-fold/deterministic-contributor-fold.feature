Feature: Web bindings fold into the deterministic contributor
  As the eval engine
  I want a `web`-bound case's outcome to gate through the existing `deterministic` contributor
  So that no new gate vocabulary is needed and `eval.gate.deterministic`/`--only`/`--gate` keep controlling it

  Scenario: A failing web-bound case fails the deterministic contributor
    Given a run with one web-bound case judged fail and no deterministic-bound cases
    When the run is aggregated
    Then the deterministic contributor fails
    And its failing ids include the web-bound case

  Scenario: A passing web-bound case introduces no new contributor id
    Given a run with only web-bound cases, all judged pass
    When the run is aggregated
    Then the deterministic contributor passes
    And the run's contributor ids are exactly the four built-in ids

  Scenario: Disabling the deterministic contributor leaves a web-bound case unjudged
    Given a web-bound case and the deterministic contributor disabled via the gate
    When the run executes
    Then the case is recorded unjudged naming the disabled deterministic contributor
    And the web binding's app is never started

  Scenario: Restricting the gate to deterministic still runs web-bound cases
    Given a web-bound case, a llm-judge-bound case, and the gate restricted to deterministic
    When the run executes
    Then the web-bound case is judged
    And the llm-judge-bound case is recorded unjudged naming the disabled llm-judge contributor
