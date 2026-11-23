Feature: Propose planning-boundary guardrails pinned on every agent's rendered output
  As a ratchet maintainer
  I want a test that renders the propose skill and command for every registered
  agent and asserts the planning-boundary guardrails
  So that the propose workflow cannot silently regress to implementing in the
  same response that authors the plan

  Scenario: Every registered agent's rendered propose output carries the planning-boundary guardrails
    Given the supported-tools registry
    When the propose skill template and command template are rendered for each
      registered agent
    Then every rendered body states the planning boundary — the workflow
      authors the change artifacts and its work ends there
    And every rendered body forbids implementing any of the plan's tasks in
      the same response, not even partially and not even when the user asks
    And every rendered body hands implementation to /rct:apply as a separate
      step after the final status
    And neither rendered closing prompt invites same-response implementation
    And the checked agent set is non-empty and covers every registered agent

  Scenario: The planning-boundary assertions reject a boundary-less propose body
    Given a sample propose body in the pre-change shape — no planning
      boundary, and a closing prompt that invites the agent to implement in
      the same response
    When the lifecycle-honesty propose assertions run against it
    Then the assertions fail
