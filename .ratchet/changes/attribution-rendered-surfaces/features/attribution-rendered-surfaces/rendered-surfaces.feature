Feature: Model-failure attribution hint on every rendered surface
  As a batch operator running per-stage agent[:model] specs without --json
  I want the stage/agent/model/scope attribution hint to appear on every
  human-facing surface that renders a failed step
  So that I never have to reach for --json (or read StepResult.detail) to learn
  which stage, agent, model, and config scope a fast failure ran under

  Background:
    Given a transition's resolved agent[:model] spec explicitly names a model
    And the transition's stage has a supplying scope threaded via agentStageScopes
    And the agent exits non-zero with no completion report and no journal entries written during the session

  Scenario: The non-JSON batch apply blocked output carries the hint
    Given a batch step runs the fast-failing explicit-model transition
    When `ratchet batch apply` renders the step result without --json
    Then the blocked line of the rendered output names the stage, the agent, the exact model string, and the supplying scope
    And the hint is phrased as "if this model id is invalid" guidance, never a diagnosis

  Scenario: The parked-step reason shown on resume carries the hint
    Given a batch step ran the fast-failing explicit-model transition and parked
    When `ratchet batch apply` runs again and reports the unresolved parked step
    Then the parked reason shown to the operator names the stage, the agent, the exact model string, and the supplying scope

  Scenario: The journal entry for the failed transition carries the hint
    Given a batch step runs the fast-failing explicit-model transition
    When the engine records the transition outcome in the journal
    Then the recorded journal entry's message names the stage, the agent, the exact model string, and the supplying scope

  Scenario: The standalone change-step renderer carries the hint
    Given a change step result whose fast failure was attributed to an explicit model
    When the standalone change-step renderer renders it without --json
    Then the rendered blocked line names the stage, the agent, the exact model string, and the supplying scope

  Scenario: The JSON surface keeps the hint in detail
    Given a batch step runs the fast-failing explicit-model transition
    When the step result is rendered with --json
    Then the emitted StepResult's detail still opens with the attribution hint above the captured stderr tail
