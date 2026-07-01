Feature: batch config verb behavior is proven by tests
  As a maintainer holding ratchet to the testing standard
  I want `batchConfigCommand`'s resolve / get / set contract under test
  So that settings render with their source, secrets never leak, and invalid
    `--set` input leaves the config file untouched

  Background:
    Given an isolated tmpdir fixture repo built under os.tmpdir()
    And `resolveCurrentPlanningHomeSync` is pointed at the fixture root

  Scenario: project-level settings render with their source annotation
    Given a project config with a `batch:` override
    When batchConfigCommand runs with no name
    Then the resolved settings table is printed
    And each value is annotated with its source

  Scenario: a named batch resolves effective settings with manifest overrides
    Given a batch whose manifest overrides a setting
    When batchConfigCommand runs for that batch name
    Then the overridden value is shown as sourced from the manifest

  Scenario: an unknown batch name is rejected
    Given no batch named "ghost" exists
    When batchConfigCommand runs for "ghost"
    Then it throws an error that the batch was not found

  Scenario: --set with no equals sign is rejected
    When batchConfigCommand runs with --set "gate" with no value
    Then it throws an error that key=value was expected

  Scenario: an invalid --set value leaves the config file unchanged
    Given a project config file
    When batchConfigCommand runs with --set on an enum key with a bad value
    Then it throws a validation error
    And the config file on disk is unchanged

  Scenario: a valid --set writes the project-level batch setting
    When batchConfigCommand runs with a valid --set key=value
    Then the project config records `batch.<key>` = value
    And a confirmation line is printed

  Scenario: a secret setting is never echoed back
    When batchConfigCommand sets a secret setting key
    Then the printed confirmation shows a redacted placeholder, not the value

  Scenario: --json redacts the secret authToken in resolved output
    Given a batch whose resolved settings include an authToken
    When batchConfigCommand runs for that batch with --json
    Then the emitted JSON masks the authToken
