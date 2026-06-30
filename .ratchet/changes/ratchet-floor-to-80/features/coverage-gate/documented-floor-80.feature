Feature: Documented coverage floor of 80
  As a user or agent operating the coverage gate
  I want the raised default floor of 80 reflected in the Reference docs, the README, and the in-source note
  So that the enforced floor I read everywhere matches the gate's actual default

  # Per the documentation standard, a change that alters a user-facing surface
  # (here, the enforced coverage floor) must leave the /docs Reference page and
  # the README accurate in the same change. The gate's in-source threshold note
  # must also stop claiming the stale 78 floor.

  Scenario: The coverage-gate Reference page documents the raised floor of 80
    Given the repository docs under docs/
    When the coverage-gate Reference page is read
    Then it documents the COVERAGE_THRESHOLD default of 80
    And it states the default is a ratchet point raised toward the 95% target and never lowered
    And it no longer presents 78 as the enforced default

  Scenario: The README notes the raised floor of 80
    Given the repository README.md
    When the testing / coverage section is read
    Then it notes the enforced floor is raisable via COVERAGE_THRESHOLD with a default of 80
    And it states the floor is ratcheted upward toward the 95% target and never lowered

  Scenario: The gate's in-source threshold note reflects the raised floor
    Given the coverage-gate source in src/core/ci/coverage-gate.ts
    When its DEFAULT_COVERAGE_THRESHOLD documentation is read
    Then DEFAULT_COVERAGE_THRESHOLD is 80
    And its doc comment describes the raised floor and the COVERAGE_THRESHOLD ratchet
    And it no longer claims the enforced floor sits at 78
