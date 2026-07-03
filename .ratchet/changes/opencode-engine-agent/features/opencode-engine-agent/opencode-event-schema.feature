Feature: The stream-json renderer parses OpenCode's event schema
  As a batch operator
  I want opencode's step_start, text, and step_finish NDJSON events parsed and rendered
  So that prose streams live and the run closes with a usage summary

  Background:
    Given opencode run --format json emits one NDJSON event per line
    And each event carries a top-level "type" and a nested "part" object

  Scenario: step_start is control noise and is dropped
    Given an opencode step_start event on stdout
    When the renderer dispatches it
    Then it is recognized and dropped silently
    And nothing is printed for it

  Scenario: text events stream prose live
    Given an opencode text event whose part.text is "Running the apply transition..."
    When the renderer dispatches it
    Then the prose is printed to the line sink
    And incremental text across consecutive text events accumulates like claude's deltas

  Scenario: step_finish renders a closing usage summary
    Given an opencode step_finish event whose part.reason is "stop"
    And part.tokens.total, part.tokens.input, and part.tokens.output are present
    And part.cost is present
    When the renderer dispatches it
    Then a closing summary line is printed with the token usage and cost
    And the summary reflects the values from the event (not hardcoded)

  Scenario: step_finish with an error reason is flagged
    Given an opencode step_finish event whose part.reason indicates an error
    When the renderer dispatches it
    Then the closing summary is flagged as an error

  Scenario: An opencode event with an unknown part.type degrades gracefully
    Given an opencode event whose top-level type is recognized but part.type is unfamiliar
    When the renderer dispatches it
    Then it falls back to printing the line raw without crashing the step
