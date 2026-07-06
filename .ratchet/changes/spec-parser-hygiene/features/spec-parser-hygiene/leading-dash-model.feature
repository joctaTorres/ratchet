Feature: Leading-dash model rejection
  As a ratchet user configuring batch agents
  I want a model part that starts with "-" rejected at parse time
  So that a flag-shaped token like "claude:-flag" never rides into a spawned agent's argv as an option

  Scenario: a model part starting with a single dash is rejected naming the value
    Given the agent spec "claude:-flag"
    When parseAgentSpec parses it
    Then it throws an error whose message contains "claude:-flag" and identifies the model part "-flag" as starting with "-"

  Scenario: a double-dash flag-shaped model part is rejected naming the value
    Given the agent spec "claude:--dangerously-skip-permissions"
    When parseAgentSpec parses it
    Then it throws an error whose message contains "claude:--dangerously-skip-permissions" and identifies the model part as starting with "-"

  Scenario: an interior dash in a model part stays valid
    Given the agent spec "codex:gpt-5.2-codex"
    When parseAgentSpec parses it
    Then it parses to agent "codex" and model "gpt-5.2-codex" with no error
