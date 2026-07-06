Feature: The model-failure attribution hint fires only on a real non-zero exit code
  As a batch operator whose explicit-model agent was killed by a signal
  I want a signal-killed spawn (e.g. a timeout SIGKILL) to surface its failure
  WITHOUT the "if this model id is invalid" hint
  So that an externally killed agent under a perfectly valid model never
  misdirects me into "fixing" a model id that was never the problem

  Background:
    Given a transition's resolved agent[:model] spec explicitly names a model
    And the transition's stage has a supplying scope threaded via agentStageScopes
    And the agent wrote zero journal entries during the session

  Scenario: A signal-killed spawn under a valid explicit model surfaces with no hint
    Given the spawned agent is killed by a signal (exit code null, signal SIGKILL)
    When the engine maps the session to an outcome
    Then the step surfaces as blocked and resumable
    And no rendered surface carries the "if this model id is invalid" hint
    And the detail, blocker, and message name the signal that killed the agent
    And the captured stderr tail is still surfaced verbatim

  Scenario: The rendered blocked line for a signal kill omits the hint
    Given the spawned agent is killed by a signal under an explicit model
    When the standalone change-step renderer renders the result without --json
    Then the blocked line reports the agent exited via signal
    And the blocked line does not name a stage/agent/model/scope attribution hint

  Scenario: An exit-code fast failure with zero journal entries still carries the hint
    Given the spawned agent exits with a real non-zero exit code (code 2, no signal)
    When the engine maps the session to an outcome
    Then the detail, blocker, and message carry the stage/agent/model/scope attribution hint
    And the hint is phrased as "if this model id is invalid" guidance

  Scenario: A signal kill with no model attribution surfaces byte-for-byte today's output
    Given no agentStageScopes are threaded for the killed transition
    When the engine maps the signal-killed session to an outcome
    Then the outcome names the signal without any attribution hint
    And the mapping equals today's scope-less signal-kill output
