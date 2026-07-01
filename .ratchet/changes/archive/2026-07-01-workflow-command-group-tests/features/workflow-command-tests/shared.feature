Feature: shared workflow helpers are proven by tests
  As a maintainer holding ratchet to the testing standard
  I want the shared validation and status-rendering helpers under test
  So that the change/schema guards and the status indicators every workflow
    verb depends on are pinned down by unit and integration tests

  Background:
    Given an isolated tmpdir fixture repo built under os.tmpdir()
    And the fixture is removed in afterEach so no artifacts are left behind

  Scenario: available changes excludes archive and hidden dirs
    Given a changes dir containing a real change, an archive dir, and a dot dir
    When getAvailableChanges is called
    Then only the real change name is returned

  Scenario: available changes is empty when the dir is absent
    Given a project root with no changes directory
    When getAvailableChanges is called
    Then it returns an empty list rather than throwing

  Scenario: validateChangeExists accepts an existing change
    Given a change directory that exists on disk
    When validateChangeExists is called with its name
    Then it returns the change name

  Scenario: validateChangeExists rejects a missing name
    Given no change name is supplied and changes exist
    When validateChangeExists is called
    Then it throws a missing-option error listing the available changes

  Scenario: validateChangeExists rejects an unknown change
    Given a change name that does not exist on disk
    When validateChangeExists is called
    Then it throws a not-found error listing the available changes

  Scenario: validateChangeExists rejects a traversal name
    Given a change name that fails name validation
    When validateChangeExists is called
    Then it throws an invalid-name error

  Scenario: validateSchemaExists rejects an unknown schema
    Given a schema name that has no schema directory
    When validateSchemaExists is called
    Then it throws a schema-not-found error listing the available schemas

  Scenario: status indicators and colors honour NO_COLOR
    Given NO_COLOR is enabled
    When the indicator and color helpers run for each status
    Then the indicators are the plain [x], [ ], [-] markers without color codes
