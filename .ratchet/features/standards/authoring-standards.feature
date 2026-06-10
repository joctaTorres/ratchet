Feature: Authoring standards
  As a developer
  I want a guided command to write a new standard
  So that I can grow my own library of standards without hand-crafting files

  Background:
    Given a project that uses ratchet
    And the standards authoring workflow is installed

  Scenario: The propose-standard workflow is available after init
    Given I ran "ratchet init" and selected my AI tool
    When I look at the generated skills and commands
    Then a "propose-standard" command is available
    And a standards-authoring skill is installed for my tool

  Scenario: Authoring a standard writes a file into the standards library
    Given an empty ".ratchet/standards/" directory
    When I author a testing standard named "testing"
    Then a file "testing.md" exists in ".ratchet/standards/"
    And the file describes the testing standard in markdown

  Scenario: A newly authored standard follows the standard template
    Given I author a standard named "security"
    When I open ".ratchet/standards/security.md"
    Then it follows the standard template structure
    And it names the standard and states the guidelines it enforces

  Scenario: Authoring writes directly to the library without creating a change
    Given an empty ".ratchet/changes/" directory
    When I author a standard named "architecture"
    Then ".ratchet/standards/architecture.md" exists
    And no new change directory was created under ".ratchet/changes/"

  Scenario: A standard authored now is loaded by the next propose
    Given I author a testing standard named "testing"
    When I later propose a new change
    Then the propose instructions include the content of "testing.md"
