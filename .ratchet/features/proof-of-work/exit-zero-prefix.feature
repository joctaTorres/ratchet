Feature: Recognize a leading exit-zero directive in a pass condition
  As an author of a proof-of-work pass condition (batch manifest or eval check)
  I want a condition that begins with an exit-code directive like "exit code 0 — ..."
  So that natural prose conditions gate on the exit code instead of silently
    failing closed as an unsatisfiable stdout substring match

  Background:
    Given the pass-condition evaluator used by both the batch proof-of-work gate
      and the eval judge

  Scenario: A prose condition that starts with "exit code 0" gates on exit status
    Given a pass condition "exit code 0 — new tests assert the slice works"
    When the command exits 0 with stdout that does not contain that sentence
    Then the proof-of-work passes
    And the reason is "pass-condition-met"

  Scenario: A prose exit-zero condition fails on a non-zero exit
    Given a pass condition "exit code 0 — new tests assert the slice works"
    When the command exits 1
    Then the proof-of-work fails
    And the reason is "nonzero-exit"

  Scenario Outline: Leading exit-zero directives are recognized regardless of form
    Given a pass condition "<condition>"
    When the command exits 0 with unrelated stdout
    Then the proof-of-work passes

    Examples:
      | condition                          |
      | exit 0                             |
      | exit-zero                          |
      | exit code 0                        |
      | Exit 0, then the suite is green    |
      | exit-zero: integration suite green |
      | EXIT CODE 0 — everything passes    |

  Scenario: An explicit contains: condition is unchanged
    Given a pass condition "contains:PASS"
    When the command exits 0 with stdout "all PASS"
    Then the proof-of-work passes

  Scenario: An explicit contains: condition still fails when stdout lacks the text
    Given a pass condition "contains:PASS"
    When the command exits 0 with stdout "FAIL"
    Then the proof-of-work fails
    And the reason is "pass-condition-unmet"

  Scenario: An explicit regex: condition is unchanged
    Given a pass condition "regex:\d+ passing"
    When the command exits 0 with stdout "12 passing"
    Then the proof-of-work passes

  Scenario: A bare non-exit-code string still falls to the substring default
    Given a pass condition "all checks green"
    When the command exits 0 with stdout "all checks green now"
    Then the proof-of-work passes
    And the match is evaluated as a stdout substring

  Scenario: A bare non-exit-code string fails when stdout lacks it
    Given a pass condition "all checks green"
    When the command exits 0 with stdout "something else"
    Then the proof-of-work fails
    And the reason is "pass-condition-unmet"
