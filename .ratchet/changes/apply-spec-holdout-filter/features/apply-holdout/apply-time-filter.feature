Feature: Apply-time hold-out filtering
  As a change author advancing a change through `ratchet instructions apply`
  I want `@holdout`-tagged Scenario content stripped from the spec context handed to the building agent
  So that a held-out scenario stays an unseen, anti-overfitting check the agent cannot special-case, while
    `eval run` and batch `verify` still gate on it like any other case

  Scenario: A held-out scenario is stripped from the building agent's materialized spec
    Given a change with a .feature artifact containing one @holdout-tagged Scenario and one untagged Scenario
    When apply instructions are generated for that change
    Then the contextFiles entry for the feature artifact points to a materialized file distinct from the source path
    And the materialized file's content contains the untagged Scenario
    And the materialized file's content does not contain the @holdout-tagged Scenario's name or steps

  Scenario: The raw source feature file is left untouched on disk
    Given a change with a .feature artifact containing an @holdout-tagged Scenario
    When apply instructions are generated for that change
    Then the source .feature file's content still contains the @holdout-tagged Scenario byte-for-byte unchanged

  Scenario: A feature artifact with no held-out scenarios materializes unchanged
    Given a change with a .feature artifact containing only untagged Scenarios
    When apply instructions are generated for that change
    Then the materialized file's content is equivalent to the source file's content

  Scenario: An entire feature file held out via all-scenario tagging exposes no scenarios
    Given a change with a .feature artifact whose every Scenario is tagged @holdout
    When apply instructions are generated for that change
    Then the materialized file's content retains the Feature name
    And the materialized file's content contains no Scenario blocks

  Scenario: Non-feature artifacts pass through untouched
    Given a change with a plan.md artifact alongside its .feature artifact
    When apply instructions are generated for that change
    Then the contextFiles entry for the plan artifact still points to the original plan.md path

  Scenario: eval run continues to enumerate and gate the held-out scenario
    Given a change whose .feature artifact contains an @holdout-tagged Scenario
    When the eval set is enumerated for that change's scope
    Then the held-out case is present in the enumerated set alongside every other case
    And its tags include @holdout with no change to verdict or aggregation behavior
