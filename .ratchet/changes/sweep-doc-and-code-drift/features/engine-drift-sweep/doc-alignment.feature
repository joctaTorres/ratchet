Feature: Engine reference docs match the code
  As a reader of the engine Reference docs
  I want every documented field, state, and path to describe the code as it is
  So that docs never mislead reviewers about engine behavior

  Scenario: guidance field is documented as skill arguments
    Given the engine hands caller guidance to the lifecycle skill invocation as its arguments ($ARGUMENTS)
    When a reader consults the `guidance` field notes in docs/engine/change-step.md
    Then the doc states the guidance rides as the skill invocation's arguments
    And no engine doc claims guidance is "appended verbatim" as an "Additional guidance:" block

  Scenario: StepState docs list only states the engine produces
    Given the engine never produces a `phase-gated` step result
    And the PR step produces `nothing-ready` for its inactive-grouping and already-opened preconditions
    When a reader consults the StepState union in the engine docs
    Then `phase-gated` is absent from the union, diagrams, and state tables
    And `nothing-ready` remains documented as a produced state

  Scenario: coverage-gate reference lives outside the engine docs
    Given the coverage gate is CI machinery, not batch-engine machinery
    When a reader browses docs/engine/
    Then no coverage-gate document is listed there
    And the README links the coverage-gate Reference page at its new location

  Scenario: intentional identities are annotated, not left ambiguous
    Given decompositionJournalKey returns the phase name unchanged
    And the sidecar runtime always reports a null exit signal
    When a reader consults each site's JSDoc
    Then the identity journal key is annotated as intentional with its reason
    And the always-null signal is annotated as intentional with its reason
