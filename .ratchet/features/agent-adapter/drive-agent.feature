Feature: Drive the selected coding agent in a subprocess
  As the batch execution engine
  I want to spawn the configured coding agent as a subprocess with a scoped prompt
  So that any supported agent can perform a transition and report back

  Scenario: Spawn the configured agent for a transition
    Given the resolved batch config selects an agent adapter
    When the engine runs a transition
    Then it spawns that agent as a subprocess
    And it injects the resolved step context as the agent's instructions

  Scenario: The step context drives the right ratchet workflow command
    Given a propose transition for change "add-login-api"
    When the agent is spawned
    Then its instructions direct it to create the change and its artifacts
    And they reference the phase goal, success criteria, and proof-of-work

  Scenario: Capture the agent's reported outcome
    Given an agent that posts updates via "ratchet batch report"
    When the agent process exits
    Then the engine reads the run journal entries it wrote
    And maps them to a structured step result

  Scenario: A crashed or non-zero agent is a failed step, not a corrupted batch
    Given an agent subprocess that exits non-zero without reporting completion
    When the engine evaluates the step
    Then the step is marked failed with the captured output
    And the batch state remains consistent and resumable

  Scenario: Unknown agent adapter is rejected early
    Given a batch config naming an agent adapter that is not registered
    When the engine starts a step
    Then it fails before spawning with a message listing available adapters
