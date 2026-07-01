Feature: Coverage scoped to the application
  As a maintainer ratcheting test coverage upward
  I want vitest coverage to measure only this repo's application code
  So that non-app demo scripts and root tooling config do not drag the measured total down and the enforced floor reflects real app coverage

  # vitest.config.ts already excludes the gitignored vendored checkouts under
  # .agents/** from coverage. Two more sources are not application code that the
  # suite is meant to cover: the terminal-animation demo scripts under scripts/**
  # (braille / spin / preview demos, run by hand, not part of the shipped CLI)
  # and the root tooling config eslint.config.js. Measuring them as uncovered
  # application lines understates real coverage. This change joins those two to
  # the existing .agents/** exclusion so the measured total.lines.pct reflects the
  # application. website/ stays measured — it is now covered by an earlier phase.

  Scenario: The non-app demo scripts are excluded from coverage
    Given the vitest coverage configuration in vitest.config.ts
    When the coverage exclude list is read
    Then it excludes the terminal-animation demo scripts under scripts/**
    And the scripts/** demo files are not instrumented by the coverage run

  Scenario: The root tooling config is excluded from coverage
    Given the vitest coverage configuration in vitest.config.ts
    When the coverage exclude list is read
    Then it excludes the root tooling config eslint.config.js
    And eslint.config.js is not instrumented by the coverage run

  Scenario: The existing exclusion is preserved
    Given the vitest coverage configuration in vitest.config.ts
    When the coverage exclude list is read
    Then it still excludes the vendored checkouts under .agents/**

  Scenario: The website application code stays measured
    Given the vitest coverage configuration in vitest.config.ts
    When the coverage exclude list is read
    Then it does not exclude website/
    And the now-covered website/ application code is still measured in the coverage total
