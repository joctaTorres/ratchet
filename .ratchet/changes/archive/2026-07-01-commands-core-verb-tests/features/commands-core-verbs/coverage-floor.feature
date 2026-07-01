Feature: the raised coverage floor is green after covering the core verbs
  As a maintainer ratcheting the testing strategy upward
  I want the full suite and the coverage gate to pass at the raised floor
  So that the new verb tests are enforced and cannot silently regress

  Scenario: the full test suite is green
    Given the new unit/integration tests for apply, verify, validate and propose
    When the full vitest suite is run with coverage
    Then it exits 0 with every test passing

  Scenario: the coverage gate is green at the raised floor of 72
    Given measured total line coverage at or above 72 percent
    When the coverage gate runs with COVERAGE_THRESHOLD=72
    Then the gate exits 0, confirming the floor is held by the added tests
