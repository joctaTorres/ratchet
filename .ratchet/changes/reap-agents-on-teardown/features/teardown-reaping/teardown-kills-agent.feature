Feature: Teardown reaps the agent on every exit path
  As a batch operator
  I want timeout, error, and clean-shutdown teardown to kill the agent's process group
  So that no nohup'd, dockerized, or remote agent survives its run

  Scenario: Sidecar overall timeout shuts down then force-kills
    Given a sidecar run that exceeds the overall timeout
    When the Node runtime tears the child down
    Then it sends the shutdown op to the sidecar first
    And after a short grace window it SIGKILLs the sidecar's process group
    And the run resolves with a non-zero exit code and a timeout message in stderr

  Scenario: Sidecar shutdown kills the in-flight agent process group
    Given the Python sidecar is streaming an agent it launched detached
    When the sidecar handles a shutdown op
    Then it kills the recorded agent process group before stopping the deployment
    And it removes the run's log, done, and pid files

  Scenario: Python sidecar SIGTERM handler stops the deployment
    Given the Python sidecar is running with an active deployment
    When the sidecar process receives SIGTERM
    Then it stops the deployment so no docker container is orphaned
    And it exits instead of leaving the agent running

  Scenario: Remote teardown kills the launched agent before closing the session
    Given a remote run that ends by timeout, error, or completion
    When the remote runtime tears the session down
    Then it kills the process group recorded in the runDir pidfile
    And it removes the server run directory before closing the session and runtime

  Scenario: realSpawner enforces a timeout with SIGTERM then SIGKILL
    Given the in-process spawner runs an agent with a timeout configured
    When the agent is still running at the deadline
    Then the spawner SIGTERMs the agent's process group
    And escalates to SIGKILL after a grace window
    And resolves with a timeout message in stderr instead of hanging
