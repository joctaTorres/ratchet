Feature: profile migration is proven by fixture-isolated tests
  As a maintainer holding ratchet to the testing standard
  I want core/migration.ts under test over an isolated tmpdir project and config
  So that the one-time profile migration's scan, no-op, and migrate paths are
    pinned without depending on the real repo or the developer's global config

  Background:
    Given an isolated project tree built under fs.mkdtemp(os.tmpdir())
    And an isolated global config directory pointed at by XDG_CONFIG_HOME under a tmpdir
    And both are removed and the global-config cache reset in afterEach
    So that the tests depend on no real repo or config, on each other, or on order

  Scenario: scanInstalledWorkflows finds nothing in an empty project
    Given a project with no installed workflow skills or commands
    When scanInstalledWorkflows runs over the detected tools
    Then it returns an empty list

  Scenario: scanInstalledWorkflows reports workflows installed as skills
    Given a project with one workflow's SKILL.md written under a tool's skills dir
    When scanInstalledWorkflows runs
    Then the returned list includes that workflow id

  Scenario: scanInstalledWorkflows reports workflows installed as commands
    Given a project with one workflow's command file written at its adapter path
    When scanInstalledWorkflows runs
    Then the returned list includes that workflow id

  Scenario: migrateIfNeeded is a no-op when a profile is already set
    Given a global config file that already has a profile field
    When migrateIfNeeded runs
    Then the config is left unchanged and no migration is performed

  Scenario: migrateIfNeeded is a no-op for a new project with no installed workflows
    Given a global config with no profile field and a project with no workflows
    When migrateIfNeeded runs
    Then the config is left without a profile and defaults apply

  Scenario: migrateIfNeeded sets the custom profile when workflows are installed
    Given a global config with no profile field and a project with installed workflows
    When migrateIfNeeded runs
    Then the saved config has profile "custom" with the detected workflows

  Scenario: migrateIfNeeded infers delivery from the installed artifact kinds
    Given a project with workflows installed only as skills, only as commands, and as both
    And a global config with no profile and no delivery field
    When migrateIfNeeded runs for each
    Then the inferred delivery is "skills", "commands", and "both" respectively
    And an already-set delivery field is preserved

  Scenario: migrateIfNeeded skips silently when the config file cannot be read
    Given a global config path holding unreadable or malformed JSON
    When migrateIfNeeded runs
    Then it returns without throwing and performs no migration
