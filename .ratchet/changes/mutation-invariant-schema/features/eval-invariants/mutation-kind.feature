Feature: Mutation invariant schema
  As ratchet's invariant manifest loader
  I want a `kind: mutation` invariant carrying `test`, `budget`, and `threshold`
  So that a mutation-testing invariant can be declared and typed alongside the
  existing three kinds, ready for the evaluator to gate on it in a follow-on
  change

  Background:
    Given a project with a .ratchet/evals/ directory

  Scenario: Load a mutation invariant exposing its test/budget/threshold fields
    Given a .ratchet/evals/invariants.yaml that declares a "mutation" invariant
      with test command "pnpm test", budget 5, and threshold 3
    When the invariant manifest is loaded for the project
    Then the loaded invariant is kind "mutation"
    And it exposes "pnpm test" as the test command that is the oracle
    And it exposes a budget of 5
    And it exposes a threshold of 3

  Scenario: A mutation invariant coexists with the existing three kinds
    Given a manifest declaring one deterministic, one monotonic, one snapshot,
      and one mutation invariant together
    When the invariant manifest is loaded for the project
    Then all four invariants load in declared order
    And each kind still exposes its own kind-specific fields unchanged

  Scenario Outline: A mutation invariant missing a required field fails closed
    Given a .ratchet/evals/invariants.yaml declaring a mutation invariant that
      omits its <field> field
    When the invariant manifest is loaded for the project
    Then loading surfaces a manifest validation error naming the invariant
    And the loader never returns a silently empty set for an invalid manifest

    Examples:
      | field     |
      | test      |
      | budget    |
      | threshold |

  Scenario Outline: A non-positive budget or threshold fails closed
    Given a .ratchet/evals/invariants.yaml declaring a mutation invariant whose
      <field> is 0
    When the invariant manifest is loaded for the project
    Then loading surfaces a manifest validation error naming the invariant

    Examples:
      | field     |
      | budget    |
      | threshold |
