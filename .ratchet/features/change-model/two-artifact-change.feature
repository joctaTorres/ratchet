Feature: Two-artifact change model
  As a developer using ratchet
  I want every change to consist of exactly Gherkin features plus a plan
  So that intent (features) and execution (plan) are captured in two predictable artifacts

  Background:
    Given a ratchet project initialized with the "ratchet" schema

  Scenario: Scaffolding a new change creates the change directory and metadata
    Given no change named "add-login" exists yet
    When I run "ratchet new change add-login"
    Then a change directory ".ratchet/changes/add-login" is created
    And a ".ratchet.yaml" metadata file records the schema for the change
    But the features and plan artifacts are authored afterward, not pre-created

  Scenario: The plan artifact depends on the features artifact
    Given the built-in "ratchet" schema with artifacts "features" and "plan"
    When the artifact dependency graph is resolved
    Then "features" has no prerequisites and is ready first
    And "plan" requires "features" before it can be authored

  Scenario: Apply is blocked until the plan artifact exists
    Given a change "add-login" that has feature files but no completed plan
    When the change status is computed
    Then "applyRequires" lists "plan"
    And apply is reported as blocked until "plan" is complete

  Scenario: A change with both artifacts complete is ready to apply
    Given a change "add-login" with valid feature files and a complete plan.md
    When the change status is computed
    Then every artifact is marked done
    And the change is reported as complete and ready for apply
