Feature: Batch workflow installs by default on ratchet init
  As a new ratchet user
  I want the batch workflow to ship with a stock init
  So that the batch apply experience is available without configuring a custom profile

  Background:
    Given a fresh project with no ratchet configuration
    And ratchet is run with the default core profile

  Scenario: A stock init installs the batch workflow
    Given no custom profile is configured
    When ratchet init runs with the default core profile
    Then the batch workflow is installed
    And the batch workflow is available to the coding agent without any extra configuration

  Scenario: The core workflow set includes batch
    Given the core profile is in effect
    When ratchet resolves the workflows for the core profile
    Then the resolved set includes "batch"
    And the resolved set still includes "propose"
    And the resolved set still includes "apply"
    And the resolved set still includes "verify"
    And the resolved set still includes "archive"
    And the resolved set still includes "propose-standard"

  Scenario: Existing core workflows still install
    Given no custom profile is configured
    When ratchet init runs with the default core profile
    Then the propose workflow is installed
    And the apply workflow is installed
    And the verify workflow is installed
    And the archive workflow is installed
    And the propose-standard workflow is installed

  Scenario: The batch workflow is installed for every supported agent
    Given a fresh project targeting any agent in the supported-tools registry
    When ratchet init runs with the default core profile
    Then the batch workflow's skill is rendered into that agent's skills directory
    And the batch workflow's command is rendered into that agent's commands directory
