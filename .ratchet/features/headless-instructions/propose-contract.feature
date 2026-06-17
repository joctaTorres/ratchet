Feature: Headless-performable propose instructions
  As the batch engine that spawns a non-interactive coding agent
  I want propose instructions to describe only filesystem and CLI actions
  So that a headless agent can actually do the work instead of emitting prose and exiting

  Background:
    Given a resolved step context whose transition is "propose"
    And the agent will run in a non-interactive (headless) subprocess with no slash-command/skill support

  Scenario: Propose instructions reference no slash-command or skill
    Given a resolved step context whose transition is "propose"
    And the agent will run in a non-interactive (headless) subprocess with no slash-command/skill support
    When the agent instructions are built for the propose transition
    Then the instructions do not mention "propose workflow"
    And the instructions do not mention any slash-command (no "/rct:" or "/rct" reference)
    And the instructions do not instruct the agent to "use" a named workflow or skill

  Scenario: Propose instructions describe concrete filesystem and CLI steps
    Given a resolved step context whose transition is "propose"
    And the agent will run in a non-interactive (headless) subprocess with no slash-command/skill support
    When the agent instructions are built for the propose transition
    Then the instructions tell the agent to create a change directory under ".ratchet/changes/<change>/"
    And the instructions tell the agent to write feature files under "features/**/*.feature"
    And the instructions tell the agent to write a "plan.md" containing a "## Tasks" checklist

  Scenario: The completion requirement is stated up front
    Given a resolved step context for any transition
    When the agent instructions are built for any transition
    Then the instructions state near the top that the agent MUST finish by running "ratchet batch report" with "--complete"
    And the same completion requirement still appears at the bottom report channel

  Scenario: Apply and verify guidance avoid slash-command references too
    Given a resolved step context whose transition is "apply"
    When the agent instructions are built for the apply transition
    Then the instructions do not mention any slash-command (no "/rct:" reference)
    And the instructions describe working through the plan.md "## Tasks" checklist as a concrete action

  Scenario: Instructions stay tool-agnostic
    Given a resolved step context whose transition is "propose"
    And the agent will run in a non-interactive (headless) subprocess with no slash-command/skill support
    When the agent instructions are built for the propose transition
    Then the instructions do not name a specific coding agent such as "Claude" or "Cursor"
    And the instructions refer to actions any coding agent can perform
