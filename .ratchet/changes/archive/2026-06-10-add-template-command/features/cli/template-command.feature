Feature: Print canonical schema templates
  As an agent or developer authoring an artifact outside a change
  I want a command that prints a schema's canonical template
  So that what I write follows the schema's single source of truth instead of a hand-copied structure

  Background:
    Given a project that uses ratchet

  Scenario: Printing a schema template by name
    Given the "ratchet" schema ships a "standard" template
    When I run "ratchet template standard"
    Then the canonical "standard" template is printed to stdout
    And the output is byte-identical to the schema's template file

  Scenario: A bare name resolves a known template extension
    Given the "ratchet" schema ships templates with different extensions
    When I run "ratchet template plan"
    Then the "plan.md" template is printed
    And I did not have to type the file extension

  Scenario: A project-local schema template overrides the bundled one
    Given a project that defines its own "standard" template for the "ratchet" schema
    When I run "ratchet template standard"
    Then the project-local template is printed
    And the bundled template is not used

  Scenario: The bundled template is used when the project has no override
    Given a project with no local override for the "standard" template
    When I run "ratchet template standard"
    Then the bundled schema template is printed

  Scenario: An unknown template name fails clearly
    Given the "ratchet" schema has no template named "nonexistent"
    When I run "ratchet template nonexistent"
    Then the command reports that the template was not found
    And the command exits with a non-zero status

  Scenario: Authoring a standard follows the printed template
    Given I am authoring a new standard
    When I fetch the template with "ratchet template standard" and follow it
    Then the standard I write matches the schema's canonical structure
    And it cannot drift from a separately embedded copy
