Feature: init and update legacy/tool remainders are proven by integration tests
  As a maintainer holding ratchet to the testing standard
  I want the remaining branches of src/core/init.ts and src/core/update.ts under
    integration test
  So that legacy-cleanup decisions and tool validation are pinned over a fixture repo

  Background:
    Given each test builds an isolated project under fs.mkdtemp(os.tmpdir())
    And each test removes its tmp tree in afterEach so no artifacts remain
    And interactive prompts are driven through injected/stubbed answers

  Scenario: init validates an unknown requested tool
    Given an init invocation naming a tool id that does not exist
    When the requested tools are validated
    Then it raises an error listing the valid tool ids

  Scenario: init rejects a tool that cannot generate skills
    Given an init invocation naming a known tool with no skills directory
    When the requested tools are validated
    Then it raises an error listing the tools that support skill generation

  Scenario: declining the interactive legacy-cleanup prompt cancels init
    Given a project with legacy files and an interactive init session
    When the user declines the cleanup confirmation
    Then init reports the cancellation and does not clean up

  Scenario: update warns and continues when legacy cleanup needs --force non-interactively
    Given a non-interactive update session over a project with legacy files and no force flag
    When update handles the legacy artifacts
    Then it warns to re-run with --force or interactively and continues without cleaning up

  Scenario: declining update's interactive cleanup continues the skill update
    Given an interactive update session over a project with legacy files
    When the user declines the cleanup confirmation
    Then update skips the cleanup and proceeds with the skill update

  Scenario: selecting no tools during update skips tool setup
    Given an interactive update tool-selection prompt
    When the user selects no tools
    Then update reports it is skipping tool setup
