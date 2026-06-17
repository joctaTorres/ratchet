Feature: Cached, idempotent bootstrap of the ReX runtime
  As ratchet running many batch steps in a row
  I want the venv built once and reused on subsequent runs
  So that bootstrap cost is paid only on first use or when the cache is missing or stale

  Background:
    Given the ReX runtime bootstrap has already completed successfully once
    And the prepared venv is present in the ratchet-owned cache directory

  Scenario: A second bootstrap reuses the existing venv
    When the ReX runtime bootstrap is invoked again
    Then it does not rebuild the venv or reinstall swe-rex
    And it returns the same resolved launch command quickly

  Scenario: A missing or incomplete venv triggers a rebuild
    Given the cached venv directory has been deleted or its swe-rex marker is absent
    When the ReX runtime bootstrap is invoked
    Then it detects the venv as missing or stale
    And it rebuilds the venv and reinstalls the pinned swe-rex before returning the launch command

  Scenario: Bootstrap is lazy and only runs on first use
    Given ratchet starts but never needs the sidecar
    When no batch step requires the ReX runtime
    Then the bootstrap is not performed and no venv build is triggered
