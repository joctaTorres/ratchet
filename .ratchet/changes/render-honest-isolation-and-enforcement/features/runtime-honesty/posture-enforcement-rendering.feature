Feature: posture is never displayed bare — enforcement status and source are rendered
  As an operator reading batch settings
  I want the resolved posture shown with per-agent enforcement status and its source scope
  So that an unenforced posture or a repo-controlled escalation is never presented as a guarantee

  Scenario: an argv-enforced agent renders as enforced via flags
    Given a project whose resolved batch agent is "claude"
    And the resolved posture is "repo-sandboxed-permissive"
    When I run `ratchet batch config`
    Then the permissions block renders "claude: enforced via flags"

  Scenario: an agent whose posture maps to no argv flags renders as NOT ENFORCED
    Given a project whose resolved batch agent is "cursor"
    And the resolved posture is "repo-sandboxed-permissive"
    When I run `ratchet batch config`
    Then the permissions block renders "cursor: NOT ENFORCED — agent defaults apply"

  Scenario: enforcement status is derived from the real permission translator
    Given the per-agent permission translator maps a posture to an empty argv fragment for an agent
    When the enforcement status for that agent and posture is resolved
    Then it reports the posture as not enforced for that agent
    And an agent whose mapping emits posture flags reports as enforced

  Scenario: a manifest-sourced posture names its source scope
    Given a batch manifest that sets `permissions.posture: full-autonomy`
    And manifest escalation is allowed for the run
    When I run `ratchet batch config <batch>`
    Then the posture renders as "full-autonomy" annotated with "set by batch manifest — repo-controlled"

  Scenario: stage-mapped agents each get their own enforcement line
    Given a project whose batch agent is a per-stage map resolving to "claude" and "cursor"
    When I run `ratchet batch config`
    Then the permissions block renders one enforcement line per distinct resolved agent

  Scenario: JSON output carries per-agent enforcement machine-readably
    Given a project whose resolved batch agent is "cursor"
    When I run `ratchet batch config --json`
    Then the JSON payload includes an enforcement entry marking the posture as not enforced for "cursor"
