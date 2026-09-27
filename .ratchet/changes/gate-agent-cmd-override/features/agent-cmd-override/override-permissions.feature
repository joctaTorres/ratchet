Feature: The override path carries the resolved permission policy
  As an operator with a configured permission posture
  I want an overridden spawn to receive the same resolved permission flags a real agent would
  So that the override can never silently drop every permission flag

  Scenario: The override request carries the resolved permission flags as positional arguments
    Given the resolved permission posture is "repo-sandboxed-permissive"
    And the transition's stage resolves to the "claude" agent
    And "RATCHET_BATCH_AGENT_CMD" is set and the opt-in is given
    When the spawn request is built
    Then its argv is "bash", "-c", the override command, "claude", then the flags "resolvePermissionFlags" yields for claude under that policy
    And the override command sees those flags in "$@" and the agent name in "$0"

  Scenario Outline: The forwarded flags follow the stage's resolved agent
    Given the transition's stage resolves to the "<agent>" agent
    And an override is active and allowed
    When the spawn request is built
    Then the forwarded flags equal resolvePermissionFlags("<agent>", policy, projectRoot)

    Examples:
      | agent    |
      | claude   |
      | codex    |
      | gemini   |
      | cursor   |
      | opencode |

  Scenario: A policy that cannot be translated refuses the spawn
    Given the stage resolves to an agent the permission translator cannot map
    And an override is active and allowed
    When the spawn request is built
    Then the spawn is refused with a message naming the agent and the policy
    And no bare "bash -c <override>" request without flags is produced
