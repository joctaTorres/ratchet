Feature: The caller's `-m` guidance is injected as an argument to the skill invocation
  As the batch engine delegating a transition to the canonical rct skill
  I want the caller's `-m` guidance handed to the skill AS ARGUMENTS of the
  `/rct:<transition> <change>` invocation — not rendered as a detached prose
  block the skill has no contract to read
  So that delegation stays context-preserving (delegated-lifecycle: "it hands
  that context to the skill as arguments, rather than reducing the step to a
  bare, context-free skill call").

  # PRIOR STATE (delegate-change-verb-prompt): buildAgentInstructions already
  # emits `/rct:<transition> <change>` and keeps the phase goal/success/proof-of-
  # work + per-change definition of done in the prompt's top block. But the
  # caller's `-m` guidance is rendered by `additionalGuidance` as a SEPARATE
  # "Additional guidance:" section, disconnected from the invocation. This change
  # weaves that guidance INTO the invocation so the skill receives it as input.
  Background:
    Given a change-verb step context resolved by the engine for change
      "add-login-api" with definition of done
      "the login endpoint authenticates a user"

  Scenario: caller guidance travels with the invocation as an argument
    Given the caller supplied `-m` guidance "focus the slice on the deny path"
    And a forced transition of "apply"
    When the engine builds the agent instructions
    Then the prompt invokes "/rct:apply add-login-api"
    And the caller guidance "focus the slice on the deny path" is attached to that
      invocation as an argument the skill consumes (not a detached prose block
      separated from the `/rct:apply add-login-api` call)

  Scenario: the invocation is never reduced to a bare, context-free call
    Given the caller supplied `-m` guidance "focus the slice on the deny path"
    And any forced transition
    When the engine builds the agent instructions
    Then the prompt is not reduced to only the "/rct:<transition> <change>" line
    And the resolved phase goal, phase success, phase proof-of-work, and the
      per-change "Definition of done:" line are still present alongside the
      invocation and its injected arguments

  # The plain batch apply path supplies no `-m` guidance. Injecting nothing must
  # not pollute the invocation: it stays the clean `/rct:<transition> <change>`
  # call with no trailing empty-argument noise.
  Scenario: no guidance supplied leaves the invocation clean
    Given the caller supplied no `-m` guidance
    And a forced transition of "apply"
    When the engine builds the agent instructions
    Then the prompt invokes "/rct:apply add-login-api" with no injected guidance
      argument trailing the change name

  # delegated-lifecycle + multi-agent-support: injecting arguments must not
  # hard-code one agent's invocation syntax. The token still resolves from the
  # configured spawn agent's adapter; only the trailing arguments are appended.
  Scenario: argument injection preserves the per-agent invocation token
    Given the configured spawn agent is "cursor"
    And the caller supplied `-m` guidance "focus the slice on the deny path"
    And a forced transition of "propose"
    When the engine builds the agent instructions
    Then the prompt invokes "/rct-propose add-login-api" (the cursor token)
    And the caller guidance is attached to that "/rct-propose add-login-api"
      invocation, not to a hard-coded "/rct:propose"
