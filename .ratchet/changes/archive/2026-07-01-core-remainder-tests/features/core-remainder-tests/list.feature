Feature: list command remainder is proven by integration tests
  As a maintainer holding ratchet to the testing standard
  I want the remaining branches of src/core/list.ts under integration test
  So that specs mode, JSON output, and sorting are pinned over a fixture repo

  Background:
    Given each test builds an isolated .ratchet tree under fs.mkdtemp(os.tmpdir())
    And each test removes its tmp tree in afterEach so no artifacts remain

  Scenario: specs mode lists features grouped by capability
    Given a feature store holding .feature files under several capability folders
    When the list command runs in specs mode
    Then each capability is listed once with its feature count

  Scenario: specs mode reports nothing to show when the feature store is empty
    Given a project whose features directory exists but holds no .feature files
    When the list command runs in specs mode
    Then it reports that no features were found

  Scenario: changes mode emits machine-readable JSON when asked
    Given a changes directory holding one in-progress change
    When the list command runs in changes mode with the json option
    Then it prints a JSON document carrying the change name, task counts, and status

  Scenario: changes mode can sort alphabetically by name
    Given several changes with differing names
    When the list command runs with the name sort option
    Then the changes are listed in alphabetical order

  Scenario: changes mode reports an empty changes set
    Given a changes directory with no active changes
    When the list command runs
    Then it reports that no active changes were found
