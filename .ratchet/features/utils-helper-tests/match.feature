Feature: match helpers are proven by unit tests
  As a maintainer holding ratchet to the testing standard
  I want the pure string-matching helpers in src/utils/match.ts under unit test
  So that nearest-match suggestions and the Levenshtein distance they rank on
    are pinned to their contract

  Background:
    Given the match helpers are deterministic over in-memory inputs
    And the unit tests touch no filesystem and spawn no process

  Scenario: levenshtein returns zero for identical strings
    Given two equal strings
    When levenshtein runs
    Then it returns 0

  Scenario: levenshtein counts a single substitution
    Given two strings differing by one character
    When levenshtein runs
    Then it returns 1

  Scenario: levenshtein handles insertion and deletion
    Given a string and the same string with one character added
    When levenshtein runs
    Then it returns the number of added or removed characters

  Scenario: levenshtein handles an empty operand
    Given one empty string and one non-empty string
    When levenshtein runs
    Then it returns the length of the non-empty string

  Scenario: nearestMatches ranks candidates by distance and caps the result
    Given an input and more candidates than the requested maximum
    When nearestMatches runs
    Then it returns the closest candidates first, capped at the maximum

  Scenario: nearestMatches returns all candidates when fewer than the maximum
    Given an input and fewer candidates than the default maximum
    When nearestMatches runs
    Then it returns every candidate ordered by distance

  Scenario: nearestMatches honors a custom maximum
    Given an input, several candidates, and a custom maximum
    When nearestMatches runs
    Then it returns at most the custom maximum number of candidates

  Scenario: nearestMatches over an empty candidate list returns nothing
    Given an input and no candidates
    When nearestMatches runs
    Then it returns an empty list
