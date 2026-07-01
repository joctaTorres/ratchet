Feature: Phase proof — the release gate goes DENY when coverage or e2e regresses
  As a maintainer
  I want a blackbox harness that drives the built CLI like a user and watches the gate decision
  So that I can see, end to end, that a green tree stays ALLOW (dry-run) while a coverage shortfall or a failing e2e flips the release-decision module to DENY

  Scenario: A passing run keeps the gate at ALLOW (dry-run)
    Given the package is built
    And the e2e smoke drives the built CLI green end to end like a user
    And the measured coverage is at or above the enforced threshold
    When the harness runs the release gate on the "main" branch with every signal green
    Then the gate outcome is ALLOW
    And the publish path is exercised as a dry-run and nothing is published

  Scenario: A forced coverage-below-threshold flips the gate to DENY
    Given the package is built
    And the coverage total is forced below the enforced threshold
    When the harness runs the release gate on the "main" branch
    Then the coverage gate signal is "red"
    And the release-decision outcome is DENY
    And the dry-run publish path is not reached

  Scenario: A forced failing e2e run flips the gate to DENY
    Given the package is built
    And the e2e smoke is forced to record a failing check
    When the harness runs the release gate on the "main" branch
    Then the e2e gate signal is "red"
    And the release-decision outcome is DENY
    And the dry-run publish path is not reached
