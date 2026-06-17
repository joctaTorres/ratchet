Feature: Tool results render concisely
  In order to see the outcome of each tool call without drowning in output
  As a developer watching a live run
  I want tool results rendered as a concise, truncated line associated with the call

  Background:
    Given the active adapter is declared stream-json capable
    And the engine routes each stdout AgentEvent line through the stream-json renderer

  Scenario: A short tool_result renders on a result line
    Given a "user" NDJSON line whose message.content contains a "tool_result" item with the content "2 files changed"
    When the renderer consumes the line
    Then a result line is rendered containing "2 files changed"

  Scenario: A long tool_result is truncated
    Given a "user" NDJSON line whose message.content contains a "tool_result" item with 500 lines of content
    When the renderer consumes the line
    Then the rendered result line is truncated to a bounded length
    And the truncation is signalled (e.g. an ellipsis or a "+N more" marker)

  Scenario: An error tool_result is marked as an error
    Given a "user" NDJSON line whose message.content contains a "tool_result" item with is_error true and content "command failed"
    When the renderer consumes the line
    Then the rendered result line indicates an error
    And it contains "command failed"
