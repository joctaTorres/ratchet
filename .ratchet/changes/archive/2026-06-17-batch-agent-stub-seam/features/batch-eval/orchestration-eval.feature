Feature: Deterministically evaluable batch orchestration
  As a maintainer guarding the batch engine against regressions
  I want the apply, transition and halt scenarios judged by deterministic checks
  So that "batch works" is asserted without a live agent or flaky nesting

  Scenario: Apply advances exactly one step driven by the stub
    Given a batch fixture and a scripted agent via "RATCHET_BATCH_AGENT_CMD"
    When the eval check runs "ratchet batch apply" once
    Then exactly one transition is performed and control returns
    And the verdict is decided from the observable batch state, not an LLM

  Scenario: The per-change transition order is asserted deterministically
    Given a scripted agent that scaffolds, implements, then verifies
    When the check runs apply three times for one change
    Then the recorded transitions are propose, then apply, then verify

  Scenario: A halt and resume is exercised by the scripted agent
    Given a scripted agent that raises a blocker on propose
    When the check runs apply, records an answer, and runs apply again
    Then the step parks as blocked and then resumes with the answer in context

  Scenario: Recovered batch cases become checks, deferred ones stay unjudged
    Given the stub seam exists
    When the batch-orchestration eval spec is updated
    Then the apply, transition and halt scenarios are bound as "check"
    And the proof-of-work phase-gating scenarios remain unjudged with a deferred-host-loop rationale
