Feature: Configurable contributor selection chooses which gate contributors execute
  As a ratchet maintainer
  I want to select which verdict contributors execute and gate an eval run, from config or the CLI
  So that the single AND-over-contributors gate is configurable without reshaping the aggregation core

  Background:
    Given the verdict-aggregation core decides a run's pass as a logical AND over named contributors
    And the built-in contributors are deterministic, llm-judge, invariants, and regression

  Scenario: With no configuration every contributor is enabled by default
    Given a project with no eval gate configuration
    When the contributor gate is resolved for an eval run
    Then every built-in contributor is enabled
    And the resolved selection is ecosystem-neutral, naming no package manager, test runner, or command string

  Scenario: eval.gate config disables a contributor for the run
    Given ".ratchet/config.yaml" sets eval.gate.llm-judge to false
    When the contributor gate is resolved with no CLI override
    Then the llm-judge contributor is disabled
    And the deterministic, invariants, and regression contributors remain enabled

  Scenario: --no-llm-judge disables the llm-judge contributor from the CLI
    Given a project whose eval.gate config leaves every contributor enabled
    When "ratchet eval run --no-llm-judge" resolves the contributor gate
    Then the llm-judge contributor is disabled for that run
    And the CLI flag overrides the config default

  Scenario: --only restricts the run to the listed contributors
    Given a project with no eval gate configuration
    When "ratchet eval run --only deterministic" resolves the contributor gate
    Then only the deterministic contributor is enabled
    And every contributor not listed by --only is disabled

  Scenario: --gate sets the enabled contributor set explicitly
    Given ".ratchet/config.yaml" enables every contributor
    When "ratchet eval run --gate deterministic,regression" resolves the contributor gate
    Then exactly the deterministic and regression contributors are enabled
    And the explicit --gate selection overrides the config default

  Scenario: the legacy --judge flag is generalized onto contributor selection
    Given a run invoked with the legacy "--judge deterministic" flag
    When the contributor gate is resolved
    Then the llm-judge contributor is disabled, matching the old judge-mode behavior
    And selecting "--judge llm-judge" instead disables the deterministic contributor

  Scenario: an unknown contributor id is rejected with the valid ids listed
    Given a run invoked with "--only not-a-contributor"
    When the contributor gate is resolved
    Then the command fails with an error naming the unknown id
    And the error lists the valid contributor ids

  Scenario: the aggregation core ANDs only over the enabled contributors
    Given a contributor gate with the llm-judge contributor disabled
    And the deterministic, invariants, and regression contributors all report pass
    When the aggregation core computes the run's overall verdict over the enabled contributors
    Then the disabled contributor takes no part in the AND
    And the overall verdict is the AND of the enabled contributors only
