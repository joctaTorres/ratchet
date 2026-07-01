Feature: Testing standard in the standards library
  As a ratchet maintainer
  I want a `testing` standard codified in the standards library
  So that every change is held to one explicit, ratchetable testing strategy

  Background:
    Given the ratchet repository has a standards library at ".ratchet/standards/"

  Scenario: The testing standard file exists with the required strategy content
    Given the standards library
    When I read ".ratchet/standards/testing.md"
    Then the file declares a unique frontmatter tag "testing"
    And it states the test-pyramid shape ratchet follows (unit, integration, E2E)
    And it states what to test where across that pyramid
    And it mandates a minimum line-coverage floor of 95%
    And it documents the fixture and end-to-end test patterns ratchet uses

  Scenario: The testing standard passes standard validation
    Given the testing standard exists in the standards library
    When the validator validates the standards of a change
    Then validation reports no errors for the testing standard
    And the "testing" tag does not collide with any other standard's tag

  Scenario: The testing standard is surfaced as an active standard
    Given the testing standard exists in the standards library
    When an agent runs `ratchet instructions` for an artifact of a change
    Then the testing standard appears in the active standards list
    And its frontmatter tag "testing" and full content are included

  Scenario: A change can declare that it follows the testing standard
    Given the testing standard exists in the standards library
    When a change records "testing" in its ".ratchet.yaml" standards list
    Then validation resolves the "testing" tag to the testing standard
    And validation reports no unresolved-standard error for that change
