Feature: `ratchet propose "<objective>"` creates one change headlessly
  As a developer who wants a change without driving a batch
  I want a first-class `ratchet propose` verb that takes a free-text objective
  And derives a change name (or honours an explicit --name)
  So that I can spin up a single change from the CLI with no batch manifest,
  the same way `ratchet batch apply` advances a change but scoped to one verb

  Background:
    Given a project with no batch manifest selected
    And an injected agent runtime so no real agent is spawned

  Scenario: The change name is derived from the objective
    Given no change directory exists yet
    When I run `ratchet propose "Add a doctor command"`
    Then the derived change name is a kebab-case slug of the objective
    And the change is proposed under ".ratchet/changes/<derived-name>/"
    And exactly one agent is spawned for the propose transition

  Scenario: --name overrides the derived change name
    Given no change directory exists yet
    When I run `ratchet propose "Add a doctor command" --name doctor-cmd`
    Then the change name is the explicit "doctor-cmd", not the derived slug
    And exactly one agent is spawned for change "doctor-cmd"

  Scenario: Proposing refuses when the change already exists
    Given a change directory ".ratchet/changes/doctor-cmd/" already exists
    When I run `ratchet propose "Add a doctor command" --name doctor-cmd`
    Then the command fails with an actionable error that the change already exists
    And no agent is spawned

  Scenario: A blank or unsluggable objective is rejected before spawning
    Given no --name is provided
    When I run `ratchet propose "   "`
    Then the command fails asking for a non-empty objective or an explicit --name
    And no agent is spawned
