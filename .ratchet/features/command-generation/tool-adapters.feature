Feature: Generating per-tool command files
  As ratchet generating the agent surface
  I want tool-agnostic command content rendered through per-tool adapters
  So that each AI tool receives commands at its expected paths and format

  Scenario: An adapter renders content to its tool-specific path
    Given tool-agnostic command content with id "propose"
    When the Claude Code adapter generates the command
    Then the file path is ".claude/commands/rct/propose.md"
    And the file content is wrapped in the adapter's frontmatter format

  Scenario: Only the five built-in tools have adapters
    Given the command adapter registry
    When I look up an adapter by tool id
    Then adapters exist for claude, codex, cursor, github-copilot and opencode
    And an unknown tool id has no registered adapter

  Scenario: Multiple commands are generated for one tool
    Given a list of tool-agnostic command contents
    When they are generated through a single tool adapter
    Then each command yields a file path and formatted content
    And every file targets that tool's command directory
