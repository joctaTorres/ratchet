Feature: PR-step model-failure attribution
  As a batch operator routing the pr stage to a dedicated agent
  I want a fast-failing PR spawn under an explicit per-stage model to surface the same stage/agent/model/scope attribution hint a change-step transition gets
  So that I can spot an invalid model id in my `pr:` stage mapping without decoding raw stderr

  Scenario: PR fast failure under a manifest-supplied per-stage model carries the attribution hint
    Given a batch whose resolved agent setting maps the pr stage to an explicit-model spec supplied by the batch manifest
    And the batch-driven PR step context carries the per-stage supplying scopes
    When the PR agent exits non-zero having written no journal entries during the session
    Then the step surfaces as blocked and resumable
    And the surfaced blocker and message carry the attribution hint naming the "pr" stage, the agent, the exact model string, and the batch manifest as the supplying scope
    And the detail opens with the same hint above the captured stderr tail
    And the parked reason and the journal entry recorded under the PR key carry the hint
    And the rendered blocked line printed for the result carries the hint

  Scenario: Exactly one PR spawn with the exact failing model
    Given a batch whose resolved agent setting maps the pr stage to an explicit-model spec
    And the batch-driven PR step context carries the per-stage supplying scopes
    When the PR agent fails fast
    Then exactly one agent is spawned
    And the spawn argv carries the exact failing model string with no fallback substituted

  Scenario: A bare-name pr spec fast failure renders byte-for-byte unchanged
    Given a batch whose resolved agent setting maps the pr stage to a bare agent name with no model part
    And the batch-driven PR step context carries the per-stage supplying scopes
    When the PR agent exits non-zero having written no journal entries
    Then the surfaced blocker, message, and detail deep-equal today's un-attributed failure output
    And no attribution hint appears on any rendered surface

  Scenario: A PR step context without threaded scopes renders unchanged
    Given a PR step context whose agent setting names an explicit model but carries no per-stage supplying scopes
    When the PR agent exits non-zero having written no journal entries
    Then the surfaced failure renders byte-for-byte today's output with no attribution hint
