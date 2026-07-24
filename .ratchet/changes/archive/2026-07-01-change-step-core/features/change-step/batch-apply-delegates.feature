Feature: Batch apply delegates its single step to the change-scoped core
  As a maintainer extracting the engine's change-scoped core
  I want batch apply's runStep to delegate the actual agent spawn to
  runChangeStep
  So that batch and headless verbs share one path and batch behaviour is
  provably unchanged

  Background:
    Given a batch manifest with a ready change in its first phase
    And an injected agent runtime so no real agent is spawned

  Scenario: runStep derives the transition then delegates to runChangeStep
    Given a ready change whose authoritative next transition derives to "propose"
    When the engine runs one step for that change
    Then runStep computes the transition from on-disk state and the journal
    And it hands that forced transition to runChangeStep, which spawns the agent
    And exactly one agent is spawned for the step

  Scenario: Lock and park-precedence stay runStep's responsibility
    Given the per-batch single-flight lock is held by runStep
    And a parked step whose required input has not been recorded
    When the engine runs one step
    Then runStep honours the lock and the park before any delegation
    And runChangeStep is not entered while the park is unresolved

  Scenario: Existing batch apply behaviour is identical after the extraction
    Given the existing batch-engine tests for apply behaviour
    When runStep delegates the agent spawn to runChangeStep
    Then the persisted outcome, transition derivation, and parking are unchanged
    And the existing batch-apply test suite still passes
