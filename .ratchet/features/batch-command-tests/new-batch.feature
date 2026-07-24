Feature: new batch verb behavior is proven by tests
  As a maintainer holding ratchet to the testing standard
  I want `newBatchCommand`'s scaffold-from-template contract under test
  So that it validates the name, refuses to clobber, and writes a stamped
    manifest

  Background:
    Given an isolated tmpdir fixture repo built under os.tmpdir()
    And `resolveCurrentPlanningHomeSync` is pointed at the fixture root

  Scenario: a missing name is rejected
    When newBatchCommand runs with no name
    Then it throws an error that the <name> argument is required

  Scenario: a non-kebab-case name is rejected
    When newBatchCommand runs with an invalid name
    Then it throws a validation error noting batch names use kebab-case

  Scenario: scaffolding writes a manifest stamped with the batch name
    When newBatchCommand runs with a valid new name
    Then a `batch.yaml` manifest is written under `.ratchet/batches/<name>/`
    And the manifest's `name:` line is stamped with that name
    And a confirmation line reports the created path

  Scenario: an existing batch is not overwritten
    Given a batch "already-here" already exists
    When newBatchCommand runs for "already-here"
    Then it throws an error that the batch already exists
    And the existing manifest on disk is unchanged

  Scenario: --json emits the created batch name and path
    When newBatchCommand runs with --json for a valid new name
    Then a single JSON object with the batch name and manifest path is printed
