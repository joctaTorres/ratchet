Feature: Malformed standalone --agent fails before any spawn
  As an operator driving a headless change step
  I want a malformed --agent value rejected with an actionable error naming it
  So that I can correct the flag instead of debugging a raw throw after a spawn attempt

  Scenario Outline: a malformed --agent value fails the standalone verb naming the value with no spawn
    Given a project with an existing change that satisfies the "<verb>" preconditions
    And a spawn seam injected through EngineDeps that records every spawn attempt
    When the standalone "<verb>" command runs with --agent "claude:"
    Then the command rejects with an actionable error whose message names "claude:"
    And the error is thrown by settings resolution, matching the src/commands/apply.ts "actionable error" contract
    And the recorded spawn attempts are empty

    Examples:
      | verb    |
      | propose |
      | apply   |
      | verify  |

  Scenario: the phase-proof suite proves the flag seam through resolveChangeStepSettings
    Given the agent-model-selection suite covers the load, write, and manifest boundaries
    When resolveChangeStepSettings resolves an overrides.agent of "claude:" against a project root
    Then it throws before returning settings, with a message naming "claude:"
    And the same resolution with overrides.agent " claude" and "claude:-flag" also throws naming each value

  Scenario: valid --agent values behave byte-for-byte unchanged
    Given a project with an existing change that satisfies the apply preconditions
    When the standalone apply command runs once with --agent "claude" and once with --agent "claude:fable"
    Then each run resolves settings without error and spawns exactly one agent
    And the bare name spawns with no model flag and the spec form carries --model "fable"
