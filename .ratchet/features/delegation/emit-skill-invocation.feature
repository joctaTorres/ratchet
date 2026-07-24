Feature: The change-verb prompt delegates to the canonical rct skill
  As the batch engine spawning a headless agent to advance a change
  I want the prompt to tell the agent to invoke `/rct:<transition> <change>`
  instead of re-describing the propose/apply/verify steps inline
  So that the standards-aware skill path is the single author of lifecycle
  semantics (delegated-lifecycle standard) — the engine orchestrates, it does
  not re-author the lifecycle.

  # The prior change in this phase (guarantee-skill-in-spawn-locus) already
  # guarantees the rct command is present in the spawn locus, and owns the
  # single-source transition -> command-id mapping (rctCommandIdForTransition).
  # This change rewires buildAgentInstructions/transitionGuidance to EMIT that
  # invocation in the prompt, replacing the inline step descriptions.
  Background:
    Given a change-verb step context resolved by the engine for change
      "add-login-api" in batch "rex-agent-runtime"

  Scenario Outline: each transition emits its own skill invocation (claude spawn agent)
    Given the configured spawn agent is "claude"
    And a forced transition of "<transition>"
    When the engine builds the agent instructions
    Then the prompt instructs the agent to invoke "/rct:<transition> add-login-api"
    And the invocation uses the same single-source transition -> command-id
      mapping (rctCommandIdForTransition) as the spawn-locus guarantee

    Examples:
      | transition |
      | propose    |
      | apply      |
      | verify     |

  # multi-agent-support + delegated-lifecycle: the invocation TOKEN is NOT uniform
  # across agents — claude namespaces with ":" (/rct:propose) while cursor, gemini,
  # codex, github-copilot, opencode use "/rct-propose". The prompt must resolve the
  # invocation from the CONFIGURED spawn agent's command adapter, never hard-code
  # claude's "/rct:<id>" in the shared prompt path.
  Scenario Outline: the invocation token matches the configured spawn agent's syntax
    Given the configured spawn agent is "<agent>"
    And a forced transition of "propose"
    When the engine builds the agent instructions
    Then the prompt instructs the agent to invoke "<invocation> add-login-api"
    And the invocation token is resolved from "<agent>"'s command adapter, not a
      hard-coded "/rct:propose"

    Examples:
      | agent  | invocation   |
      | claude | /rct:propose |
      | cursor | /rct-propose |
      | gemini | /rct-propose |
      | codex  | /rct-propose |

  Scenario: the inline step descriptions are removed from the propose prompt
    Given a forced transition of "propose"
    When the engine builds the agent instructions
    Then the prompt no longer describes the hand-built propose steps inline
      (it does not tell the agent to "write files directly on disk", create the
      change directory, write feature files, or author plan.md by hand)
    And instead it delegates to "/rct:propose add-login-api"

  Scenario: the apply and verify prompts stop describing steps inline
    Given a forced transition of "apply" or "verify"
    When the engine builds the agent instructions
    Then the prompt no longer carries the inline transitionGuidance step text for
      that transition
    And instead it delegates to "/rct:apply add-login-api" or
      "/rct:verify add-login-api" respectively

  # delegated-lifecycle + multi-agent-support: the prompt PROSE stays agent-neutral
  # (it never names a coding agent), while the invocation TOKEN is the one the
  # configured spawn agent actually understands — resolved from that agent's
  # adapter, not a single hard-coded literal.
  Scenario: the delegation prose stays agent-neutral
    Given any configured spawn agent and any forced transition
    When the engine builds the agent instructions
    Then the prompt delegates to the rct skill via the configured agent's resolved
      invocation token (e.g. claude "/rct:propose", cursor "/rct-propose")
    And the prompt prose names no specific coding agent (Claude, Cursor, Codex, Gemini)
    And no single agent's invocation syntax is hard-coded in the shared prompt path
