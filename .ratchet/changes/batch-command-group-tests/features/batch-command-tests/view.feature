Feature: batch view and list verbs behavior is proven by tests
  As a maintainer holding ratchet to the testing standard
  I want `batchViewCommand` and `batchListCommand`'s rendering under test
  So that the single-batch dashboard and the all-batches list reflect live
    change state on disk

  Background:
    Given an isolated tmpdir fixture repo built under os.tmpdir()
    And `resolveCurrentPlanningHomeSync` is pointed at the fixture root

  Scenario: an empty batch view guides the user to add changes
    Given a batch whose manifest declares no changes
    When batchViewCommand runs
    Then the dashboard explains the batch has no changes yet

  Scenario: the single-batch dashboard renders progress and the next step
    Given a batch with a phase and a mix of done and ready changes
    When batchViewCommand runs
    Then a progress bar and per-change rows are printed
    And the next ready change is named

  Scenario: a parked change surfaces its halt under the change row
    Given a batch with a change parked awaiting approval
    When batchViewCommand runs
    Then the approval request is printed under that change

  Scenario: view --json emits the full derived status
    Given a batch with a phase and changes
    When batchViewCommand runs with --json
    Then the emitted JSON is the full batch status object

  Scenario: list with no batches reports none found
    Given a fixture repo with no batches
    When batchListCommand runs
    Then it reports no batches were found

  Scenario: list renders one row per active batch
    Given two active batches on disk
    When batchListCommand runs
    Then a row with a progress bar is printed for each batch

  Scenario: list --json emits a summary row per batch
    Given two active batches on disk
    When batchListCommand runs with --json
    Then the JSON contains a name/changeCount/progress/status entry per batch
