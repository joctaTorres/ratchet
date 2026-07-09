Feature: Manifest load rejects degenerate proof-of-work pass conditions
  As a batch author
  I want trivially-satisfiable pass conditions rejected when the manifest loads
  So that a hard-gate proof-of-work can never be vacuous by construction

  Scenario: Empty contains needle is rejected at parse
    Given a batch manifest whose phase proofOfWork pass is "contains:"
    When the manifest is parsed
    Then parsing fails with a located manifest error
    And the error names the empty contains needle as the cause

  Scenario: Whitespace-only contains needle is rejected at parse
    Given a batch manifest whose phase proofOfWork pass is "contains:   "
    When the manifest is parsed
    Then parsing fails with a located manifest error
    And the error names the empty contains needle as the cause

  Scenario: Empty regex pattern is rejected at parse
    Given a batch manifest whose phase proofOfWork pass is "regex:"
    When the manifest is parsed
    Then parsing fails with a located manifest error
    And the error names the empty regex pattern as the cause

  Scenario: Invalid regex is rejected with the compile error surfaced
    Given a batch manifest whose phase proofOfWork pass is "regex:[unclosed"
    When the manifest is parsed
    Then parsing fails with a located manifest error
    And the error message includes the regex compile error text

  Scenario: Echo-your-own-pass-phrase contains condition is rejected
    Given a batch manifest phase whose run command is "echo ALL GREEN"
    And whose proofOfWork pass is "contains:ALL GREEN"
    When the manifest is parsed
    Then parsing fails with a located manifest error
    And the error names the self-satisfying shape where the pass needle appears in the run command

  Scenario: Echo-your-own-pass-phrase bare-string condition is rejected
    Given a batch manifest phase whose run command is "echo PROOF DONE"
    And whose proofOfWork pass is the bare string "PROOF DONE"
    When the manifest is parsed
    Then parsing fails with a located manifest error
    And the error names the self-satisfying shape where the pass needle appears in the run command

  Scenario: Exit-zero directive is never linted against the run command
    Given a batch manifest phase whose run command mentions "exit code 0" in a comment
    And whose proofOfWork pass is "exit code 0 — suite green"
    When the manifest is parsed
    Then the manifest loads successfully

  Scenario: Well-formed pass conditions still load
    Given a batch manifest phase whose run command is a test invocation
    And whose proofOfWork pass is "contains:" followed by a needle not present in the run command
    When the manifest is parsed
    Then the manifest loads successfully

  Scenario: Both manifest load paths enforce the validation
    Given a batch on disk whose manifest carries an empty regex pattern
    When the batch manifest is loaded by name
    Then loading fails with the same located manifest error as direct parsing
