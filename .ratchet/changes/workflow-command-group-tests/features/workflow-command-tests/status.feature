Feature: status verb behavior is proven by tests
  As a maintainer holding ratchet to the testing standard
  I want `statusCommand`'s no-changes, missing-option, and artifact-progress
    rendering under test
  So that the workflow command that reports change status is pinned down by
    integration tests over an isolated tmpdir fixture repo

  Background:
    Given an isolated tmpdir fixture repo built under os.tmpdir()
    And `resolveCurrentPlanningHomeSync` is pointed at the fixture root
    And the fixture is removed in afterEach so no artifacts are left behind

  Scenario: no changes is reported as a valid state
    Given a fixture repo with no changes
    When statusCommand runs without --change
    Then it reports that there are no active changes instead of erroring

  Scenario: no changes with --json emits an empty changes payload
    Given a fixture repo with no changes
    When statusCommand runs with --json and no --change
    Then the emitted JSON carries an empty changes array and a message

  Scenario: changes exist but --change is omitted
    Given a fixture repo with at least one change
    When statusCommand runs without --change
    Then it throws a missing-option error listing the available changes

  Scenario: an existing change renders its artifact progress
    Given a change with a plan and a feature on disk
    When statusCommand runs for that change
    Then it prints the change name, schema, and per-artifact progress

  Scenario: a status snapshot renders as text
    Given a change status with done, ready, and blocked artifacts
    When the status text is printed
    Then each artifact line shows its indicator and blocked deps are named
