Feature: Phase proof — the release gate goes DENY when a vulnerability or secret appears
  As a maintainer
  I want a blackbox harness that composes the security gate runners and watches the gate decision
  So that I can see, end to end, that a clean tree stays ALLOW (dry-run) while a planted vulnerable dependency or a planted secret flips the release-decision module to DENY

  Scenario: A clean tree keeps the gate at ALLOW (dry-run)
    Given the package is built
    And the dependency audit reports no vulnerabilities at or above the threshold
    And the secret scan reports no findings
    When the harness runs the release gate on the "main" branch with every signal green
    Then the dependency-audit gate signal is "green"
    And the secret-scan gate signal is "green"
    And the gate outcome is ALLOW
    And the publish path is exercised as a dry-run and nothing is published

  Scenario: A planted vulnerable dependency flips the gate to DENY
    Given the package is built
    And the dependency audit reports a vulnerability at or above the threshold
    When the harness runs the release gate on the "main" branch
    Then the dependency-audit gate signal is "red"
    And the combined security signal is "red"
    And the release-decision outcome is DENY
    And the dry-run publish path is not reached

  Scenario: A planted secret flips the gate to DENY
    Given the package is built
    And the secret scan reports a leaked credential finding
    When the harness runs the release gate on the "main" branch
    Then the secret-scan gate signal is "red"
    And the combined security signal is "red"
    And the release-decision outcome is DENY
    And the dry-run publish path is not reached
