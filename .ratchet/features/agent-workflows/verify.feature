Feature: Verifying a change before archive
  As a developer about to archive
  I want the agent to verify the change across three dimensions
  So that every scenario is satisfied and every task is done before it ratchets forward

  Scenario: Verify reports completeness, correctness and coherence
    Given an implemented change with features and a plan
    When the agent runs the /rct:verify workflow
    Then it scores completeness against the plan's tasks
    And it checks scenario-by-scenario correctness and overall design coherence

  Scenario: Findings are graded by severity
    Given the agent has verified a change
    When it composes the verification report
    Then each finding is graded as CRITICAL, WARNING or SUGGESTION
    And when uncertain it prefers the lower severity

  Scenario: Critical issues block readiness for archive
    Given verification finds at least one critical issue
    When the verdict is rendered
    Then the report states the critical issues must be fixed before archiving
    And the change is not declared ready
