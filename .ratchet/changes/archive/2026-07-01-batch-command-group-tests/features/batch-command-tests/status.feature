Feature: batch status verb behavior is proven by tests
  As a maintainer holding ratchet to the testing standard
  I want `batchStatusCommand`'s derived-status rendering under test
  So that the text and `--json` views faithfully reflect change state on disk

  Background:
    Given an isolated tmpdir fixture repo built under os.tmpdir()
    And `resolveCurrentPlanningHomeSync` is pointed at the fixture root

  Scenario: an empty batch reports it has no changes yet
    Given a batch whose manifest declares no changes
    When batchStatusCommand runs
    Then the text output notes there are no changes yet

  Scenario: text output renders phases, change symbols, and the next step
    Given a batch with a phase and a mix of done and ready changes
    When batchStatusCommand runs
    Then each phase and its changes are printed with status symbols
    And the next ready change is named

  Scenario: a parked blocked change surfaces its blocker question
    Given a batch with a change parked as blocked
    When batchStatusCommand runs
    Then the blocker reason is printed under that change

  Scenario: --json emits phases, changes, progress, and the next step
    Given a batch with a phase and changes
    When batchStatusCommand runs with --json
    Then the JSON includes the batch name, status, the configured gate, and the
      per-change done/progress/blocked fields
