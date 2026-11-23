Feature: Agent-neutral rendered skills and commands
  As a ratchet maintainer
  I want a test that renders every shipped skill and command for every
  registered agent and rejects bare agent-specific tool names
  So that no shipped workflow instructs one agent's tool without the
  capability-plus-fallback form, and a regression fails the suite

  Scenario: Rendered output carries no bare agent-specific tool name for any registered agent
    Given the supported-tools registry
    When every skill template and command template is rendered for each
      registered agent
    Then no rendered body instructs the agent to use a bare agent-specific
      tool name
    And every reference to an agent-specific capability is phrased as the
      capability with a plain-prose fallback

  Scenario Outline: Known bare-tool violations are fixed
    Given the shared workflow template for "<workflow>"
    When its body is rendered
    Then it does not instruct the agent to use the bare tool "<tool>"

    Examples:
      | workflow       | tool            |
      | apply-change   | AskUserQuestion |
      | archive-change | AskUserQuestion |
      | propose        | TodoWrite       |

  Scenario: Propose's structured-question mentions carry a plain-prose fallback
    Given the shared workflow template for propose
    When its body is rendered
    Then every mention of a structured-question tool is paired with a
      plain-prose fallback

  Scenario: The neutrality check rejects a bare agent-specific tool name
    Given a rendered skill or command body containing a bare agent-specific
      tool name
    When the rendered-output neutrality assertion runs against it
    Then the assertion fails
