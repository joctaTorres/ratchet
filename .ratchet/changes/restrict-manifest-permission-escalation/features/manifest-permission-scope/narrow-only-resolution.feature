Feature: Manifest permission scope can only narrow, never escalate
  As a ratchet operator running a batch in a cloned repository
  I want the repo-committed manifest to only narrow the permission policy
  So that a batch.yaml I did not author can never silently raise the agent posture above what my own config allows

  Scenario: Committed manifest full-autonomy cannot silently escalate over project scope
    Given a project config whose batch permissions posture is "repo-sandboxed-permissive"
    And a batch manifest whose settings set permissions posture to "full-autonomy"
    When the batch settings are resolved without manifest escalation allowed
    Then the effective posture is "repo-sandboxed-permissive"
    And the posture source is "project"
    And the resolution reports the manifest's suppressed escalation request for "full-autonomy"

  Scenario: Manifest cannot raise posture above the built-in default when no operator scope sets one
    Given no user or project config sets a batch permissions posture
    And a batch manifest whose settings set permissions posture to "full-autonomy"
    When the batch settings are resolved without manifest escalation allowed
    Then the effective posture is "repo-sandboxed-permissive"
    And the posture source is "default"

  Scenario: Manifest may lower the posture below the operator scope
    Given a project config whose batch permissions posture is "full-autonomy"
    And a batch manifest whose settings set permissions posture to "repo-sandboxed-permissive"
    When the batch settings are resolved without manifest escalation allowed
    Then the effective posture is "repo-sandboxed-permissive"
    And the posture source is "manifest"

  Scenario: Manifest deny additions still union while its posture raise is suppressed
    Given a project config whose batch permissions posture is "repo-sandboxed-permissive" with deny pattern "Bash(rm -rf*)"
    And a batch manifest that sets permissions posture to "full-autonomy" and adds deny pattern "Bash(git push*)"
    When the batch settings are resolved without manifest escalation allowed
    Then the effective posture is "repo-sandboxed-permissive"
    And the effective deny list contains both "Bash(rm -rf*)" and "Bash(git push*)"

  Scenario: Operator-owned scopes may still raise the posture
    Given a user config whose batch permissions posture is "repo-sandboxed-permissive"
    And a project config whose batch permissions posture is "full-autonomy"
    And a batch manifest that sets no permissions posture
    When the batch settings are resolved without manifest escalation allowed
    Then the effective posture is "full-autonomy"
    And the posture source is "project"
