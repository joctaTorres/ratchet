Feature: Halts, approvals, and hard failures
  As a ratchet user
  I want the orchestrator to surface decisions and failures to me
  So that I stay in control while it drives the batch autonomously between halts

  Background:
    Given a batch named "q3-auth" is being driven by /rct:apply-batch

  Scenario: A blocker halts the loop and is relayed to the user
    Given a change in the batch reports a blocker requiring a decision
    When "ratchet batch apply q3-auth" returns a blocked / awaiting-input outcome
    Then the orchestrator stops looping
    And it surfaces to the user exactly what input or decision is required
    And it does not cross the halt without recorded input

  Scenario: The user's answer is recorded and the loop resumes
    Given the orchestrator has surfaced a blocker to the user
    When the user provides an answer
    Then the orchestrator records it via "ratchet batch report q3-auth --change <change> --answer ..."
    And it resumes the loop by invoking "ratchet batch apply q3-auth" again

  Scenario: An awaiting-approval gate is relayed for approval
    Given a phase gate is configured to require approval
    When apply returns an awaiting-approval halt
    Then the orchestrator presents the gate result to the user for approval
    And it resumes only after the user approves

  Scenario: A proof-of-work hard-gate failure stops the orchestrator
    Given a phase has a proof-of-work hard gate that fails
    When "ratchet batch apply q3-auth" returns a failed outcome
    Then the orchestrator stops
    And it surfaces the failure clearly to the user
    And it does not paper over the failure or retry blindly
