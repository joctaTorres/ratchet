Feature: Agents launch in their own process group with a recorded pid
  As a batch operator
  I want every spawned agent to run as a process-group leader whose pid is recorded
  So that teardown can kill the whole agent tree instead of orphaning it

  Scenario: Sidecar launcher starts the agent as a process-group leader
    Given the ReX sidecar receives a run op for an agent command
    When the sidecar builds the detached launcher
    Then the launcher enables job control so the backgrounded agent becomes its own process-group leader
    And the launcher records the agent's pid to a pidfile in the run directory before the agent pipeline starts

  Scenario: Remote runtime launcher records the launched pid in a runDir pidfile
    Given the remote runtime launches an agent on a swerex-remote server
    When the non-blocking launch command is issued
    Then the launch enables job control so the backgrounded agent becomes its own process-group leader
    And the launched process id is written to a pidfile under the server run directory

  Scenario: realSpawner starts the agent detached as a process-group leader
    Given the in-process spawner runs an agent binary directly
    When the child process is spawned on a POSIX platform
    Then the child is spawned detached so it leads its own process group
