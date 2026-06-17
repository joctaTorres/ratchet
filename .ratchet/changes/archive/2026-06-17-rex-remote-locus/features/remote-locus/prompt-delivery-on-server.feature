Feature: Prompt delivery writes the prompt onto the server filesystem
  As the remote runtime driving an agent on another machine
  I want the prompt to live on the server, not the host
  So that "cat prompt | agent" works where the agent actually runs

  Scenario: The prompt is written to the server before the agent launches
    Given a step with instructions to pass to the agent on stdin
    When the RexRemoteRuntime prepares the run
    Then it writes the instructions to a file on the server via POST /write_file
    And it launches the agent as "cat <serverPromptPath> | <agent argv>" via /execute
    And the prompt path it cats is the server-side path, never the host path

  Scenario: Local and docker loci are unaffected by the remote path
    Given a project configured with locus "local"
    When the engine selects a runtime
    Then it selects the existing ReX sidecar runtime, not the remote runtime
    And no /write_file or /execute REST calls are made
    When a project is configured with locus "docker"
    Then the engine still selects the ReX sidecar runtime with the docker locus
    And the remote runtime is used only when locus is "remote"
