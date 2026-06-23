Feature: Phase proof — the release gate goes DENY when a vulnerability or secret appears
  As a maintainer
  I want a blackbox harness that composes the security gate runners and watches the gate decision
  So that I can see, end to end, that a clean tree stays ALLOW (dry-run) while a planted vulnerable dependency or a planted secret flips the release-decision module to DENY

  # This is the phase-3 proof-of-work: `bash test/e2e/security-gate.sh`. It is a
  # blackbox harness, not a unit test — it builds the package and exercises the
  # real gate runners against real (and forced) reports, the way CI does, then
  # asserts on the gate's decision. It is the single command a maintainer runs to
  # trust the whole "a vulnerability or a leaked secret blocks the release"
  # guarantee.
  #
  # The harness composes the signal-producers shipped by the two prior changes (the
  # dependency-audit gate over an audit JSON report, the secret-scan gate over a
  # scan JSON report) with the release-gate runner extended here. As in CI, the
  # audit and secret-scan step outcomes are folded into a single GATE_SECURITY that
  # is green only when BOTH succeed. Inputs are FORCED by pointing the runners at
  # scratch fixture reports (a high/critical audit count, a finding), not by
  # sabotaging real source, so the harness is deterministic. The publish path it
  # observes is always `--dry-run`.

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
