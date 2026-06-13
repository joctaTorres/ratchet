Feature: Deterministic agent injection for batch apply
  As a developer evaluating the batch engine
  I want `ratchet batch apply` to run a scripted agent instead of a real one
  So that the engine's orchestration can be exercised end to end without an LLM

  Scenario: A stub command stands in for the coding agent
    Given the environment variable "RATCHET_BATCH_AGENT_CMD" is set to a shell command
    When the engine drives a transition for a batch step
    Then it runs that command via bash instead of spawning the configured agent
    And the command receives the same step instructions on stdin

  Scenario: Without the override the configured adapter is used
    Given "RATCHET_BATCH_AGENT_CMD" is unset
    When the engine drives a transition
    Then it resolves and spawns the configured agent adapter as before
    And the open CLI behavior is unchanged

  Scenario: The stub reports through the normal channel
    Given a stub agent that runs "ratchet batch report" to record its outcome
    When the engine drives a transition with that stub
    Then the engine reads the stub's journal entries exactly as it would a real agent
    And the resulting step result reflects what the stub reported

  Scenario: A non-zero stub is a failed step, not a corrupted batch
    Given a stub command that exits non-zero
    When the engine drives a transition
    Then the step is reported as failed
    And the batch run-state is left consistent for a later retry
