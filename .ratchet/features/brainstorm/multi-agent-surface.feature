Feature: Brainstorm skill and command render for every registered agent
  As a maintainer preserving ratchet's tool-agnosticism
  I want the brainstorm surface defined once and rendered per agent
  So that ratchet init emits it for all supported coding agents

  Background:
    Given the ratchet-brainstorm skill and the rct-brainstorm command exist

  Scenario: Content is defined once as a shared body
    Given the brainstorm workflow templates
    When the skill template and the command template are read
    Then both share a single shared body constant
    And there are no agent-specific copies of the brainstorm content

  Scenario: Agent-neutral phrasing in the shared body
    Given the shared brainstorm body
    When its prose is inspected
    Then it refers to "the coding agent" or "your agent"
    And it does not refer to "Claude"
    And any agent-specific step such as a structured-question tool or visual aid is phrased as optional with a plain-prose fallback

  Scenario: ratchet init emits the brainstorm surface for every registered agent
    Given the brainstorm workflow is registered in the workflow profile and the skill and command template maps
    When ratchet init runs for the supported tools
    Then it emits the ratchet-brainstorm skill into each agent's skills directory
    And it emits the rct-brainstorm command into each agent's commands directory

  Scenario Outline: Per-agent output paths are produced
    Given ratchet init runs for the agent "<agent>"
    When the brainstorm surface is rendered
    Then a skill file is written under "<skill_dir>"
    And a command file is written at "<command_path>"

    Examples:
      | agent          | skill_dir                                  | command_path                                |
      | claude         | .claude/skills/ratchet-brainstorm/         | .claude/commands/rct/rct-brainstorm.md      |
      | codex          | .codex/skills/ratchet-brainstorm/          | .codex prompts/rct-rct-brainstorm.md        |
      | cursor         | .cursor/skills/ratchet-brainstorm/         | .cursor/commands/rct-rct-brainstorm.md      |
      | github-copilot | .github/skills/ratchet-brainstorm/         | .github/prompts/rct-rct-brainstorm.prompt.md|
      | opencode       | .opencode/skills/ratchet-brainstorm/       | .opencode/commands/rct-rct-brainstorm.md    |

  Scenario: Rendering tests iterate the registry, not one hard-coded agent
    Given the brainstorm command rendering tests
    When they assert the rendered output
    Then they iterate the command adapter registry over all registered tools
    And they assert the routing hand-off survives each tool's formatting
