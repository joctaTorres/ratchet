Feature: Abstracted posture translates to each agent's permission flags
  As a ratchet batch operator
  I want one agent-agnostic permission posture
  So that I configure intent once and ratchet maps it to whichever coding agent drives the run

  Background:
    Given a batch run that spawns a headless coding agent
    And an agent-permissions policy resolved to a single posture

  Scenario: repo-sandboxed-permissive maps to Claude flags
    Given the resolved posture is "repo-sandboxed-permissive"
    And the configured agent is "claude"
    When the engine builds the agent spawn request
    Then the claude argv includes "--permission-mode" with value "acceptEdits"
    And the claude argv includes "--add-dir" scoping access to the repo root
    And the claude argv includes "--disallowedTools" denying out-of-repo and destructive Bash operations
    And the claude argv still includes the base flags "-p --output-format stream-json --verbose --include-partial-messages"

  Scenario: full-autonomy maps to Claude skip-permissions flag
    Given the resolved posture is "full-autonomy"
    And the configured agent is "claude"
    When the engine builds the agent spawn request
    Then the claude argv includes "--dangerously-skip-permissions"

  Scenario: curated-allowlist maps to Claude allow and deny lists
    Given the resolved posture is "curated-allowlist"
    And the policy lists allowed tools and denied tools
    And the configured agent is "claude"
    When the engine builds the agent spawn request
    Then the claude argv includes "--allowedTools" with the configured allow list
    And the claude argv includes "--disallowedTools" with the configured deny list
    And the claude argv does NOT include "--dangerously-skip-permissions"

  Scenario Outline: each agent receives its own native permission flags
    Given the resolved posture is "<posture>"
    And the configured agent is "<agent>"
    When the engine builds the agent spawn request
    Then the agent argv includes the flag "<flag>"

    Examples:
      | agent  | posture                    | flag              |
      | claude | repo-sandboxed-permissive  | --permission-mode |
      | gemini | repo-sandboxed-permissive  | --approval-mode   |
      | gemini | full-autonomy              | --yolo            |
      | codex  | repo-sandboxed-permissive  | --sandbox         |
      | codex  | full-autonomy              | --full-auto       |
