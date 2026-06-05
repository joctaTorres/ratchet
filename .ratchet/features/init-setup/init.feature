Feature: Initializing ratchet in a project
  As a developer adopting ratchet
  I want init to scaffold the project structure and the agent surface
  So that I can start authoring changes with my AI tools immediately

  Background:
    Given a target project directory

  Scenario: Init scaffolds the ratchet directory structure
    Given an empty project
    When I run "ratchet init"
    Then ".ratchet/features", ".ratchet/changes" and ".ratchet/changes/archive" are created
    And a ".ratchet/config.yaml" is written referencing the default schema

  Scenario: Selecting a single tool generates only that tool's surface
    Given an empty project
    When I run "ratchet init --tools claude"
    Then Claude Code skills are generated under ".claude/skills/"
    And command files are generated under ".claude/commands/rct/"

  Scenario: The supported tools are exactly the five adapters
    Given the available tool ids
    When I choose tools for init
    Then I may pick from claude, codex, cursor, github-copilot and opencode
    And no other tool id is offered

  Scenario: Force cleans legacy files without prompting
    Given a project containing legacy ratchet files
    When I run "ratchet init --force"
    Then legacy files are cleaned up automatically
    And I am not prompted to confirm the cleanup
