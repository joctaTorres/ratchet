Feature: doctor nudges toward the docker locus for permissive local runs
  As an operator relying on ratchet doctor
  I want a check that flags batches running on the local locus with a permissive or full-autonomy posture
  So that I am pointed at the docker locus when my configuration has no real containment

  Scenario: full-autonomy on the local locus warns and names the docker locus
    Given a project whose resolved batch locus is "local" and posture is "full-autonomy"
    When I run `ratchet doctor`
    Then the report includes a batch-isolation check with a warning status
    And its remedy nudges toward `locus: docker` for real containment

  Scenario: the default permissive posture on the local locus gets an advisory nudge
    Given a project whose resolved batch locus is "local" and posture is "repo-sandboxed-permissive"
    When I run `ratchet doctor`
    Then the report includes a batch-isolation check noting the posture is advisory on local
    And the check is informational, not a failure

  Scenario: the docker locus does not trigger the nudge
    Given a project whose resolved batch locus is "docker"
    When I run `ratchet doctor`
    Then the batch-isolation check passes or is absent

  Scenario: the nudge never fails doctor
    Given a project whose resolved batch locus is "local" and posture is "full-autonomy"
    And every required doctor check passes
    When I run `ratchet doctor`
    Then the process exits with code 0
