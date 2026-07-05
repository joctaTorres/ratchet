Feature: Failure surfaces without the argv-rejection signature stay unchanged
  As a batch operator
  I want every failure that does not match the argv-level rejection signature
  to surface byte-for-byte what it surfaces today
  So that attribution enriches exactly one failure shape and nothing else drifts

  Scenario: A bare-name spec failure surfaces byte-for-byte today's output
    Given the apply stage resolves to the bare agent name "opencode" with no model part
    When the apply transition's agent exits non-zero with no completion report and no session journal entries
    Then the surfaced failed step carries no attribution hint
    And its detail, blocker, and message are byte-for-byte what today's mapping produces

  Scenario: A failure after session journal progress surfaces unchanged
    Given the apply stage resolves to the spec "opencode:zai/glm-5.2" supplied by the project config
    And the agent wrote at least one journal entry during the session
    When the agent exits non-zero with no completion report
    Then the surfaced failed step carries no attribution hint
    And its detail, blocker, and message are byte-for-byte what today's mapping produces

  Scenario: Non-failed outcome branches are never touched by attribution
    Given the apply stage resolves to a spec that explicitly names a model
    When the agent reports a completion, raises a blocker, or exits zero without reporting
    Then each surfaced outcome is byte-for-byte what today's mapping produces for that branch

  Scenario: A failure with no stage scope attribution surfaces unchanged
    Given the outcome mapper receives no supplying-scope attribution for the failed stage
    When the agent exits non-zero with no completion report and no session journal entries
    Then the surfaced failed step carries no attribution hint
    And its detail, blocker, and message are byte-for-byte what today's mapping produces

  Scenario: Exposing per-stage scopes changes no resolved setting
    Given any layering of scalar and stage-map agent values across project config and manifest scopes
    When batch settings are resolved
    Then the resolved settings and their sources are byte-for-byte what today's resolution produces
    And the resolution additionally exposes each stage's supplying scope for the agent setting
