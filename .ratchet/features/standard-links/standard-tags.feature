Feature: Unique standard tags
  As a developer maintaining a standards library
  I want every standard to carry a stable, unique tag
  So that changes and features can reference a standard without depending on its file name

  Background:
    Given a project with a ".ratchet/standards/" library

  Scenario: A standard declares a tag in its frontmatter
    Given a standard file "security.md"
    When it declares "tag: security" in its frontmatter
    Then the standard is identified by the tag "security"
    And the tag is independent of the file name

  Scenario: A standard authored without a tag falls back to its file name
    Given a standard file "testing.md" with no "tag" in its frontmatter
    When the standards library is loaded
    Then the standard's tag is "testing"

  Scenario: Tags must be unique across the library
    Given a standard "security.md" with "tag: security"
    And another standard "appsec.md" also with "tag: security"
    When the project is validated
    Then validation reports a duplicate standard tag "security"

  Scenario: Authoring a standard assigns it a tag
    Given I author a new standard for the concern "accessibility"
    When the standard file is written
    Then its frontmatter contains a unique "tag"
