Feature: Secret-scan allowlist is narrowed to file and fingerprint
  As a maintainer of the secret-scan gate
  I want the allowlist to match only a precise fingerprint or a known-safe file
  So that allowlisting can never exempt every finding of a rule across the whole tree

  Scenario: A bare rule-id allowlist entry no longer exempts a finding
    Given a secret-scan finding with rule "generic-api-key" in file "src/leak.ts"
    And the allowlist contains only the bare rule "generic-api-key"
    When the secret-scan gate evaluates the findings
    Then the gate signal is red
    And the finding is not counted as allowlisted

  Scenario: A file:rule fingerprint allowlist entry still exempts that finding
    Given a secret-scan finding with rule "test-fixture-secret" in file "test/fixtures/planted.txt"
    And the allowlist contains the fingerprint "test/fixtures/planted.txt:test-fixture-secret"
    When the secret-scan gate evaluates the findings
    Then the gate signal is green
    And the finding is counted as allowlisted

  Scenario: A bare file allowlist entry still exempts findings in that file
    Given a secret-scan finding with rule "generic-api-key" in file "test/core/batch/permissions-resolution.test.ts"
    And the allowlist contains the bare file "test/core/batch/permissions-resolution.test.ts"
    When the secret-scan gate evaluates the findings
    Then the gate signal is green
    And the finding is counted as allowlisted

  Scenario: A bare-rule exemption does not hide a real leak in another file
    Given a secret-scan finding with rule "aws-access-key" in file "src/real-leak.ts"
    And the allowlist contains only the bare rule "aws-access-key"
    When the secret-scan gate evaluates the findings
    Then the gate signal is red
    And the reasons name the offending file "src/real-leak.ts"
