Feature: Plan template records Non-goals and Approaches considered
  As a developer authoring a change through the propose workflow
  I want every plan to record what the change deliberately will not do and
  which approaches were weighed
  So that deliberate exclusions are traceable to a user, issue, or brainstorm
  decision and the design shows the alternatives it was chosen against

  Background:
    Given the plan template, the ratchet schema's plan instruction, and the
    propose skill and command bodies shared by every registered agent

  Scenario: The plan template carries a default Non-goals section between What Changes and Design
    Given the plan template at "schemas/ratchet/templates/plan.md"
    When the template is inspected
    Then it carries a default "## Non-goals" section
    And the "## Non-goals" section sits between "## What Changes" and "## Design"

  Scenario: The plan template carries an Approaches-considered subsection inside Design
    Given the plan template at "schemas/ratchet/templates/plan.md"
    When the template is inspected
    Then it carries a "### Approaches considered" subsection inside the "## Design" section
    And the subsection sits before the "## Tasks" section

  Scenario: The plan template's Non-goals guidance pins traced entries and the nothing-ruled-out one-liner
    Given the plan template at "schemas/ratchet/templates/plan.md"
    When the template's "## Non-goals" guidance is inspected
    Then it directs that each Non-goal entry traces to a decision the user, an issue, or a brainstorm made
    And it forbids an omission the agent approved on its own
    And it directs an explicit one-liner when nothing was ruled out

  Scenario: The schema plan instruction describes the Non-goals section with the traceability rule
    Given the ratchet schema's plan artifact instruction in "schemas/ratchet/schema.yaml"
    When the instruction is inspected
    Then it describes a "## Non-goals" section recording what the change deliberately will not do
    And it directs that each entry traces to a decision the user, an originating issue, or a brainstorm made
    And it forbids an agent self-approved omission
    And it directs an explicit one-liner when nothing was ruled out

  Scenario: The schema plan instruction describes Approaches considered with one sensible way allowed
    Given the ratchet schema's plan artifact instruction in "schemas/ratchet/schema.yaml"
    When the instruction is inspected
    Then it describes a "### Approaches considered" subsection inside "## Design"
    And it allows "one sensible way" when there is genuinely one sensible approach

  Scenario: The propose body directs recording Non-goals when authoring plan.md
    Given the shared propose body
    When the body walks the agent through authoring the plan artifact
    Then the body directs keeping the plan's "## Non-goals" section between "## What Changes" and "## Design"
    And the body directs that each Non-goal entry traces to a decision the user, an originating issue, or a brainstorm made
    And the body forbids an omission the agent approved on its own
    And the body directs an explicit one-liner when nothing was ruled out

  Scenario: The propose body directs Approaches considered inside Design
    Given the shared propose body
    When the body walks the agent through authoring the plan artifact
    Then the body directs keeping the plan's "### Approaches considered" subsection inside "## Design"
    And the body allows "one sensible way" when there is genuinely one sensible approach

  Scenario: The propose body's plan listing names the Non-goals section
    Given the shared propose body
    When the body lists the artifacts it creates
    Then the plan.md listing names "## Non-goals" between "## What Changes" and "## Design"

  Scenario: Every registered agent's rendered propose output carries the Non-goals and Approaches guidance
    Given the supported-tools registry
    When the propose skill template and command template are rendered for each registered agent
    Then every rendered body directs keeping the plan's "## Non-goals" section between "## What Changes" and "## Design"
    And every rendered body directs that each Non-goal entry traces to a decision the user, an originating issue, or a brainstorm made
    And every rendered body forbids an omission the agent approved on its own
    And every rendered body directs an explicit one-liner when nothing was ruled out
    And every rendered body directs the "### Approaches considered" subsection inside "## Design" with "one sensible way" allowed
    And the checked agent set is non-empty and covers every registered agent

  Scenario: The Non-goals and Approaches assertions reject a pre-change shape
    Given a sample plan template with no "## Non-goals" section and no "### Approaches considered" subsection
    And a sample propose body in the pre-change shape with no Non-goals or Approaches guidance
    When the template, instructions-payload, and rendered-output assertions run against them
    Then the assertions fail
