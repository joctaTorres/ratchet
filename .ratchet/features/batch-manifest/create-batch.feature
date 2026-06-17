Feature: Create a batch manifest
  As a developer coordinating related changes
  I want to scaffold a batch under .ratchet/batches
  So that work can be streamlined across phases in serial or parallel

  Scenario: Scaffold a new batch from the template
    Given a planning home with a .ratchet directory
    When I run "ratchet new batch q3-auth"
    Then a manifest is created at ".ratchet/batches/q3-auth/batch.yaml"
    And the manifest is populated from the batch template
    And the manifest records the created date and at least one phase skeleton

  Scenario: Batch names are validated like change names
    Given a planning home with a .ratchet directory
    When I run "ratchet new batch 'Bad Name!'"
    Then the command fails with a message explaining kebab-case naming

  Scenario: Creating a batch that already exists fails safely
    Given a batch named "q3-auth" already exists
    When I run "ratchet new batch q3-auth"
    Then the command fails without modifying the existing manifest

  Scenario: A batch references changes by name without owning them
    Given a batch "q3-auth" whose manifest names a change "add-login-api"
    When the engine later creates "add-login-api" during a run
    Then the change lives at ".ratchet/changes/add-login-api" like any other change
    And it can be inspected, validated, and archived on its own
    And removing it from the manifest never deletes the change directory

  Scenario: Changes are created lazily as the batch progresses
    Given a freshly scaffolded batch "q3-auth" with phases but no change directories yet
    When I inspect ".ratchet/changes"
    Then no change directories exist for the batch yet
    And the manifest entries are intents to be realized during apply
