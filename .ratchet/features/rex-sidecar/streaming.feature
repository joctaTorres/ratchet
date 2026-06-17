Feature: Incremental streaming of a slow command via the sidecar
  As the batch engine that must show agent output as it happens
  I want the sidecar to stream a long-running command's stdout line-by-line
  So that the silent-multi-minute wait is gone even though ReX is request/response

  Background:
    Given a bootstrapped sidecar that has emitted "ready"
    And a working directory the sidecar can write a run log into

  Scenario: A slow command streams stdout lines incrementally
    Given a command that prints five lines roughly one second apart
    When the Node side sends {"op":"run","id":1,"command":"<the slow command>"}
    Then the sidecar launches the command to a logfile and tail-polls it about every 300ms via ReX execute()
    And it emits {"event":"stdout","id":1,"line":"..."} for each line as it appears
    And the stdout events arrive spread out over time rather than bunched at the end

  Scenario: The command's exit code is reported when it finishes
    Given a running command launched via the "run" op with id 1
    When the command completes
    Then the sidecar emits {"event":"exit","id":1,"exit_code":<code>} exactly once for that id
    And no further stdout events are emitted for id 1 afterwards

  Scenario: Streaming uses execute() rather than a persistent session run
    Given the sidecar is streaming a command
    When the sidecar produces the command's incremental output
    Then it drives output by polling with ReX execute() against a logfile
    And it never calls run_in_session() for streaming, because pexpect is brittle on macOS
    And it never runs "exit" inside the session, which would EOF the shell
