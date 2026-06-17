Feature: The result event renders a closing summary
  In order to know how the run ended at a glance
  As a developer watching a live run
  I want the terminal NDJSON "result" event rendered as a polished closing summary

  Background:
    Given the active adapter is declared stream-json capable
    And the engine routes each stdout AgentEvent line through the stream-json renderer

  Scenario: A successful result renders a success summary
    Given a "result" NDJSON line with subtype "success", a result summary "Added guard clause", and usage/cost fields
    When the renderer consumes the line
    Then a closing summary line is rendered indicating success
    And it contains the result summary "Added guard clause"
    And it surfaces a concise usage or cost figure

  Scenario: An error result renders an error summary
    Given a "result" NDJSON line with subtype "error" and a result summary "tool limit exceeded"
    When the renderer consumes the line
    Then a closing summary line is rendered indicating failure
    And it contains "tool limit exceeded"

  Scenario: The summary still renders when earlier events were unparseable
    Given a stream where one intermediate line was malformed JSON
    And a later valid "result" NDJSON line with subtype "success"
    When the renderer consumes the whole stream
    Then the closing summary for the result event is still rendered
