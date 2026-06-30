Feature: change-status-policy is proven by unit tests
  As a maintainer holding ratchet to the testing standard
  I want the pure policy functions in src/core/change-status-policy.ts under unit test
  So that planning-home summaries, the repo-local action context, and the
    next-step guidance are pinned to their contract

  Background:
    Given the policy functions are deterministic over in-memory inputs
    And the unit tests touch no filesystem and spawn no process

  Scenario: summarizePlanningHome projects the public summary fields
    Given a planning home with kind, root, changesDir, and defaultSchema
    When summarizePlanningHome runs
    Then it returns a summary carrying exactly those fields

  Scenario: summarizePlanningHome passes undefined through
    Given no planning home
    When summarizePlanningHome runs
    Then it returns undefined

  Scenario: summarizeAffectedAreas is always undefined for repo-local planning
    Given any affected-areas input
    When summarizeAffectedAreas runs
    Then it returns undefined

  Scenario: buildActionContext produces the repo-local context
    Given a project root and a list of artifact ids
    When buildActionContext runs
    Then the context is repo-local with the artifact ids as planning artifacts
    And the project root is the only allowed edit root
    And it requires no affected-area selection and carries the repo-local constraint

  Scenario: buildNextSteps points at the first ready artifact
    Given artifact statuses where one artifact is ready
    When buildNextSteps runs
    Then it returns a single step instructing to run instructions for that ready artifact

  Scenario: buildNextSteps reports completion when all artifacts are complete
    Given artifact statuses with none ready and allArtifactsComplete true
    When buildNextSteps runs
    Then it returns the all-complete review step

  Scenario: buildNextSteps returns no steps when nothing is ready and work remains
    Given artifact statuses with none ready and allArtifactsComplete false
    When buildNextSteps runs
    Then it returns an empty list
