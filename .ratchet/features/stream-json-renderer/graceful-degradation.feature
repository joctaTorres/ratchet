Feature: Malformed or unknown events degrade to raw output
  In order to never crash a run because of unexpected agent output
  As a developer relying on `ratchet batch apply`
  I want any line that is not parseable or not understood printed raw instead of throwing

  Background:
    Given the active adapter is declared stream-json capable
    And the engine routes each stdout AgentEvent line through the stream-json renderer

  Scenario: A line that is not valid JSON is printed raw
    Given a stdout line "this is not json {" that does not parse as JSON
    When the renderer consumes the line
    Then the raw line "this is not json {" is printed
    And the renderer does not throw

  Scenario: A JSON event with an unknown type is printed raw
    Given a valid JSON line whose "type" is "totally_new_event_kind"
    When the renderer consumes the line
    Then the raw line is printed
    And the renderer does not throw

  Scenario: A JSON object missing a type field is printed raw
    Given a valid JSON line with no "type" field
    When the renderer consumes the line
    Then the raw line is printed
    And the renderer does not throw

  Scenario: A buffered partial line is flushed on stream end
    Given a final chunk that ends mid-line without a trailing newline
    When the stream ends and the renderer is flushed
    Then the buffered partial content is emitted rather than silently dropped
