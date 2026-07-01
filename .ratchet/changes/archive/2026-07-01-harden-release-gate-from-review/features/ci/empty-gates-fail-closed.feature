Feature: Empty gate set fails closed in the release decision
  As a maintainer of the ratchet release pipeline
  I want an empty wired-gate set to DENY a release
  So that the "only when green" guarantee can never be silently opened by a build with no proving gates

  Scenario: Denies on main when the wired gate set is empty
    Given the current branch is "main"
    And the wired gate set is empty
    When I ask the module whether a release is allowed
    Then the decision is DENY
    And the reasons include that there are no wired gates

  Scenario: Still allows on a green main build with a non-empty gate set
    Given the current branch is "main"
    And the "lint" gate is green
    And the "test" gate is green
    When I ask the module whether a release is allowed
    Then the decision is ALLOW
    And there are no denial reasons

  Scenario: The release-gate runner guards that its wired gate set is non-empty
    Given the release-gate runner is configured with its wired gate set
    When the runner builds the gate signals for the decision
    Then the wired gate set is non-empty
    And a future refactor that empties it fails loudly rather than opening the gate
