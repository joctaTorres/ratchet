Feature: Proof verdict persists which condition matched and the matched excerpt
  As a batch reviewer
  I want the recorded proof-of-work verdict to say what actually matched
  So that gate evidence is reviewable instead of a bare pass/fail bit

  Scenario: Contains condition records its kind and the needle as excerpt
    Given a phase proof-of-work whose pass is "contains:12 passed"
    And the proof command exits zero with "12 passed" in its stdout
    When the proof-of-work runs
    Then the verdict passes
    And the verdict records condition kind "contains"
    And the verdict records the matched excerpt "12 passed"

  Scenario: Regex condition records the actual matched text
    Given a phase proof-of-work whose pass is "regex:PASS-[0-9]+"
    And the proof command exits zero with "result: PASS-42 ok" in its stdout
    When the proof-of-work runs
    Then the verdict passes
    And the verdict records condition kind "regex"
    And the verdict records the matched excerpt "PASS-42"

  Scenario: Exit-zero condition records its kind with no excerpt
    Given a phase proof-of-work whose pass is "exit code 0 — suite green"
    And the proof command exits zero
    When the proof-of-work runs
    Then the verdict passes
    And the verdict records condition kind "exit-zero"
    And the verdict records no matched excerpt

  Scenario: Failing condition records its kind without a matched excerpt
    Given a phase proof-of-work whose pass is "contains:12 passed"
    And the proof command exits zero without "12 passed" in its stdout
    When the proof-of-work runs
    Then the verdict fails as pass-condition-unmet
    And the verdict records condition kind "contains"
    And the verdict records no matched excerpt

  Scenario: The journaled proof record carries the matched evidence
    Given a batch at a phase boundary whose proof-of-work passes a contains condition
    When the boundary proof is run and journaled
    Then the durable proof-of-work record persists the condition kind and matched excerpt
    And readers of older records without those fields are unaffected
