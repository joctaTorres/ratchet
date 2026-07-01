Feature: Invariant manifest loader
  As ratchet's eval gate
  I want a typed loader for the .ratchet/evals/invariants.yaml manifest
  So that the anti-gaming invariant set is parsed into well-formed kinds and a
  malformed manifest fails closed instead of silently becoming a vacuous pass

  # This is the schema/loader slice of the invariant set: it parses the manifest
  # into the three invariant kinds (deterministic / monotonic / snapshot), each
  # carrying an `active` flag, and decides only one thing — whether the manifest
  # is well-formed. Evaluating invariants and gating the verdict are downstream.

  Background:
    Given a project with a .ratchet/evals/ directory

  Scenario: Load a manifest carrying all three invariant kinds with active flags
    Given a .ratchet/evals/invariants.yaml that declares:
      | id                  | kind          | active |
      | spec-not-weakened   | monotonic     | true   |
      | tests-still-exist   | deterministic | false  |
      | public-api-unchanged| snapshot      | false  |
    When the invariant manifest is loaded for the project
    Then the loaded set contains three invariants in declared order
    And the "spec-not-weakened" invariant is kind "monotonic" and active
    And the "tests-still-exist" invariant is kind "deterministic" and inert
    And the "public-api-unchanged" invariant is kind "snapshot" and inert

  Scenario: Each kind carries its kind-specific fields
    Given a manifest with a deterministic invariant whose predicate is a check
      command with a pass condition, a monotonic invariant naming a measure, and a
      snapshot invariant naming a checked-in golden
    When the invariant manifest is loaded for the project
    Then the deterministic invariant exposes its check run command and pass condition
    And the monotonic invariant exposes the name of the measure it tracks
    And the snapshot invariant exposes the path to its golden

  Scenario: A missing manifest yields an empty set, not an error
    Given the project has no .ratchet/evals/invariants.yaml file
    When the invariant manifest is loaded for the project
    Then the loaded set is empty
    And no error is raised

  Scenario: Malformed YAML fails closed by surfacing a parse error
    Given a .ratchet/evals/invariants.yaml whose contents are not valid YAML
    When the invariant manifest is loaded for the project
    Then loading surfaces a manifest parse error
    And the loader never returns a silently empty set for a present-but-broken manifest

  Scenario Outline: An invalid invariant fails closed by surfacing a validation error
    Given a .ratchet/evals/invariants.yaml containing an invariant that <defect>
    When the invariant manifest is loaded for the project
    Then loading surfaces a manifest validation error naming the offending invariant
    And the loader never returns a silently empty set for an invalid manifest

    Examples:
      | defect                                                  |
      | declares an unknown kind                                |
      | omits the required active flag                          |
      | omits a field its kind requires                         |
      | reuses an id already declared by another invariant      |
