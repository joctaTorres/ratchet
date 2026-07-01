Feature: verify verb behavior is proven by tests
  As a maintainer holding ratchet to the testing standard
  I want the verify verb's preconditions and forced-transition contract under test
  So that it refuses to verify unfinished work without an explicit override

  Background:
    Given an isolated tmpdir fixture repo built under os.tmpdir()
    And the engine agent spawn is replaced by an injected fake runtime
    So that no real agent is ever spawned during the test

  Scenario: verifying a non-existent change throws before any spawn
    Given no change directory exists for "ghost"
    When verifyCommand runs for "ghost"
    Then it throws an actionable error pointing to `ratchet propose`
    And the injected runtime is never invoked

  Scenario: verifying a change with unfinished tasks fails fast without --force
    Given a change "half-done" exists with some unchecked ## Tasks checkboxes
    When verifyCommand runs without --force
    Then it throws an actionable error reporting the done/total count and hinting at apply or --force
    And the injected runtime is never invoked

  Scenario: --force bypasses the unfinished-tasks precondition
    Given a change "half-done" exists with unfinished tasks
    And an injected runtime that returns an advanced result
    When verifyCommand runs with --force
    Then the precondition is bypassed and exactly one step runs

  Scenario: a happy-path verify advances via the forced verify transition
    Given a change "complete" exists with every ## Tasks checkbox checked
    And an injected runtime that returns an advanced result
    When verifyCommand runs
    Then exactly one step runs with the forced transition "verify"
    And the rendered result reports the change as verified
