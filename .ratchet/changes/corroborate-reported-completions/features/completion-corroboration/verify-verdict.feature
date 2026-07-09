Feature: Verify completion must carry the verification verdict
  As a batch operator
  I want a verify step's `--complete` message to carry the verification
  report's final-assessment verdict before it counts toward done
  So that the whole-batch done-gate (a journaled verify completion) cannot be
  satisfied by an empty attestation like `--complete "done"`

  # The rct:verify workflow (the single author of the verify lifecycle) already
  # produces a Final Assessment line — "Ready for archive" or
  # "N critical issue(s) found…". "Carries the verdict" means the completion
  # message matches the exported verdict pattern in outcome.ts that recognizes
  # those canonical final-assessment shapes. The pattern checks PRESENCE of a
  # verdict, not its polarity — polarity handling stays out of scope here.

  Scenario: Verify completion whose message carries a ready-for-archive verdict advances
    Given a session for the "verify" transition on an applied change
    And its completion message contains "Ready for archive"
    When the session is mapped to an outcome
    Then the outcome state is "advanced"

  Scenario: Verify completion whose message carries a critical-issue verdict advances
    Given a session for the "verify" transition on an applied change
    And its completion message contains "2 critical issues found"
    When the session is mapped to an outcome
    Then the outcome state is "advanced"

  Scenario: Verify completion with a verdict-free message is blocked
    Given a session for the "verify" transition on an applied change
    And its completion message is "done" with no verdict wording
    When the session is mapped to an outcome
    Then the outcome state is "blocked"
    And the blocker says the step was reported complete but disk disagrees
    And the blocker names the missing verify evidence (no verification verdict in the completion)

  Scenario: Propose and apply completions are not held to the verdict pattern
    Given a session for the "apply" transition whose entries contain a completion
    And its completion message is a plain summary with no verdict wording
    And the after-session disk state shows task progress
    When the session is mapped to an outcome
    Then the outcome state is "advanced"

  Scenario: Verify step instructions tell the agent to report the verdict
    Given the engine builds agent instructions for a "verify" transition
    When the instruction text is rendered
    Then it tells the agent the `--complete` summary MUST include the
      verification report's final-assessment verdict
    And the wording is agent-neutral (names no specific coding agent)
