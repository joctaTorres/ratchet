Feature: Streaming assistant text renders live
  In order to see the coding agent think and write in real time
  As a developer running `ratchet batch apply`
  I want assistant text from the NDJSON stream rendered to the terminal as it arrives

  Background:
    Given the active adapter is declared stream-json capable
    And the engine routes each stdout AgentEvent line through the stream-json renderer

  Scenario: A full assistant text message renders as readable prose
    Given an NDJSON line of type "assistant" whose message.content contains a "text" item with the text "I will add a guard clause."
    When the renderer consumes the line
    Then the terminal output contains the text "I will add a guard clause."
    And the output does not contain the raw JSON braces of that event

  Scenario: Partial assistant text deltas stream incrementally
    Given a sequence of "stream_event" partial NDJSON lines carrying the text deltas "I will ", "add ", and "a guard clause."
    When the renderer consumes each line in order as it arrives
    Then the rendered assistant text grows incrementally across the deltas
    And the final rendered assistant text reads "I will add a guard clause."
    And no delta is emitted only after the whole message is buffered
