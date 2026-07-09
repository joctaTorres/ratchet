Feature: Engine spawn requests carry a scoped environment
  As a ratchet operator
  I want every engine spawn site to thread the scoped environment into the AgentSpawnRequest
  So that no engine path exports the full host environment into an agent session

  Scenario: A change-transition spawn request excludes a host secret
    Given a host environment containing "SUPER_SECRET_TOKEN=hunter2"
    And a batch with a change ready for its next transition
    When the engine builds the spawn request for that transition
    Then the request env does not contain "SUPER_SECRET_TOKEN"
    And the request env contains "RATCHET_BATCH_NAME" with the batch name

  Scenario Outline: Decompose and PR spawns are scoped the same way
    Given a host environment containing "SUPER_SECRET_TOKEN=hunter2"
    And a batch whose next step is a "<stage>" spawn
    When the engine builds the spawn request for that step
    Then the request env does not contain "SUPER_SECRET_TOKEN"
    And the request env contains "RATCHET_BATCH_NAME" with the batch name

    Examples:
      | stage     |
      | decompose |
      | pr        |

  Scenario: The agent-cmd override still works under the scoped environment
    Given a host environment containing "RATCHET_BATCH_AGENT_CMD=echo stub-agent" and "SUPER_SECRET_TOKEN=hunter2"
    When the engine builds the spawn request for a change transition
    Then the override command stands in for the coding agent
    And the request env does not contain "SUPER_SECRET_TOKEN"
