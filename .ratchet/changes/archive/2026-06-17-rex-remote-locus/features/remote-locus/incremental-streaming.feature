Feature: Output streams incrementally over REST and the exit code is captured
  As a user watching a remote step run
  I want the agent's output to appear live as it is produced on the server
  So that I get the same real-time view as the local and docker loci

  Background:
    Given a reachable swerex-remote server
    And a step running on the RexRemoteRuntime

  Scenario: New output is emitted incrementally as stdout events
    Given a stub agent that prints one line per second to a server-side logfile
    When the runtime tail-polls the logfile via repeated POST /execute calls
    And each poll reads only the bytes after the last byte offset it consumed
    Then each newly produced line is forwarded as an AgentEvent of kind "stdout"
    And the events arrive spread across the run, not bunched at the end
    And every streamed line is also accumulated into the returned transcript

  Scenario: The exit code is captured from a server-side sentinel
    Given the agent command writes its exit status to a sentinel after the agent exits
    When the runtime reads the exit-code sentinel from the server
    Then it emits an AgentEvent of kind "exit" carrying that exit code
    And the resolved AgentSpawnResult exitCode equals the agent's real exit code
    And the session is closed via POST /close_session and the runtime via POST /close

  Scenario: Rich stream-json rendering comes for free over remote
    Given the resolved adapter emits stream-json NDJSON
    When the RexRemoteRuntime forwards each line as a stdout AgentEvent
    Then the engine routes those events through the existing stream-json renderer
    And the remote run shows the same polished live view as local and docker
    And the renderer is not forked or modified for the remote path
