Feature: Validating a change's plan
  As a developer preparing a change
  I want plan.md checked for the required sections and trackable tasks
  So that the apply phase can parse progress and the change is well-formed

  Background:
    Given a change whose validity depends on both its features and its plan.md

  Scenario: A plan missing required sections is invalid
    Given a plan.md without a "## Tasks" section
    When the change is validated
    Then an error lists the missing required sections
    And the change is reported as invalid

  Scenario: A plan with no task checkboxes is invalid
    Given a plan.md whose "## Tasks" section contains no "- [ ]" checkboxes
    When the change is validated
    Then an error reports that the Tasks section must contain at least one checkbox
    And the change is reported as invalid

  Scenario: A too-short Why section is warned
    Given a plan.md whose "## Why" section is shorter than the minimum length
    When the change is validated
    Then a warning notes the Why section is too short
    And the warning does not by itself make the change invalid in normal mode

  Scenario: A change is valid only when features and plan both pass
    Given a change with well-formed feature files and a complete plan.md
    When the change is validated
    Then both the feature report and the plan report pass
    And the change is reported as valid
