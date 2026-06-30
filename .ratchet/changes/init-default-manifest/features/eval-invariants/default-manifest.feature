Feature: Default invariant manifest scaffolded by ratchet init
  As a project owner running ratchet init for the first time
  I want a starter .ratchet/evals/invariants.yaml with one real, tool-agnostic
  invariant turned on and the stack-specific invariants scaffolded but inert
  So that the anti-gaming gate is real out of the box, never an active check
  that does not actually check anything

  # This is the init-scaffolding slice of the invariant set: the manifest
  # schema, evaluator, and contributor wiring are already shipped (downstream
  # of this change in the dependency order) and gate over whatever manifest
  # exists. This slice is the one place that writes the manifest in the first
  # place, on `ratchet init`, for a project that has none yet.

  Scenario: A fresh init activates the one invariant ratchet can always evaluate
    Given a project with no .ratchet/evals/invariants.yaml file
    When ratchet init runs for the project
    Then .ratchet/evals/invariants.yaml is created
    And the manifest declares "spec-not-weakened" as kind "monotonic" and active
    And "spec-not-weakened" tracks the "scenario-count" measure

  Scenario: A detected test directory scaffolds a live, inert tests-still-exist check
    Given a project with no .ratchet/evals/invariants.yaml file and a conventional test directory
    When ratchet init runs for the project
    Then the manifest declares "tests-still-exist" as kind "deterministic" and inert
    And the "tests-still-exist" check command tests for the detected directory
    And the entry is uncommented YAML ready to flip to active

  Scenario: No detectable test directory scaffolds a commented placeholder instead
    Given a project with no .ratchet/evals/invariants.yaml file and no conventional test directory
    When ratchet init runs for the project
    Then the manifest contains a commented "tests-still-exist" placeholder
    And no live "tests-still-exist" invariant is parsed from the manifest

  Scenario: public-api-unchanged is always a commented per-stack placeholder
    Given a project with no .ratchet/evals/invariants.yaml file
    When ratchet init runs for the project
    Then the manifest contains a commented "public-api-unchanged" placeholder
    And no live "public-api-unchanged" invariant is parsed from the manifest
    And the placeholder names no single ecosystem's command as if it were universal

  Scenario: The scaffolded manifest is never active-but-vacuous
    Given a project with no .ratchet/evals/invariants.yaml file
    When ratchet init runs for the project
    Then every invariant the manifest parses as active is "spec-not-weakened" only
    And neither "tests-still-exist" nor "public-api-unchanged" is ever active in the default manifest

  Scenario: The scaffolded manifest carries no ratchet-specific toolchain literal
    Given a project with no .ratchet/evals/invariants.yaml file
    When ratchet init runs for the project
    Then the manifest text contains no package-manager, test-runner, or build-tool command
    And the only check commands present are stack-agnostic directory predicates

  Scenario: The scaffolded manifest loads cleanly through the existing loader
    Given a project with no .ratchet/evals/invariants.yaml file
    When ratchet init runs for the project
    Then loading the invariant manifest for the project raises no error
    And the loaded set contains exactly the active invariants the manifest declares

  Scenario: Re-running init never overwrites an existing invariant manifest
    Given the project already has a .ratchet/evals/invariants.yaml with user edits
    When ratchet init runs again for the project
    Then the existing .ratchet/evals/invariants.yaml is left unchanged
