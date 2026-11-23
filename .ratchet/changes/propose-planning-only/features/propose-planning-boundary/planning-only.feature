Feature: Propose planning boundary
  As a ratchet user relying on /rct:propose to author a change's planning
  artifacts
  I want the propose workflow to state and enforce a hard planning boundary
  So that a proposal never silently becomes an implementation session and the
  apply/verify gates keep their meaning

  Scenario: The propose body states the planning boundary
    Given the shared workflow template for propose
    When its body is rendered
    Then it states that the workflow's job is to author the change artifacts
      — the executable Gherkin features and plan.md — and that its work ends
      there
    And it names the boundary explicitly as a planning boundary

  Scenario: The propose body enforces the planning boundary in the same response
    Given the shared workflow template for propose
    When its body is rendered
    Then it forbids implementing any of the plan's tasks in the same response
      that authored them
    And it forbids partial implementation — not one task, not a head start —
      even when the user asks in the same breath
    And it directs the agent to end its turn after authoring, reconciliation,
      and the final status, handing implementation to /rct:apply as a separate
      step

  Scenario: The completion prompt routes to /rct:apply without inviting same-response implementation
    Given the propose skill template and the propose command template
    When their closing prompt lines are rendered
    Then both route the user to /rct:apply to start implementing
    And neither invites the agent to implement the plan in the same response
