Feature: Engine internals never surface a malformed spec as a raw unhandled Error
  As a batch-engine operator
  I want a malformed agent spec that reaches the spawn-locus guarantee to surface as a structured failure
  So that the step fails journaled and resumable instead of crashing the process with a raw throw

  Scenario: the spawn-locus guarantee wraps a malformed spec into SkillLocusError naming the value
    Given batch settings whose agent setting carries the malformed spec "claude:" past upstream validation
    When ensureCommandInSpawnLocus resolves the agent for the step
    Then it throws SkillLocusError, not a plain Error
    And the message names "claude:" and states that the agent is not spawned

  Scenario: the engine maps the wrapped spec failure to a structured failed step
    Given a change step whose settings carry a malformed agent spec into the engine
    And a spawn seam injected through EngineDeps that records every spawn attempt
    When the engine runs the change step
    Then the step result state is "failed" with a blocker naming the offending spec
    And no raw Error escapes runChangeStep
    And the recorded spawn attempts are empty

  Scenario: a well-formed spec still resolves the spawn-locus guarantee unchanged
    Given batch settings whose agent setting is the valid spec "claude:fable"
    When ensureCommandInSpawnLocus resolves the agent for the step
    Then the guarantee resolves the "claude" command adapter without error
