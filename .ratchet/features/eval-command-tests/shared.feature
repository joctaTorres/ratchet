Feature: Eval command-group shared helpers
  As a maintainer of the ratchet eval verbs
  I want the shared scope/judge helpers covered by integration tests
  So that scope resolution and judge-mode selection cannot silently regress

  Background:
    Given an isolated tmpdir fixture repo with a minimal .ratchet/ tree
    And the shared helpers are imported directly (no command entrypoint)

  Scenario: Default scope is the permanent feature store
    Given no scope flags are set
    When resolveScope is called
    Then it returns a scope of kind "store"

  Scenario: The --change flag selects a single change scope
    Given the flag --change is set to "my-change"
    When resolveScope is called
    Then it returns a scope of kind "change" targeting "my-change"

  Scenario: The --path flag selects a path scope
    Given the flag --path is set to "some/dir"
    When resolveScope is called
    Then it returns a scope of kind "path" targeting "some/dir"

  Scenario: The --changes flag selects the all-changes scope
    Given the flag --changes is set
    When resolveScope is called
    Then it returns a scope of kind "changes"

  Scenario: Combining scope flags is rejected
    Given more than one of --changes, --change, --path is set
    When resolveScope is called
    Then it throws an error naming the mutually-exclusive flags

  Scenario: An explicit valid --judge flag wins
    Given the flag --judge is set to "check"
    When resolveJudgeMode is called
    Then it returns "check" without reading project config

  Scenario: An invalid --judge flag is rejected
    Given the flag --judge is set to "nonsense"
    When resolveJudgeMode is called
    Then it throws an error listing the valid modes auto | check | agent

  Scenario: The configured judge default is used when no flag is given
    Given the project config sets eval.judge to "agent"
    And no --judge flag is set
    When resolveJudgeMode is called
    Then it returns "agent"

  Scenario: Judge mode falls back to auto when unflagged and unconfigured
    Given no --judge flag is set
    And the project config does not configure eval.judge
    When resolveJudgeMode is called
    Then it returns "auto"
