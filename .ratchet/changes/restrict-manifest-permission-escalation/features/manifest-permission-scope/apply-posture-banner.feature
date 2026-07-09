Feature: batch apply prints the effective posture and its source scope
  As a ratchet operator starting a batch run
  I want every batch apply run to state the effective permission posture and which scope supplied it
  So that the permission story of the run is visible up front instead of buried in config

  Scenario: The posture banner opens every batch apply run
    Given a batch with a ready step
    And a project config whose batch permissions posture is "repo-sandboxed-permissive"
    When "ratchet batch apply" runs
    Then the output begins with a line stating the effective posture "repo-sandboxed-permissive" and its source scope "project"

  Scenario: The banner attributes a manifest-narrowed posture to the manifest
    Given a batch with a ready step
    And a project config whose batch permissions posture is "full-autonomy"
    And a batch manifest whose settings set permissions posture to "repo-sandboxed-permissive"
    When "ratchet batch apply" runs
    Then the posture banner states "repo-sandboxed-permissive" with source scope "manifest"

  Scenario: JSON output suppresses the human banner line
    Given a batch with a ready step
    And a project config whose batch permissions posture is "repo-sandboxed-permissive"
    When "ratchet batch apply" runs with --json
    Then the human banner line is not printed
