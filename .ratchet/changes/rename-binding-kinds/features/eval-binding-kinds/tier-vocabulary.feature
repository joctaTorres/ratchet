Feature: Eval binding tier vocabulary
  As a ratchet maintainer authoring eval-spec bindings
  I want binding kinds named for the verdict tier they contribute
  So that the kind vocabulary matches the verdict/aggregation model and reads consistently

  Background:
    Given a ratchet project with .ratchet/evals/specs/ and at least one .feature scenario

  Scenario: A deterministic binding is parsed under the new kind name
    Given an eval-spec binding whose kind is "deterministic" with a check.run command
    When the eval specs are loaded
    Then the binding resolves successfully
    And its kind is reported as "deterministic"
    And no parse warning is produced for that binding

  Scenario: An llm-judge binding is parsed under the new kind name
    Given an eval-spec binding whose kind is "llm-judge" with success criteria
    When the eval specs are loaded
    Then the binding resolves successfully
    And its kind is reported as "llm-judge"
    And no parse warning is produced for that binding

  Scenario: The retired kind names are no longer accepted
    Given an eval-spec binding whose kind is the legacy value "check"
    When the eval specs are loaded
    Then the binding does not resolve
    And a warning names the invalid binding
    And the targeted case is treated as unbound

  Scenario: eval set reports the new kind labels
    Given a "deterministic" binding and an "llm-judge" binding and one unbound case in scope
    When I run "ratchet eval set"
    Then the deterministic case is tagged "[deterministic]"
    And the llm-judge case is tagged "[llm-judge]"
    And the unbound case is tagged "[unbound]"
    And no case is tagged "[check]" or "[agent]"

  Scenario Outline: Judge-mode filtering uses the new kind vocabulary
    Given a "deterministic" binding and an "llm-judge" binding in scope
    When I run "ratchet eval run --judge <mode>"
    Then the "<judged>" case receives a pass/fail verdict
    And the "<skipped>" case is recorded unjudged with a mode-mismatch reason

    Examples:
      | mode          | judged        | skipped       |
      | deterministic | deterministic | llm-judge     |
      | llm-judge     | llm-judge     | deterministic |
