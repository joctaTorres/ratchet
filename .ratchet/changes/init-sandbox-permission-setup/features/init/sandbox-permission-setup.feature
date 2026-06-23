Feature: Sandbox permission setup during init
  As a developer running ratchet init
  I want to be offered project-level permission config for agent sandbox execution
  So that headless batch runs have a permission posture without a separate setup step

  Background:
    Given I run "ratchet init" in interactive mode
    And I have completed the "Select tools to set up" selection

  Scenario: Offer permission setup when no project-level config exists
    Given the project has no project-level agent sandbox permission config
    When the tool selection completes
    Then I am asked whether to set up project-level permission config for agent sandbox execution
    And the prompt explains the config governs what spawned coding agents may do without approval

  Scenario: Accepting runs the sandbox permission setup flow
    Given the project has no project-level agent sandbox permission config
    And I am asked whether to set up project-level permission config
    When I accept the offer
    Then I am prompted to choose an agent permission posture
    And the chosen posture is saved to the project config at ".ratchet/config.yaml"
    And init continues to create the project structure

  Scenario: Declining skips permission setup without writing config
    Given the project has no project-level agent sandbox permission config
    And I am asked whether to set up project-level permission config
    When I decline the offer
    Then no agent sandbox permission config is written
    And init continues to create the project structure

  Scenario: Skip the offer entirely when project-level config already exists
    Given the project already has project-level agent sandbox permission config
    When the tool selection completes
    Then I am not asked to set up project-level permission config
    And init continues to create the project structure without changing the existing config

  Scenario: No permission prompt in non-interactive mode
    Given I run "ratchet init" in non-interactive mode
    And the project has no project-level agent sandbox permission config
    When the tool selection step is processed
    Then I am not asked to set up project-level permission config
    And init continues without writing an agent sandbox permission config
