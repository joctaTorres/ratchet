Feature: Playwright spec execution and teardown
  As the eval harness
  I want to run the binding's Playwright spec once the app is ready and always tear the app down afterward
  So that a web scenario's pass/fail is deterministic and never leaks a running process

  Scenario: Passing Playwright spec
    Given a web binding whose app becomes ready within its readiness timeout
    When the harness runs the binding
    Then the harness invokes the binding's spec via a plain bash command
    And the harness reports the case as passing because the spec exits zero
    And the started process is torn down after the spec finishes

  Scenario: Failing Playwright spec
    Given a web binding whose Playwright spec exits non-zero
    When the harness runs the binding
    Then the harness reports the case as failing
    And the started process is torn down after the spec finishes

  Scenario: Teardown runs even when the spec invocation raises an unexpected error
    Given a web binding whose Playwright spec invocation raises an unexpected error
    When the harness runs the binding
    Then the started process is torn down
    And the unexpected error propagates as a case failure

  Scenario: Spec invocation is agent-neutral
    Given a web binding whose app becomes ready within its readiness timeout
    When the harness runs the binding
    Then the Playwright spec is invoked through a plain bash command
    And the invocation does not depend on any specific coding agent's runner
