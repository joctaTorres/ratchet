Feature: Documented coverage floor of 87 and coverage scope
  As a user or agent operating the coverage gate
  I want the raised default floor of 87 and the application-scoped coverage reflected in the Reference docs, the README, and the in-source note
  So that the enforced floor and the measured scope I read everywhere match the gate's actual behavior

  # Per the documentation standard, a change that alters a user-facing surface
  # (here, the enforced coverage floor's default and what the coverage run
  # measures) must leave the /docs Reference page and the README accurate in the
  # same change. The gate's in-source threshold note must also stop claiming the
  # stale 80 floor.

  Scenario: The coverage-gate Reference page documents the raised floor of 87
    Given the repository docs under docs/
    When the coverage-gate Reference page is read
    Then it documents the COVERAGE_THRESHOLD default of 87
    And it states the default is a ratchet point raised toward the 95% target and never lowered
    And it no longer presents 80 as the enforced default

  Scenario: The coverage-gate Reference page documents the coverage scope
    Given the repository docs under docs/
    When the coverage-gate Reference page is read
    Then it states the coverage run measures the application code
    And it states the non-app demo scripts under scripts/ and the root tooling config eslint.config.js are excluded from coverage alongside the vendored .agents/ checkouts

  Scenario: The README notes the raised floor of 87
    Given the repository README.md
    When the testing / coverage section is read
    Then it notes the enforced floor is raisable via COVERAGE_THRESHOLD with a default of 87
    And it states the floor is ratcheted upward toward the 95% target and never lowered

  Scenario: The gate's in-source threshold note reflects the raised floor
    Given the coverage-gate source in src/core/ci/coverage-gate.ts
    When its DEFAULT_COVERAGE_THRESHOLD documentation is read
    Then DEFAULT_COVERAGE_THRESHOLD is 87
    And its doc comment describes the raised floor and the COVERAGE_THRESHOLD ratchet
    And it no longer claims the enforced floor sits at 80
