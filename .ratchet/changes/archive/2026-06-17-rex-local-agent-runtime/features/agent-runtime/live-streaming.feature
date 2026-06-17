Feature: Agent output streams to the terminal line-by-line as it happens
  As a developer running a batch step
  I want the coding agent's output to appear in my terminal as it is produced
  So that I am not left staring at a silent multi-minute wait

  Background:
    Given a batch step whose execution locus is "local"
    And the step is routed through the AgentRuntime seam

  Scenario: Stdout lines reach the terminal incrementally
    Given a stub agent that emits one line of output every second for five seconds
    When the runtime runs the step and forwards each stdout event to an onEvent callback
    Then each line is printed to the terminal as its stdout event arrives
    And the print timestamps are spread across the run, not bunched at the end

  Scenario: The onEvent callback receives a stdout event per line
    Given a runtime driven by a fake sidecar child that emits three stdout lines
    When the runtime runs the step
    Then onEvent is invoked once per line with kind "stdout" and the line text
    And an onEvent invocation with kind "exit" carries the final exit code
