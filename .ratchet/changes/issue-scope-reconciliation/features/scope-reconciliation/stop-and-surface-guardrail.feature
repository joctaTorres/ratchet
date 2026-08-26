Feature: Stop-and-surface guardrail for security-relevant de-scopes
  As a maintainer relying on agents to author changes unattended
  I want any de-scope of security, permission, or integrity work to halt the run and ask
  So that a security exposure can never be narrowed by momentum inside an agent run

  Scenario: The guardrail is defined exactly once
    Given the workflow template layer
    When the stop-and-surface guardrail is located
    Then it is defined as a single shared constant that the propose, propose-batch, and decompose-phase bodies all embed
    And no workflow body restates it as a hand-authored copy

  Scenario: All three change-authoring workflows carry the guardrail verbatim
    Given the propose, propose-batch, and decompose-phase workflow bodies
    When each body's guardrails section is inspected
    Then each contains the shared guardrail text verbatim
    And each states that a de-scope of security, permission, or integrity work is a stop-and-surface event in which the workflow halts and asks the user rather than proceeding on momentum

  Scenario: An approved security de-scope requires a filed, linked, owned tracking issue
    Given a workflow body carrying the shared guardrail
    And a user who approves deferring a security-relevant requirement
    When the author records the deferral
    Then the guardrail requires an explicitly filed tracking issue with a named owner
    And it requires that issue to be linked from the change plan before the author proceeds
    And it states that a prose bullet in a plan is not a deferral mechanism
