Feature: Documented coverage floor of 95
  As a user or agent operating the coverage gate
  I want the raised default floor of 95 reflected in the Reference docs, the README, and the in-source note
  So that the enforced floor I read everywhere matches the gate's actual behavior and reads as the testing standard's permanent minimum

  # Per the documentation standard, a change that alters a user-facing surface
  # (here, the enforced coverage floor's default value) must leave the /docs
  # Reference page and the README accurate in the same change. The gate's
  # in-source threshold note must also stop claiming the stale 87 floor and must
  # present 95 as the locked-in permanent minimum the gate has now reached.

  Scenario: The coverage-gate Reference page documents the raised floor of 95
    Given the repository docs under docs/
    When the coverage-gate Reference page is read
    Then it documents the COVERAGE_THRESHOLD default of 95
    And it states the default is the testing standard's permanent minimum, reached and locked in, never lowered
    And it no longer presents 87 as the enforced default

  Scenario: The README notes the raised floor of 95
    Given the repository README.md
    When the testing / coverage section is read
    Then it notes the enforced floor is raisable via COVERAGE_THRESHOLD with a default of 95
    And it states the floor sits at the testing standard's 95% minimum and is never lowered

  Scenario: The gate's in-source threshold note reflects the raised floor
    Given the coverage-gate source in src/core/ci/coverage-gate.ts
    When its DEFAULT_COVERAGE_THRESHOLD documentation is read
    Then DEFAULT_COVERAGE_THRESHOLD is 95
    And its doc comment describes the locked-in 95 floor and the COVERAGE_THRESHOLD ratchet
    And it no longer claims the enforced floor sits at 87
