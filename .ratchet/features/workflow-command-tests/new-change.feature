Feature: new change verb behavior is proven by tests
  As a maintainer holding ratchet to the testing standard
  I want `newChangeCommand`'s create, validate, schema, and description
    contract under test
  So that the workflow command that scaffolds a change is pinned down by
    integration tests over an isolated tmpdir fixture repo

  Background:
    Given an isolated tmpdir fixture repo built under os.tmpdir()
    And `resolveCurrentPlanningHomeSync` is pointed at the fixture root
    And the fixture is removed in afterEach so no artifacts are left behind

  Scenario: a valid name scaffolds the change directory
    Given a valid kebab-case change name
    When newChangeCommand runs without --json
    Then the change directory is created under .ratchet/changes/
    And a .ratchet.yaml metadata file is written for it
    And it prints the created location and the resolved schema

  Scenario: --json emits the created change payload
    Given a valid change name
    When newChangeCommand runs with --json
    Then the emitted JSON carries the change id, path, metadataPath and schema

  Scenario: a description writes a README.md
    Given a valid change name and a description
    When newChangeCommand runs
    Then a README.md containing the description is written in the change dir

  Scenario: a missing name is rejected
    Given no change name is supplied
    When newChangeCommand runs with --json
    Then it reports a missing-argument error and exits non-zero

  Scenario: an invalid name is rejected
    Given a change name that fails name validation
    When newChangeCommand runs with --json
    Then it reports the validation error and exits non-zero

  Scenario: an unknown schema is rejected
    Given a valid name but a schema that does not exist
    When newChangeCommand runs with --json
    Then it reports the schema-not-found error and exits non-zero
