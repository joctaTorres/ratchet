Feature: the validate verb offers an interactive selector when run bare
  As a maintainer holding ratchet to the testing standard
  I want src/commands/validate.ts's interactive selector branch under test
  So that the bare-invocation menu and its routing are proven, not assumed

  # When execute() is called with no item and no flags in an interactive context,
  # runInteractiveSelector imports @inquirer/prompts and offers an all/changes/
  # specs/one menu, then routes the choice into bulk validation or a single-item
  # validation. None of this is covered today. These scenarios stub the prompt
  # so the selector's routing runs in-process over an isolated tmpdir fixture.

  Background:
    Given an isolated tmpdir fixture repo built under os.tmpdir() with a .ratchet/ tree
    And @inquirer/prompts select is stubbed to return a chosen value
    And the test process.chdir's into the fixture and restores cwd in afterEach

  Scenario: choosing "all" routes into bulk validation of changes and specs
    Given the fixture has a valid change and a spec
    And the stubbed selector returns "all"
    When the validate verb runs bare in interactive mode
    Then bulk validation runs over both the change and the spec

  Scenario: choosing "changes" routes into bulk validation of changes only
    Given the fixture has a valid change and a spec
    And the stubbed selector returns "changes"
    When the validate verb runs bare in interactive mode
    Then only the change is validated

  Scenario: choosing "specs" routes into bulk validation of specs only
    Given the fixture has a valid change and a spec
    And the stubbed selector returns "specs"
    When the validate verb runs bare in interactive mode
    Then only the spec is validated

  Scenario: choosing "one" then an item validates that single item
    Given the fixture has a valid change
    And the stubbed selector returns "one" and then the change item
    When the validate verb runs bare in interactive mode
    Then the chosen change is validated as a single item

  Scenario: choosing "one" with no items reports nothing to validate
    Given the fixture has no changes and no specs
    And the stubbed selector returns "one"
    When the validate verb runs bare in interactive mode
    Then "No items found to validate." is printed to stderr
    And process.exitCode is 1
