Feature: Execute phase proof-of-work
  As the batch execution engine
  I want to run a phase's proof-of-work and gate completion on it
  So that every phase ships verified, functional software

  Scenario: Run an integration or blackbox proof-of-work via bash
    Given a phase whose proof-of-work kind is "blackbox" with a run command
    And all of the phase's changes are done
    When the engine evaluates the phase
    Then it executes the run command
    And the phase passes only if the pass condition is met

  Scenario: Run an llm-judge proof-of-work
    Given a phase whose proof-of-work kind is "llm-judge"
    And all of the phase's changes are done
    When the engine evaluates the phase
    Then it spawns an agent that exercises the software directly via bash or an MCP tool
    And the judge returns a pass or fail verdict against the success criteria

  Scenario: A failing proof-of-work hard-gates the phase by default
    Given the resolved proofOfWork policy is "hard-gate"
    And a phase whose proof-of-work fails
    When the engine evaluates the phase
    Then the phase is not marked done
    And the next phase remains blocked
    And the failure is surfaced as a blocker

  Scenario: Warn policy allows the phase to complete despite failure
    Given the resolved proofOfWork policy is "warn"
    And a phase whose proof-of-work fails
    When the engine evaluates the phase
    Then the failure is recorded as a warning
    And the phase is allowed to complete

  Scenario: Proof-of-work runs only after the phase changes are done
    Given a phase with changes still in progress
    When the engine is asked to run a step
    Then it advances changes rather than running the phase proof-of-work prematurely
