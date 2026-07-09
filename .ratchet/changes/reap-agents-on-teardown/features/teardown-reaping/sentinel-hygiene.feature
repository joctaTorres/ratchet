Feature: Run sentinels live under the batch run directory and are swept on teardown
  As a ratchet user
  I want per-run log/done/pid sentinel files scoped to the batch run directory
  So that timed-out runs never litter my repository root

  Scenario: Sidecar sentinels are written under the batch run directory
    Given the Node runtime passes the run directory to the sidecar in the run op
    When the sidecar launches the agent detached
    Then the ratchet-rex log and done sentinels are created inside that run directory
    And no sentinel file is created at the workdir root

  Scenario: Docker locus receives the in-container run directory path
    Given a sidecar run under the docker locus
    When the Node runtime builds the run op
    Then the run directory it passes is translated onto the in-container bind mount

  Scenario: Teardown sweeps the run directory on timeout
    Given a sidecar run that ends by overall timeout
    When the Node runtime finishes the run
    Then the run directory including prompt, log, done, and pid files is removed
    And no sentinel files remain anywhere under the project root
