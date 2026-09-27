Feature: One shared spawn-request helper owns the override gate
  As a maintainer
  I want the batch engine, the eval judge, and the mutation harness to build spawn requests through one helper
  So that the opt-in gate, notice, and permission forwarding exist in exactly one place

  Scenario Outline: Every spawn seam delegates to buildAgentSpawnRequest
    Given the "<seam>" builds a spawn request
    When "<var>" is active
    Then the request is produced by buildAgentSpawnRequest
    And the gate, notice, and permission forwarding come from that helper

    Examples:
      | seam                    | var                     |
      | batch engine            | RATCHET_BATCH_AGENT_CMD |
      | eval judge              | RATCHET_EVAL_AGENT_CMD  |
      | eval mutation harness   | RATCHET_EVAL_AGENT_CMD  |

  Scenario: The helper is pure over its inputs
    Given an env map, an explicit allowOverride flag, and an adapter closure
    When buildAgentSpawnRequest is called
    Then it never reads process.env for the opt-in
    And with no active override it calls the adapter closure exactly once

  Scenario: The eval side refuses an override without the opt-in
    Given "RATCHET_EVAL_AGENT_CMD" is set to a stub
    And "ratchet eval run" is invoked without "--allow-agent-override"
    When a judge vote or a mutation seed would be spawned
    Then the run is refused before any agent is spawned
    And the message names "RATCHET_EVAL_AGENT_CMD" and "--allow-agent-override"
