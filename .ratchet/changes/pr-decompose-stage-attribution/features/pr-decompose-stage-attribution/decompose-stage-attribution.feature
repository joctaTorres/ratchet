Feature: Decompose-step model-failure attribution
  As a batch operator running a scalar explicit-model agent setting
  I want a fast-failing phase-decomposition spawn to surface the same stage/agent/model/scope attribution hint a change-step transition gets
  So that an invalid model id blocks the batch with an actionable hint instead of a generic failure

  Scenario: Decompose fast failure under an explicit scalar model carries the attribution hint
    Given a batch whose resolved agent setting is a scalar explicit-model spec supplied by the project config
    And the decomposition step context carries the per-stage supplying scopes, uniform across every stage
    When the decomposition agent exits non-zero having written no journal entries during the session
    Then the step surfaces as blocked and resumable
    And the surfaced blocker and message carry the attribution hint naming the "decompose" stage, the agent, the exact model string, and the project config as the supplying scope
    And the detail opens with the same hint above the captured stderr tail
    And the journal entry recorded under the decomposition key carries the hint

  Scenario: A stage-map agent setting leaves the decompose spawn unattributed and unchanged
    Given a batch whose resolved agent setting is a per-stage map naming explicit models for lifecycle stages
    And the decomposition step context carries the per-stage supplying scopes
    When the decomposition agent exits non-zero having written no journal entries
    Then the decomposition spawn resolves the default agent with no model, because a stage map never routes the decompose spawn
    And the surfaced failure renders byte-for-byte today's output with no attribution hint

  Scenario: A decomposition context without threaded scopes renders unchanged
    Given a decomposition step context whose scalar agent setting names an explicit model but carries no per-stage supplying scopes
    When the decomposition agent exits non-zero having written no journal entries
    Then the surfaced failure renders byte-for-byte today's output with no attribution hint

  Scenario: The uniform supplying scope is derived only when every stage agrees
    Given a per-stage supplying-scope map
    When the uniform scope is resolved for a stage-less spawn
    Then a map whose every stage names the same scope resolves to that scope
    And a map with mixed, partial, or absent stage scopes resolves to no scope
