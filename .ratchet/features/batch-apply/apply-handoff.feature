Feature: Single-step apply handoff to the engine
  As a developer driving a batch forward
  I want each apply invocation to advance exactly one step via the engine
  So that I keep natural inspection points and fresh agent context between steps

  Scenario: Apply advances one step and returns
    Given a batch "q3-auth" with a ready step
    When I run "ratchet batch apply q3-auth"
    Then the engine picks the next ready step from the batch DAG
    And it drives exactly one transition for one change
    And control returns to the caller without continuing to the next step

  Scenario: The transition sequence per change is propose then apply then verify
    Given a change "add-login-api" with no directory yet
    When I run "ratchet batch apply q3-auth" three times for that change
    Then the first invocation runs propose and creates the change
    And the second runs apply
    And the third runs verify

  Scenario: Apply respects gates and does not cross a halt
    Given a step parked as blocked or awaiting-approval
    When I run "ratchet batch apply q3-auth"
    Then the engine does not advance that step
    And it reports what input is required to proceed

  Scenario: Apply renders a rich view of the step it ran
    Given a batch with a ready step
    When I run "ratchet batch apply q3-auth"
    Then a rich view shows the step that ran, its outcome, and the next actionable step

  Scenario: Apply requires the engine to be installed and licensed
    Given the execution engine is not installed
    When I run "ratchet batch apply q3-auth"
    Then the command fails with a clear message that the engine is required
    And it explains how to install and activate it
    And the open CLI commands like status, view, and config still work without the engine

  Scenario: Apply can be triggered from the agent skill
    Given the "/rct:batch" skill is available
    When the skill is invoked for a batch
    Then it drives the same single-step apply as the CLI command
