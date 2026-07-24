Feature: The skill invocation is delegated WITH context, not as a bare call
  As the batch engine delegating a transition to the rct skill
  I want the resolved phase context and per-change definition of done to remain
  in the prompt alongside the `/rct:<transition> <change>` invocation
  So that switching to skill delegation does not drop the orchestration context
  the engine already resolved (delegated-lifecycle: "Delegation must be
  context-preserving, not context-free").

  # SCOPE NOTE: buildAgentInstructions already injects the phase
  # goal/success/proof-of-work and the per-change definition of done at the top
  # of the prompt. This change must KEEP that context present alongside the new
  # invocation — it must not regress to a bare, context-free skill call. Wiring
  # the caller's `-m` guidance and any resume answer in as skill ARGUMENTS is the
  # next change (inject-invocation-context) and is out of scope here.
  Background:
    Given a change-verb step context resolved by the engine for change
      "add-login-api" with definition of done
      "the login endpoint authenticates a user"

  Scenario: the phase context and definition of done remain alongside the invocation
    Given a forced transition of "apply"
    When the engine builds the agent instructions
    Then the prompt invokes "/rct:apply add-login-api"
    And the prompt still carries the resolved phase goal, phase success criteria,
      and phase proof-of-work
    And the prompt still carries the per-change "Definition of done:" line

  Scenario: the invocation is never emitted as a bare, context-free call
    Given any forced transition
    When the engine builds the agent instructions
    Then the prompt is not reduced to only the "/rct:<transition> <change>" line
    And the resolved phase context the engine already had in hand is preserved in
      the prompt
