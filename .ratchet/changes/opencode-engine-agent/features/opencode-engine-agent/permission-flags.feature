Feature: OpenCode permission posture translation
  As a ratchet batch operator
  I want one agent-agnostic permission posture mapped to opencode's native flags
  So that I configure intent once and ratchet maps it to opencode

  Background:
    Given a batch run that spawns a headless opencode agent
    And an agent-permissions policy resolved to a single posture
    And the per-agent raw override escape hatch recognizes opencode

  Scenario: full-autonomy maps to opencode skip-permissions flag
    Given the resolved posture is "full-autonomy"
    And the configured agent is "opencode"
    When the engine builds the agent spawn request
    Then the opencode argv includes "--dangerously-skip-permissions"
    And the argv still begins with "run" "--format" "json"

  Scenario: repo-sandboxed-permissive is best-effort for opencode
    Given the resolved posture is "repo-sandboxed-permissive"
    And the configured agent is "opencode"
    When the engine builds the agent spawn request
    Then the opencode argv does NOT include "--dangerously-skip-permissions"
    And a one-time warning is emitted that the sandboxed posture is bounded only by opencode's own default gating

  Scenario: curated-allowlist is best-effort for opencode
    Given the resolved posture is "curated-allowlist"
    And the configured agent is "opencode"
    When the engine builds the agent spawn request
    Then the opencode argv does NOT include "--dangerously-skip-permissions"

  Scenario: The raw override escape hatch recognizes opencode
    Given a resolved policy with a raw.opencode argv fragment
    And the configured agent is "opencode"
    When the engine builds the agent spawn request
    Then the raw.opencode fragment is appended to the opencode argv
    And raw fragments targeting other agents are ignored
