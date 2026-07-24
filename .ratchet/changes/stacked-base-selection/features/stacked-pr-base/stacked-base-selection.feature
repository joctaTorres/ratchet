Feature: Stacked PR base selection
  As the ratchet batch engine
  I want a pure function that, given the ordered list of PR group boundaries and
  the batch's base branch, computes each group's stacked base — group N bases on
  group N-1's branch, the first group bases on the batch base branch
  So that per-phase and per-change PRs stack correctly, keeping each PR's diff
  scoped to its own unit while dependent code still compiles — computed with no
  filesystem access and no agent spawn

  Background:
    Given the batch's base branch is "main"
    And each group's own branch is named "pr/<groupId>"

  Scenario: the first group bases on the batch base branch
    Given the ordered PR group boundaries have identities "a, b, c"
    When the stacked bases are selected
    Then the base for group 0 "a" is the batch base branch "main"
    And the head branch for group 0 "a" is its own branch "pr/a"

  Scenario: each later group bases on the previous group's branch
    Given the ordered PR group boundaries have identities "a, b, c"
    When the stacked bases are selected
    Then the base for group 1 "b" is the previous group's branch "pr/a"
    And the base for group 2 "c" is the previous group's branch "pr/b"
    And the head branch for group 1 "b" is its own branch "pr/b"
    And the head branch for group 2 "c" is its own branch "pr/c"

  Scenario: the stacked bases preserve the boundary ordering and carry each boundary
    Given the ordered PR group boundaries have identities "a, b, c"
    When the stacked bases are selected
    Then exactly 3 stacked bases are produced in order
    And each stacked base carries its originating boundary
    And the base chain is "main -> pr/a -> pr/b" for groups "a, b, c"

  Scenario: a single group bases on the batch base branch
    Given the ordered PR group boundaries have identities "only"
    When the stacked bases are selected
    Then exactly 1 stacked base is produced
    And the base for group 0 "only" is the batch base branch "main"
    And the head branch for group 0 "only" is its own branch "pr/only"

  Scenario: no boundaries yields no stacked bases
    Given the ordered PR group boundaries are empty
    When the stacked bases are selected
    Then no stacked bases are produced

  Scenario: the group branch naming is supplied, not baked in
    Given the ordered PR group boundaries have identities "a, b"
    And each group's own branch is named "feature/<groupId>"
    When the stacked bases are selected
    Then the head branch for group 0 "a" is its own branch "feature/a"
    And the base for group 1 "b" is the previous group's branch "feature/a"

  Scenario: selection reads only its in-memory inputs
    Given the ordered PR group boundaries have identities "a, b, c"
    When the stacked bases are selected
    Then the result is computed purely from the given boundaries, base branch, and naming
    And no filesystem is read and no agent is spawned
