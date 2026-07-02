Feature: Web binding judging dispatch
  As the eval engine
  I want judgeCase to run a `web` binding through the lifecycle harness
  So that a browser scenario is reduced to the same CaseVerdict shape every other binding kind produces

  Scenario: A ready app with a passing Playwright spec judges the case a pass
    Given a web binding whose app becomes ready and whose Playwright spec exits zero
    When the case is judged
    Then the verdict is "pass"
    And the evidence cites the Playwright spec

  Scenario: A ready app with a failing Playwright spec judges the case a fail
    Given a web binding whose app becomes ready and whose Playwright spec exits non-zero
    When the case is judged
    Then the verdict is "fail"
    And the evidence cites the Playwright spec's non-zero exit

  Scenario: A readiness timeout judges the case a fail without running the spec
    Given a web binding whose app never becomes ready within its configured timeout
    When the case is judged
    Then the verdict is "fail"
    And the evidence cites the readiness timeout
    And the Playwright spec is never run
