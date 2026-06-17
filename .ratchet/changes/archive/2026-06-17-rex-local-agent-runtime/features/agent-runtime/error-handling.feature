Feature: Sidecar and bootstrap failures surface as failed steps
  As the batch engine
  I want sidecar errors and missing prerequisites to surface clearly
  So that a run fails loudly with an actionable message instead of hanging

  Scenario: A sidecar error event fails the step
    Given a fake sidecar child that emits an error event with a message
    When the runtime runs the step
    Then the run rejects or returns a failed result carrying the error message
    And the engine maps the step to a blocked outcome that surfaces the detail

  Scenario: Missing Python yields the bootstrap's actionable error
    Given the ReX bootstrap cannot find a usable Python interpreter
    When the runtime attempts to launch the sidecar
    Then a RexBootstrapError is raised
    And its message names the missing prerequisite and the remedy to install Python
    And the step fails with that actionable message rather than a silent pass

  Scenario: The child is torn down on completion, abort, or timeout
    Given a runtime driving a sidecar child
    When the step completes, is aborted, or exceeds its timeout
    Then the sidecar child process is terminated
    And no orphaned sidecar process is left running
