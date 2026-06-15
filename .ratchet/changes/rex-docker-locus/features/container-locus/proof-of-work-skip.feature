Feature: The docker-locus proof-of-work skips explicitly when Docker is absent
  As a maintainer running the phase gate on a machine without Docker
  I want the proof-of-work to SKIP loudly rather than silently pass or hang
  So that the gate is honest about what was and was not verified

  Scenario: Docker absent — explicit SKIP, never a silent pass
    Given the proof-of-work script test/e2e/rex-docker-locus.sh is run
    And no Docker daemon is available on the machine
    When the script checks its prerequisites
    Then it prints a clear SKIP message naming Docker as the missing prerequisite
    And it exits 0 without claiming the in-container behavior was verified

  Scenario: Docker present — the container plumbing is proven with a stub and generic image
    Given the proof-of-work script test/e2e/rex-docker-locus.sh is run
    And a Docker daemon is available
    And a generic small image is pulled (no agent provisioning required)
    When the script drives a step through the docker locus with a stub agent
    Then the in-container marker is observed in the streamed output
    And the streamed lines arrive incrementally
    And the captured exit code matches the stub's exit status
    And the script exits 0 to satisfy the phase gate
