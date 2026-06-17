Feature: Rename rct:batch to rct:apply-batch and install by default
  As a ratchet user driving a batch
  I want the batch skill exposed as /rct:apply-batch
  So that its name reflects that it orchestrates apply, not a single step

  Background:
    Given a project initialized with the default (core) ratchet profile

  Scenario: The apply-batch skill is installed by default for every supported agent
    Given the supported coding agents are claude, codex, cursor, github-copilot, and opencode
    When ratchet init runs with the core profile
    Then a skill directory named "ratchet-apply-batch" is generated for each agent
    And the old skill directory "ratchet-batch" is not generated for any agent
    And the corresponding "RCT: Apply Batch" command is generated for each agent

  Scenario: The slash command is invoked as /rct:apply-batch
    Given the apply-batch skill is installed
    When a user types "/rct:apply-batch q3-auth"
    Then the orchestrator skill is selected
    And it targets the batch named "q3-auth"

  Scenario: The renamed skill content is agent-neutral
    Given the apply-batch skill body
    When its prose is rendered for any supported agent
    Then it refers to "the coding agent" rather than any single named agent
    And any agent-specific affordance is phrased as optional with a plain-prose fallback
