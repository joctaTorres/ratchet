Feature: User, project, and per-change scopes layer with documented precedence
  As a ratchet batch operator
  I want permission policy to resolve across user, project, and per-change scopes
  So that global defaults can be overridden where it matters with predictable semantics

  Background:
    Given a global user permission config under the ratchet user config directory
    And a project permission config under ".ratchet/config.yaml"
    And a per-change permission override in the batch manifest settings

  Scenario: per-change override wins over project and user for a scalar posture
    Given the user config sets posture "curated-allowlist"
    And the project config sets posture "repo-sandboxed-permissive"
    And the per-change manifest sets posture "full-autonomy"
    When the policy is resolved for the run
    Then the effective posture is "full-autonomy"

  Scenario: project overrides user when no per-change override is present
    Given the user config sets posture "full-autonomy"
    And the project config sets posture "repo-sandboxed-permissive"
    And the per-change manifest sets no posture
    When the policy is resolved for the run
    Then the effective posture is "repo-sandboxed-permissive"

  Scenario: user config applies when neither project nor change override it
    Given the user config sets posture "curated-allowlist"
    And the project config sets no posture
    And the per-change manifest sets no posture
    When the policy is resolved for the run
    Then the effective posture is "curated-allowlist"

  Scenario: deny lists union across scopes while allow lists are replaced by the nearest scope
    Given the user config denies tool pattern "A"
    And the project config denies tool pattern "B"
    And the project config allows tool patterns "X" and "Y"
    And the per-change manifest allows tool pattern "Z"
    When the policy is resolved for the run
    Then the effective deny list contains both "A" and "B"
    And the effective allow list contains only "Z"

  Scenario: no config at any scope yields the built-in default posture
    Given no permission config exists at user, project, or change scope
    When the policy is resolved for the run
    Then the effective posture is "repo-sandboxed-permissive"
