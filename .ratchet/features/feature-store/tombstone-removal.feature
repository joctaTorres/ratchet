Feature: Removing features via tombstones
  As an author retiring a behavior
  I want a tombstone file that lists store paths to delete
  So that removals ratchet forward deterministically alongside additions

  Background:
    Given a change may include a "features/.deleted" tombstone file

  Scenario: A tombstoned store file is deleted
    Given the store contains "user-auth/legacy.feature"
    And the change's tombstone lists "user-auth/legacy.feature"
    When the change's features are applied
    Then the store file is removed
    And it is counted as deleted under its capability

  Scenario: A tombstone entry that does not exist is ignored
    Given the change's tombstone lists "user-auth/never-existed.feature"
    And no such file exists in the store
    When the change's features are applied
    Then nothing is removed for that entry
    And no deletion is counted for it

  Scenario: Comments and blank lines in the tombstone are ignored
    Given a tombstone containing blank lines and "#"-prefixed comment lines
    When the tombstone is read during apply
    Then comment and blank lines are skipped
    And only the remaining store-relative paths are treated as removals
