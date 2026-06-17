Feature: Rich rendering is opt-in per adapter
  In order to keep ratchet tool-agnostic
  As a maintainer
  I want only stream-json-capable adapters to be rendered richly, and all others to keep raw line streaming

  Scenario: The claude adapter is declared stream-json capable
    Given the built-in adapter registry
    When the claude adapter is inspected
    Then it is declared to emit stream-json
    And its argv includes "--output-format" "stream-json" "--verbose" and "--include-partial-messages"

  Scenario: Non-claude adapters are not declared stream-json capable
    Given the built-in adapter registry
    When the codex, gemini, and cursor adapters are inspected
    Then none of them is declared to emit stream-json
    And their argv is unchanged from before this change

  Scenario: A stream-json-capable adapter is rendered richly
    Given a step whose resolved adapter is declared stream-json capable
    When the engine streams the agent's NDJSON output
    Then the stdout events are routed through the stream-json renderer

  Scenario: A non-capable adapter keeps raw line streaming
    Given a step whose resolved adapter is not declared stream-json capable
    When the engine streams the agent's output
    Then each stdout line is printed raw via the existing line printer
    And the stream-json renderer is not invoked
