Feature: Wire the security signal into the release-decision gate
  As a maintainer of the ratchet package
  I want the security layer (dependency audit + secret scan) plugged into the release-decision spine
  So that a known vulnerability or a leaked secret provably flips the release gate to DENY — still dry-run, nothing published

  Background:
    Given the release-decision module decides ALLOW only when the branch is "main" and every wired gate is green
    And the dependency-audit gate produces a green/red signal in the release-decision GateSignal shape
    And the secret-scan gate produces a green/red signal in the release-decision GateSignal shape

  Scenario: The release gate now wires a security gate alongside lint, test, coverage, and e2e
    Given the release-gate runner's set of wired gates
    When the wired-gate set is inspected
    Then it includes "lint" and "test"
    And it includes "coverage" and "e2e"
    And it also includes "security"

  Scenario: ALLOW on main only when lint, test, coverage, e2e, and security are all green
    Given the build is on the "main" branch
    And the lint signal is "green"
    And the test signal is "green"
    And the coverage signal is "green"
    And the e2e signal is "green"
    And the security signal is "green"
    When the release gate runs
    Then the outcome is ALLOW
    And the publish path runs as a dry-run

  Scenario: A known vulnerability flips the gate to DENY
    Given the build is on the "main" branch
    And the lint signal is "green"
    And the test signal is "green"
    And the coverage signal is "green"
    And the e2e signal is "green"
    And the security signal is "red"
    When the release gate runs
    Then the outcome is DENY
    And the reasons include that the "security" gate is not green
    And the dry-run publish path does not run

  Scenario: A leaked secret flips the gate to DENY
    Given the build is on the "main" branch
    And the lint signal is "green"
    And the test signal is "green"
    And the coverage signal is "green"
    And the e2e signal is "green"
    And the security signal is "red"
    When the release gate runs
    Then the outcome is DENY
    And the reasons include that the "security" gate is not green
    And the dry-run publish path does not run

  Scenario: Fail-closed when the security signal is missing
    Given the build is on the "main" branch
    And the lint signal is "green"
    And the test signal is "green"
    And the coverage signal is "green"
    And the e2e signal is "green"
    And no security signal is provided
    When the release gate runs
    Then the outcome is DENY
    And the reasons include that the "security" gate is not green

  Scenario: The workflow folds both security step outcomes into one release-gate signal
    Given the CI workflow's release-gate step environment
    When the release-gate step environment is inspected
    Then it sets GATE_SECURITY from the dependency-audit and secret-scan step outcomes
    And GATE_SECURITY is "green" only when both the audit step and the secret-scan step succeeded
    And GATE_SECURITY is fail-closed to "red" when either security step did not succeed
    And the publish step remains "npm publish --dry-run"
