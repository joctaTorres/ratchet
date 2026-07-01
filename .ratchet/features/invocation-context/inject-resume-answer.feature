Feature: A resume answer is injected as an argument to the skill invocation
  As the batch engine resuming a previously parked change-verb step
  I want the resolved resume answer (a blocker's answer, or a rejected
  proposal's feedback) handed to the skill AS ARGUMENTS of the
  `/rct:<transition> <change>` invocation
  So that resuming through skill delegation does not drop the answer the CLI
  already resolved (delegated-lifecycle: delegation injects "any `-m` guidance
  or resume answer" alongside the invocation, never a bare call).

  # PRIOR STATE: `resumeGuidance` renders the blocker answer / rejection feedback
  # as a SEPARATE block disconnected from the invocation. This change weaves the
  # resume answer INTO the invocation as arguments so the skill receives it.
  Background:
    Given a change-verb step context resolved by the engine for change
      "add-login-api" with definition of done
      "the login endpoint authenticates a user"

  Scenario: a blocker answer is injected as an invocation argument on resume
    Given the step was parked on a blocker
      "which auth scheme?" answered "use bearer tokens"
    And a forced transition of "apply"
    When the engine builds the agent instructions
    Then the prompt invokes "/rct:apply add-login-api"
    And the resume answer "use bearer tokens" is attached to that invocation as an
      argument the skill consumes, so the skill resumes with the answer in hand
    And the prompt is not reduced to only the "/rct:apply add-login-api" line

  Scenario: a rejected-proposal feedback is injected on a propose re-run
    Given the prior proposal was REJECTED with feedback
      "the slice is too broad — narrow it to the deny path"
    And a forced transition of "propose"
    When the engine builds the agent instructions
    Then the prompt invokes "/rct:propose add-login-api"
    And the rejection feedback is attached to that invocation as an argument, so
      the skill revises the existing draft rather than starting over

  # Both caller guidance and a resume answer can be present at once; both are
  # injected alongside the single invocation — neither is dropped.
  Scenario: caller guidance and a resume answer are both injected together
    Given the caller supplied `-m` guidance "keep the public API unchanged"
    And the step was parked on a blocker
      "which auth scheme?" answered "use bearer tokens"
    And a forced transition of "apply"
    When the engine builds the agent instructions
    Then the prompt invokes "/rct:apply add-login-api"
    And both the caller guidance and the resume answer are attached to that
      invocation as arguments the skill consumes

  Scenario: no resume context leaves the invocation clean
    Given the step is not resuming from any parked state
    And the caller supplied no `-m` guidance
    And a forced transition of "apply"
    When the engine builds the agent instructions
    Then the prompt invokes "/rct:apply add-login-api" with no injected resume
      argument trailing the change name
