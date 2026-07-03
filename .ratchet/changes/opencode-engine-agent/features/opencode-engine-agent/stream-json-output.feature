Feature: OpenCode output is streamed as structured JSON
  As a batch operator watching a headless run
  I want opencode's structured NDJSON output rendered richly
  So that the live stream is legible like claude's stream-json

  Background:
    Given the stream-json renderer is gated on an adapter's emitsStreamJson capability flag
    And never on the agent name
    And the renderer parses multiple event schemas, not only claude's

  Scenario: The opencode adapter is declared stream-json capable
    Given the built-in adapter registry
    When the opencode adapter is inspected
    Then it is declared to emit stream-json
    And its argv includes "--format" "json"

  Scenario: opencode stdout events are routed through the stream-json renderer
    Given a step whose resolved adapter is the opencode adapter
    When the engine streams opencode's NDJSON output
    Then the stdout events are routed through the stream-json renderer
    And the renderer's opencode branches parse the step_start, text, and step_finish events

  Scenario: Claude's event schema is unaffected by the opencode renderer branches
    Given the renderer with the opencode branches added
    When a claude stream_event with a content_block_delta text delta is received
    Then the claude prose streaming behavior is unchanged
    And a claude result event still renders its closing summary

  Scenario: A non-stream-json opencode invocation degrades gracefully
    Given an opencode stdout line that is not valid stream-json
    When the renderer receives it
    Then it falls back to printing the line raw without crashing the step
