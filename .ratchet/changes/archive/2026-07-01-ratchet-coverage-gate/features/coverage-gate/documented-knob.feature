Feature: Documented COVERAGE_THRESHOLD knob
  As a user or agent operating the coverage gate
  I want the COVERAGE_THRESHOLD knob documented in Reference docs and the README
  So that I can discover and use the ratchet point without reading the source

  # Per the documentation standard, a change that alters a user-facing surface
  # (here, the enforced coverage floor and its COVERAGE_THRESHOLD override) must
  # leave a /docs Reference page and the README accurate in the same change. The
  # gate's in-source threshold note must also stop claiming the stale 68 / 68.67%
  # baseline.

  Scenario: A Reference page documents the coverage gate and its knob
    Given the repository docs under docs/
    When the coverage-gate Reference page is read
    Then it documents the COVERAGE_THRESHOLD environment variable and its raised default of 72
    And it documents the COVERAGE_SUMMARY variable and the json-summary path it reads
    And it states the gate is green when total.lines.pct is at or above the enforced threshold and red below it
    And it states the gate exits 0 when green and 1 when red

  Scenario: The README notes the COVERAGE_THRESHOLD knob
    Given the repository README.md
    When the testing / coverage section is read
    Then it notes that the enforced coverage floor is raisable via the COVERAGE_THRESHOLD environment variable
    And it states the floor is ratcheted upward toward the 95% target and never lowered

  Scenario: The gate's in-source threshold note reflects the raised floor
    Given the coverage-gate source in src/core/ci/coverage-gate.ts
    When its DEFAULT_COVERAGE_THRESHOLD documentation is read
    Then it describes the raised default of 72 and the COVERAGE_THRESHOLD override
    And it no longer claims the enforced floor sits at the 68 / 68.67% baseline
