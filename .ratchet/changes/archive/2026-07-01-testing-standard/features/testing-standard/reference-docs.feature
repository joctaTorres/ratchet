Feature: Reference documentation for the testing standard
  As a ratchet user or agent
  I want the testing standard described in the project's Reference docs
  So that I can look up the testing strategy without reading the standard source

  Background:
    Given the ratchet repository documents its machinery under the "docs/" directory

  Scenario: A docs reference page documents the testing standard
    Given the testing standard exists in the standards library
    When I read the testing-standard Reference page under "docs/"
    Then the page describes the test pyramid and what to test where
    And it states the 95% minimum line-coverage floor
    And it describes the fixture and end-to-end test patterns
    And the page is Reference-style, factual, and free of tutorial or rationale prose

  Scenario: The README points to the testing standard
    Given the testing standard and its Reference page exist
    When I read the repository "README.md"
    Then the README mentions the testing standard
    And it links or points to the testing-standard Reference page under "docs/"

  Scenario: The Reference page matches the standard it documents
    Given the testing-standard Reference page exists
    When I compare the page against ".ratchet/standards/testing.md"
    Then the coverage floor, pyramid shape, and patterns described match the standard
    And no claim in the page contradicts the standard's text
