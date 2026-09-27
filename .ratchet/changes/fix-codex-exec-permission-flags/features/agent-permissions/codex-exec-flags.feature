Feature: Codex permission flags are accepted by `codex exec`
  As a ratchet batch operator whose apply agent is codex
  I want every permission posture to emit only options that `codex exec` accepts
  So that the codex agent actually starts instead of dying on an argv rejection

  Background:
    Given a batch run that spawns the "codex" agent via "codex exec -"
    And the permission flags are appended after the "exec" subcommand

  Scenario: repo-sandboxed-permissive sets approvals off through a config override
    Given the resolved posture is "repo-sandboxed-permissive"
    When the engine builds the codex spawn request
    Then the codex argv includes "--sandbox" with value "workspace-write"
    And the codex argv includes "-c" with value "approval_policy=never"
    And the codex argv does NOT include "--ask-for-approval"

  Scenario: curated-allowlist keeps the workspace sandbox with on-request approvals
    Given the resolved posture is "curated-allowlist"
    When the engine builds the codex spawn request
    Then the codex argv includes "--sandbox" with value "workspace-write"
    And the codex argv includes "-c" with value "approval_policy=on-request"
    And the codex argv does NOT include "--ask-for-approval"

  Scenario: full-autonomy bypasses approvals and the sandbox
    Given the resolved posture is "full-autonomy"
    When the engine builds the codex spawn request
    Then the codex argv is exactly "--dangerously-bypass-approvals-and-sandbox"
    And the codex argv does NOT include "--full-auto"

  Scenario Outline: the installed codex CLI parses every posture's flags
    Given the "codex" binary is on PATH
    And the resolved posture is "<posture>"
    When "codex exec" is invoked with that posture's permission flags and "--help"
    Then the process exits with code 0

    Examples:
      | posture                   |
      | repo-sandboxed-permissive |
      | curated-allowlist         |
      | full-autonomy             |

  Scenario: the CLI-compatibility check is skipped when codex is absent
    Given the "codex" binary is NOT on PATH
    When the codex CLI-compatibility test runs
    Then it is skipped rather than failed
