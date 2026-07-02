Feature: Web binding readiness gate
  As the eval harness
  I want to wait for a web binding's app to become ready before running its Playwright spec
  So that the spec never races a not-yet-booted server

  Scenario: Readiness succeeds via URL probe before the timeout elapses
    Given a web binding whose readiness probe is a URL that becomes reachable within the timeout
    When the harness runs the binding
    Then the harness starts the binding's start command as a background process
    And the harness polls the URL probe until it responds successfully
    And the harness proceeds to run the Playwright spec

  Scenario: Readiness succeeds via command probe before the timeout elapses
    Given a web binding whose readiness probe is a shell command that exits zero within the timeout
    When the harness runs the binding
    Then the harness polls the command probe until it exits zero
    And the harness proceeds to run the Playwright spec

  Scenario: Readiness never succeeds within the timeout
    Given a web binding whose readiness probe never succeeds before its declared timeout
    When the harness runs the binding
    Then the harness fails the case once the timeout elapses
    And the harness does not run the Playwright spec
    And the started process is torn down
