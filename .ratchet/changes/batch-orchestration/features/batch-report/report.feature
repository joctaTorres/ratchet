Feature: Agent reporting and voluntary halt channel
  As a coding agent driving a step
  I want a CLI channel to report progress, raise blockers, and request input
  So that I can halt for alignment and the engine can resume me with an answer

  Scenario: An agent reports routine progress
    Given an active batch step for change "add-login-api"
    When the agent runs "ratchet batch report --change add-login-api --status 'drafted 2 of 4 scenarios'"
    Then the progress is recorded on the run journal
    And the message appears in the batch view for that step

  Scenario: A propose agent voluntarily halts for alignment
    Given the resolved gate is "voluntary"
    And a propose agent finds the intent too ambiguous to draft a sound plan
    When the agent runs "ratchet batch report --change add-login-api --blocker 'cookie or header sessions? changes the whole API surface'"
    Then the step is parked as blocked with that question
    And the change is not advanced to apply
    And the question surfaces in the batch view and triggers a notification

  Scenario: The user answers a blocker and the step resumes
    Given a step parked as blocked with a question
    When the user records an answer for that blocker
    Then the next "ratchet batch apply" re-spawns the agent with the question and answer in context

  Scenario: An agent signals it produced a proposal awaiting approval
    Given the resolved gate is "after-propose"
    When a propose agent finishes and reports completion
    Then the step is parked as awaiting-approval
    And the user can approve or reject-with-feedback from the batch view

  Scenario: Reject-with-feedback re-runs propose without rolling back the phase
    Given a step parked as awaiting-approval
    When the user rejects it with feedback
    Then the next apply re-runs propose with the prior draft and the feedback in context
    And no other phase or change is rolled back

  Scenario: The report channel works for any agent that can run a shell command
    Given the configured agent adapter
    When the agent needs to report
    Then reporting requires only invoking the "ratchet batch report" command
    And no interactive prompt inside the agent session is required
