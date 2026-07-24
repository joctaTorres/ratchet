Feature: The PR skill is named open-pr
  As a ratchet maintainer
  I want the batch PR skill rendered and invoked under the id "open-pr"
  So that its name reads naturally and is consistent for every agent

  Scenario: The PR command id is open-pr
    Given the single-source PR command id constant
    When its value is read
    Then it is "open-pr"

  Scenario: ratchet init emits the open-pr command for every supported agent
    Given the supported-tools registry
    When "ratchet init" generates the batch commands
    Then each agent receives the "open-pr" command rendered in that agent's command path and format
    And no agent receives a command named "pr-open"

  Scenario: The engine renders and invokes the PR step under open-pr
    Given a batch reaching its PR-open boundary
    When the engine prepares the PR spawn
    Then the "open-pr" command is guaranteed present in the spawn locus for the routed agent
    And the instruction tells the agent to invoke the open-pr command in that agent's syntax

  Scenario: The pr stage key is unchanged by the rename
    Given the batch agent setting sets "agent.pr" to "opencode:zai/glm-5.2"
    When the engine runs the PR-open step
    Then it still spawns the "opencode" agent with the model flag for "zai/glm-5.2"
    And the config-facing stage key remains "pr"

  Scenario: The open-pr body stays forge-agnostic
    Given the shared open-pr workflow body
    When its content is inspected
    Then it names no single forge CLI
    And it directs opening a change request using whichever forge CLI the repository uses
