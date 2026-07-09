Feature: Manifest posture escalation requires an explicit opt-in flag
  As a ratchet operator who deliberately wants a manifest-raised posture
  I want an explicit --allow-manifest-escalation flag on batch apply
  So that raising the posture from the repo-controlled manifest is a per-invocation operator decision, never a silent default in headless runs

  Scenario: batch apply honors the manifest raise only with --allow-manifest-escalation
    Given a project config whose batch permissions posture is "repo-sandboxed-permissive"
    And a batch manifest whose settings set permissions posture to "full-autonomy"
    When the batch settings are resolved with manifest escalation allowed
    Then the effective posture is "full-autonomy"
    And the posture source is "manifest"

  Scenario: Headless batch apply without the flag refuses the escalation and says how to opt in
    Given a project config whose batch permissions posture is "repo-sandboxed-permissive"
    And a batch manifest whose settings set permissions posture to "full-autonomy"
    When "ratchet batch apply" runs without the --allow-manifest-escalation flag
    Then the run proceeds under the "repo-sandboxed-permissive" posture
    And the output warns that the manifest requested "full-autonomy" and was refused
    And the warning names the --allow-manifest-escalation flag and the operator-owned config scopes as the ways to raise the posture

  Scenario: The opt-in flag changes nothing when the manifest does not raise the posture
    Given a project config whose batch permissions posture is "repo-sandboxed-permissive"
    And a batch manifest that sets no permissions posture
    When the batch settings are resolved with manifest escalation allowed
    Then the effective posture is "repo-sandboxed-permissive"
    And the posture source is "project"
