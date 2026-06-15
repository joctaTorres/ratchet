Feature: Tool calls render as labeled lines with their target
  In order to follow what the coding agent is doing
  As a developer watching a live run
  I want each tool invocation rendered as a distinct, labeled line naming the tool and its target

  Background:
    Given the active adapter is declared stream-json capable
    And the engine routes each stdout AgentEvent line through the stream-json renderer

  Scenario: An Edit tool_use renders with a file target
    Given an "assistant" NDJSON line whose message.content contains a "tool_use" item with name "Edit" and input.file_path "src/foo.ts"
    When the renderer consumes the line
    Then a single tool-call line is rendered naming the tool "Edit"
    And that line shows the target "src/foo.ts"

  Scenario: A Bash tool_use renders with its command target
    Given an "assistant" NDJSON line whose message.content contains a "tool_use" item with name "Bash" and input.command "pnpm test"
    When the renderer consumes the line
    Then a single tool-call line is rendered naming the tool "Bash"
    And that line shows the target "pnpm test"

  Scenario: A tool_use with an unfamiliar name still renders a tool-call line
    Given an "assistant" NDJSON line whose message.content contains a "tool_use" item with name "SomeFutureTool" and an input object
    When the renderer consumes the line
    Then a tool-call line is rendered naming the tool "SomeFutureTool"
    And the run does not crash
