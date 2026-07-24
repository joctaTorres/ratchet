Feature: archive command remainder is proven by integration tests
  As a maintainer holding ratchet to the testing standard
  I want the remaining branches of src/core/archive.ts under integration test
  So that validation gating, confirmations, and the standards-link path are pinned

  Background:
    Given each test builds an isolated .ratchet tree under fs.mkdtemp(os.tmpdir())
    And each test removes its tmp tree in afterEach so no artifacts remain
    And interactive prompts are driven through injected/stubbed answers

  Scenario: archiving aborts when there is no changes directory
    Given a project with no .ratchet/changes directory
    When archive runs
    Then it raises an error telling the user to run init first

  Scenario: archiving a missing change reports it as not found
    Given a changes directory that does not contain the named change
    When archive runs for that name
    Then it raises a "not found" error

  Scenario: blocking feature-validation errors stop the archive
    Given a change whose features fail validation with an ERROR
    When archive runs without skipping validation
    Then the archive is refused and the change is left in place

  Scenario: --yes archives a change that still has incomplete tasks
    Given a change with incomplete tasks
    When archive runs with the yes option
    Then it warns about the incomplete tasks and proceeds to archive

  Scenario: --skip-features archives without touching the feature store
    Given an archivable change
    When archive runs with the skip-features option
    Then the feature store is left unchanged and the change is moved to the archive

  Scenario: a change declaring standards materializes its standard links on archive
    Given an archivable change whose metadata declares a standard tag
    When archive runs and applies features
    Then the declared standard links are materialized into the store

  Scenario: archiving refuses when the dated archive already exists
    Given an archive entry for today already exists for the change
    When archive runs
    Then it raises an "already exists" error and does not overwrite it

  Scenario: skipping validation requires confirmation before archiving
    Given a request to archive with validation disabled and no yes flag
    When the user declines the skip-validation confirmation
    Then the archive is cancelled
