Feature: apply verb behavior is proven by tests
  As a maintainer holding ratchet to the testing standard
  I want the apply verb's preconditions and forced-transition contract under test
  So that its no-spawn-on-failed-precondition guarantee is enforced

  Background:
    Given an isolated tmpdir fixture repo built under os.tmpdir()
    And the engine agent spawn is replaced by an injected fake runtime
    So that no real agent is ever spawned during the test

  Scenario: applying a non-existent change throws before any spawn
    Given no change directory exists for "ghost"
    When applyCommand runs for "ghost"
    Then it throws an actionable error pointing to `ratchet propose`
    And the injected runtime is never invoked

  Scenario: applying a change with no plan.md fails fast without --force
    Given a change "no-plan" exists but has no plan.md
    When applyCommand runs without --force
    Then it throws an actionable error hinting at propose or --force
    And the injected runtime is never invoked

  Scenario: --force bypasses the missing-plan precondition
    Given a change "no-plan" exists but has no plan.md
    And an injected runtime that returns an advanced result
    When applyCommand runs with --force
    Then the precondition is bypassed and exactly one step runs

  Scenario: a happy-path apply advances via the forced apply transition
    Given a change "ready" exists with a plan.md
    And an injected runtime that returns an advanced result
    When applyCommand runs
    Then exactly one step runs with the forced transition "apply"
    And the rendered result reports the change as advanced through apply
