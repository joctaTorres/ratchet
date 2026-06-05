Feature: Scenario outlines and shared setup
  As an author with data-driven or repetitive behavior
  I want Scenario Outline, Examples, and Background support
  So that I can express many cases without duplicating scenarios

  Scenario Outline: A behavior is exercised across multiple data rows
    Given a step that uses the placeholder "<input>"
    When the outline is expanded for each Examples row
    Then the implementation must satisfy the case producing "<result>"

    Examples:
      | input | result   |
      | empty | rejected |
      | valid | accepted |

  Scenario: An outline without placeholder parameters is flagged as informational
    Given a "Scenario Outline" whose steps contain no "<placeholder>" parameters
    When the feature is validated
    Then an INFO note suggests using a plain Scenario or adding an Examples table
    And the note does not block validation

  Scenario: Docstrings and comments are ignored by the step model
    Given a scenario containing a triple-quoted docstring and a "#" comment line
    When the feature is parsed
    Then the docstring and comment lines are treated as opaque
    And only the Given, When and Then steps are classified
