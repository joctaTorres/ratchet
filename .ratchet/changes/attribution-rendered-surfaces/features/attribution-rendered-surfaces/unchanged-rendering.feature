Feature: Non-attributed failures render byte-for-byte unchanged
  As a batch operator with existing tooling parsing rendered step failures
  I want failures that carry no model attribution to render exactly as they do today
  So that the attribution hint enriches only the argv-rejection failure shape and
  never disturbs any other rendered output

  Scenario: A bare-name spec failure renders unchanged on every surface
    Given a transition's resolved spec is a bare agent name with no model part
    When the agent exits non-zero with no completion report and no journal entries written during the session
    Then the non-JSON blocked output, the parked reason, the journal entry message, and the standalone renderer output are byte-for-byte identical to today's rendering
    And no surface mentions a stage, model string, or supplying scope

  Scenario: A failure after session journal progress renders unchanged
    Given a transition's resolved spec explicitly names a model with a threaded stage scope
    And the agent wrote a journal entry during the session before failing
    When the agent exits non-zero without a completion report
    Then every rendered surface is byte-for-byte identical to today's rendering with no attribution hint

  Scenario: A scope-less standalone explicit-model failure renders unchanged
    Given a standalone change step runs with an explicit model but no threaded agentStageScopes
    When the agent exits non-zero with no completion report and no journal entries written during the session
    Then the standalone renderer output carries no attribution hint and is byte-for-byte identical to today's rendering
