Feature: Parse an agent[:model] spec string
  As a batch user
  I want agent setting values to carry an optional model after the agent name
  So that one spec string names both the agent to spawn and the model it runs

  # parseAgentSpec is a pure function exported from agent-setting.ts. It splits
  # the spec on the FIRST colon only, so opencode provider/model ids (and any
  # model id that itself contains a colon) pass through intact. It never
  # consults the adapter registry: whether the agent part is a KNOWN agent
  # stays a resolution/spawn-time concern (UnknownAgentError in resolveAdapter).

  Scenario: A bare agent name parses to an agent with no model key
    Given the spec string "claude"
    When parseAgentSpec parses it
    Then the result is agent "claude"
    And the result has no "model" key

  Scenario: An agent:model spec parses into agent and model parts
    Given the spec string "claude:fable"
    When parseAgentSpec parses it
    Then the result is agent "claude"
    And the result is model "fable"

  Scenario Outline: The spec splits on the first colon so the model part passes through intact
    Given the spec string "<spec>"
    When parseAgentSpec parses it
    Then the result is agent "<agent>"
    And the result is model "<model>"

    Examples:
      | spec                     | agent    | model           |
      | opencode:zai/glm-5.2     | opencode | zai/glm-5.2     |
      | opencode:qwen/qwen-3.7   | opencode | qwen/qwen-3.7   |
      | codex:vendor:tagged-1    | codex    | vendor:tagged-1 |

  Scenario Outline: A spec with an empty agent or model part is rejected naming the offending value
    Given the spec string "<spec>"
    When parseAgentSpec parses it
    Then parsing fails with an error whose message contains "<spec>"

    Examples:
      | spec    |
      | claude: |
      | :fable  |
      | :       |

  Scenario: An empty spec string is rejected
    Given the spec string ""
    When parseAgentSpec parses it
    Then parsing fails with an error identifying the empty agent part
