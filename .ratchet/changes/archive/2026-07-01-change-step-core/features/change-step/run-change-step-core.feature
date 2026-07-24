Feature: A change-scoped engine core that drives one forced transition
  As the batch engine and (soon) the standalone propose/apply/verify verbs
  I want a runChangeStep(ctx) that spawns exactly one agent for a single
  forced transition on a single change
  So that headless verbs and batch apply share one code path for advancing
  a change by one step, without each re-deriving the transition

  Background:
    Given a change with a definition of done and a resolved phase context
    And an injected agent runtime so no real agent is spawned

  Scenario: runChangeStep spawns exactly one agent for the forced transition
    Given a ChangeStepContext whose transition is "propose"
    When runChangeStep is called with that context
    Then the engine builds instructions for the "propose" transition
    And it spawns exactly one agent for that transition
    And it returns a structured StepResult naming the same change and transition

  Scenario: The forced transition is honoured, not re-derived from disk
    Given on-disk change state that would otherwise advance past "propose"
    And a ChangeStepContext whose transition is forced to "propose"
    When runChangeStep is called
    Then the agent is spawned for the forced "propose" transition
    And the engine does not call computeNextTransition to override it

  Scenario: A successful session maps to an advanced result
    Given an injected runtime whose agent records a completion and exits zero
    When runChangeStep is called for the forced transition
    Then the returned StepResult state is "advanced"
    And it points to the journal entries the session produced

  Scenario: A failing or unknown agent surfaces as blocked, staying resumable
    Given an injected runtime whose agent exits non-zero without completing
    When runChangeStep is called
    Then the returned StepResult state is "blocked"
    And the blocker carries the failure detail rather than reporting a clean advance
