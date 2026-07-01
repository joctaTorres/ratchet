Feature: Default manifest scaffolds a kind: mutation invariant
  As a project owner running ratchet init for the first time
  I want the starter .ratchet/evals/invariants.yaml to already declare a
  kind: mutation invariant, scaffolded inert alongside tests-still-exist
  So that turning on real mutation-testing anti-gaming is a matter of filling
  in my own test command rather than hand-authoring the entry from scratch

  # This is the init-scaffolding slice for the mutation invariant kind. The
  # manifest schema (mutation-invariant-schema), the harness
  # (mutation-oracle-harness), and the evaluator wiring
  # (mutation-evaluator-fold, mutation-evidence-recording) are already
  # shipped and gate over whatever manifest exists. This slice is the one
  # place that writes the manifest in the first place, on `ratchet init`,
  # so the mutation invariant is present — inert, but ready to complete —
  # from the first run.

  Scenario: A detected test directory scaffolds a live, inert mutation invariant
    Given a project with no .ratchet/evals/invariants.yaml file and a conventional test directory
    When ratchet init runs for the project
    Then the manifest declares a mutation invariant as kind "mutation" and inert
    And the mutation invariant carries placeholder "test", "budget", and "threshold" values
    And the entry is uncommented YAML ready to flip to active once the placeholder test command is filled in

  Scenario: No detectable test directory scaffolds a commented mutation placeholder instead
    Given a project with no .ratchet/evals/invariants.yaml file and no conventional test directory
    When ratchet init runs for the project
    Then the manifest contains a commented mutation invariant placeholder
    And no live mutation invariant is parsed from the manifest

  Scenario: The scaffolded mutation invariant is never active-by-default
    Given a project with no .ratchet/evals/invariants.yaml file
    When ratchet init runs for the project
    Then every invariant the manifest parses as active is "spec-not-weakened" only
    And the mutation invariant is never active in the default manifest, with or without a detected test directory

  Scenario: The scaffolded mutation invariant carries no ratchet-specific toolchain literal
    Given a project with no .ratchet/evals/invariants.yaml file and a conventional test directory
    When ratchet init runs for the project
    Then the manifest text contains no package-manager, test-runner, or build-tool command
    And the mutation invariant's placeholder test command names no single ecosystem's command as if it were universal

  Scenario: The scaffolded mutation invariant loads cleanly through the existing loader
    Given a project with no .ratchet/evals/invariants.yaml file and a conventional test directory
    When ratchet init runs for the project
    Then loading the invariant manifest for the project raises no error
    And the loaded mutation invariant satisfies the mutation schema's test, budget, and threshold fields

  Scenario: Re-running init never overwrites an existing invariant manifest
    Given the project already has a .ratchet/evals/invariants.yaml with user edits to the mutation invariant
    When ratchet init runs again for the project
    Then the existing .ratchet/evals/invariants.yaml is left unchanged
