Feature: Completion followed by a crash, gate ordering, and exempt step kinds
  As a batch operator
  I want a completion that is followed by a non-zero exit or signal to fail
  closed, corroboration to run before the approval gate, and non-change step
  kinds to keep today's behavior
  So that a crash cannot hide behind an already-reported completion and the
  integrity gate does not break decompose/pr steps whose journal keys have no
  change directory

  Scenario: Completion followed by a non-zero exit is blocked, not advanced
    Given a session for the "apply" transition whose entries contain a completion
    And the after-session disk state corroborates the completion
    But the agent process exited with code 1
    When the session is mapped to an outcome
    Then the outcome state is "blocked" and not "advanced"
    And the blocker says the agent reported completion but the session ended abnormally
    And the blocker names the exit (code or signal) so the operator can review

  Scenario: Completion followed by a signal kill is blocked
    Given a session for the "propose" transition whose entries contain a completion
    And the after-session disk state corroborates the completion
    But the agent process was killed via signal SIGKILL
    When the session is mapped to an outcome
    Then the outcome state is "blocked"
    And the blocker says the agent reported completion but the session ended abnormally

  Scenario: A corroboration mismatch blocks even under an after-propose approval gate
    Given a session for the "propose" transition whose entries contain a completion
    And the step would park for approval under an after-propose gate
    But the after-session disk state has no plan.md
    When the session is mapped to an outcome
    Then the outcome state is "blocked" and not "awaiting-approval"
    And the blocker says the step was reported complete but disk disagrees

  Scenario: A corroborated propose completion under the approval gate still parks for approval
    Given a session for the "propose" transition whose entries contain a completion
    And the step would park for approval under an after-propose gate
    And the after-session disk state has the change directory and plan.md present
    When the session is mapped to an outcome
    Then the outcome state is "awaiting-approval", byte-for-byte as today

  Scenario: Decompose step completions are exempt from disk corroboration
    Given a session for the "decompose" step kind whose entries contain a completion
    And the disk evidence for its synthetic journal key shows no change directory
    When the session is mapped to an outcome
    Then the outcome state is "advanced", byte-for-byte as today

  Scenario: PR step completions are exempt from disk corroboration
    Given a session for the "pr" step kind whose entries contain a completion
    And the disk evidence for its synthetic journal key shows no change directory
    When the session is mapped to an outcome
    Then the outcome state is "advanced", byte-for-byte as today

  Scenario: A reported blocker still wins over everything, unchanged
    Given a session whose entries contain a blocker and a completion
    When the session is mapped to an outcome
    Then the outcome state is "blocked" with the blocker's message, byte-for-byte as today
