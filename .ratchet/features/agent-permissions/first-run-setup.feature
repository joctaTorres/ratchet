Feature: First-run guided setup configures permissions, never hanging headless runs
  As a ratchet batch operator
  I want a guided first-run setup for agent permissions
  So that an interactive user is helped to choose a posture while headless runs stay unblocked

  Scenario: first interactive batch command with no config launches guided setup and saves to project by default
    Given no permission config exists at user, project, or change scope
    And the terminal is interactive with a TTY
    When the operator runs a batch command for the first time
    Then a guided permission setup prompts the operator to choose a posture
    And the chosen policy is saved to the project config at ".ratchet/config.yaml" by default

  Scenario: operator can choose to save the policy to the user-global config instead
    Given the guided permission setup is running interactively
    When the operator chooses to save globally instead of to the project
    Then the chosen policy is saved to the user config directory
    And the project config is not modified

  Scenario: headless run with no config does NOT prompt and falls back to the default posture
    Given no permission config exists at user, project, or change scope
    And the run is non-interactive with no TTY
    When the operator runs a batch command
    Then no guided setup prompt is shown
    And the effective posture falls back to "repo-sandboxed-permissive"
    And the command does not block waiting for input

  Scenario: CI environment is treated as non-interactive
    Given no permission config exists at any scope
    And the "CI" environment variable is set
    When the operator runs a batch command
    Then no guided setup prompt is shown
    And the effective posture falls back to "repo-sandboxed-permissive"

  Scenario: once a config exists at any scope there is no re-prompt
    Given a permission config already exists at the project scope
    And the terminal is interactive with a TTY
    When the operator runs a batch command again
    Then no guided setup prompt is shown
    And the existing policy is used as resolved
