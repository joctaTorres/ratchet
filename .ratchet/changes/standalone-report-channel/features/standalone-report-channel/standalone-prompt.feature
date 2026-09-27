Feature: Standalone step prompt names a working report channel
  As an operator running a headless verb with no batch
  I want the spawned agent's prompt to name a report command that reaches the change-local journal
  So that a finished standalone step is recorded instead of parking as unreported

  Scenario Outline: A standalone step prompt never mentions a batch
    Given a change step context for change "add-hello" with transition "<transition>" and no batch
    When the agent instructions are built
    Then the instructions do not contain "undefined"
    And the instructions do not contain "ratchet batch report"
    And the instructions tell the agent to finish with "ratchet report add-hello --complete"
    And the report channel lists "ratchet report add-hello" with --status, --blocker, --needs-input and --complete

    Examples:
      | transition |
      | propose    |
      | apply      |
      | verify     |

  Scenario: A batch step prompt keeps the batch-scoped report channel
    Given a change step context for change "add-hello" in batch "b1"
    When the agent instructions are built
    Then the instructions begin with "You are advancing the ratchet batch \"b1\"."
    And the instructions tell the agent to finish with "ratchet batch report b1 --change add-hello --complete"
    And the instructions do not contain "ratchet report add-hello"
