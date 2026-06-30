Feature: validate verb behavior is proven by tests
  As a maintainer holding ratchet to the testing standard
  I want the validate verb's item-resolution and exit-code contract under test
  So that its non-interactive guidance and error paths are pinned down

  Background:
    Given an isolated tmpdir fixture repo built under os.tmpdir()
    And the planning home resolved to that fixture

  Scenario: no item in non-interactive mode prints guidance and fails
    Given no item name and --no-interactive
    When ValidateCommand.execute runs
    Then a "Nothing to validate" hint listing the bulk and single-item forms is printed
    And the process exit code is set to 1

  Scenario: an unknown item reports an error with nearest-match suggestions
    Given the fixture contains a change "real-change"
    And an item name "rael-change" that matches no change or spec
    When ValidateCommand.execute runs in non-interactive mode
    Then an "Unknown item" error is printed
    And a "Did you mean" suggestion including "real-change" is offered
    And the process exit code is set to 1

  Scenario: a name matching both a change and a spec is reported as ambiguous
    Given the fixture contains both a change and a spec named "dup"
    When ValidateCommand.execute runs for "dup" with no --type override
    Then an "Ambiguous item" error is printed directing the user to pass --type
    And the process exit code is set to 1

  Scenario: a valid change validates successfully without setting a failure exit code
    Given the fixture contains a structurally valid change "good-change"
    When ValidateCommand.execute runs for "good-change"
    Then the change is reported valid
    And no failure exit code is set
