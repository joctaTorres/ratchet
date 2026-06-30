Feature: Jury quorum resolution for the llm-judge contributor
  As ratchet's eval gate
  I want N independent rubric votes resolved into one case verdict by a configurable jury quorum (majority or unanimous), layered project default over per-binding override
  So that the llm-judge contributor only manufactures a definitive pass or fail when its votes genuinely agree, and abstains (unjudged) rather than guess when they don't

  # This is the jury-quorum-resolution slice of judge hardening, downstream of
  # rubric-decomposition (per-clause all-yes vote gating already lands a
  # structured AgentVote.pass per vote). This slice replaces the old fixed
  # N-of-M-majority-only resolution with a configurable `jury` block (`votes`,
  # `quorum: majority|unanimous`), layered from project-level `eval.jury` and
  # overridable per binding, plus an inert `panel:` slot reserved for a future
  # cross-family panel. Skip filters and structured run-JSON persistence of
  # per-juror votes are downstream changes; this slice only changes how votes
  # already cast resolve into one verdict, and does not touch where the
  # llm-judge contributor plugs into the gate.

  Background:
    Given an llm-judge-bound eval case

  # --- jury configuration resolution: project default + per-binding override --

  Scenario: No jury configuration anywhere casts a single majority vote
    Given no project-level jury default and no per-binding jury override
    When the case's jury settings are resolved
    Then exactly one vote is cast
    And the quorum is majority

  Scenario: A project-level jury default sets votes and quorum for the case
    Given a project-level jury default of 3 votes and unanimous quorum
    And the binding declares no jury override
    When the case's jury settings are resolved
    Then 3 votes are cast
    And the quorum is unanimous

  Scenario: A per-binding jury override replaces the project default outright
    Given a project-level jury default of 3 votes and majority quorum
    And the binding declares its own jury override of 5 votes and unanimous quorum
    When the case's jury settings are resolved
    Then 5 votes are cast
    And the quorum is unanimous

  Scenario: A per-binding override of only one jury field falls back to the project default for the other
    Given a project-level jury default of 3 votes and majority quorum
    And the binding's jury override sets only the quorum to unanimous
    When the case's jury settings are resolved
    Then 3 votes are cast
    And the quorum is unanimous

  # --- majority quorum: a strict majority of votes must agree -----------------

  Scenario: A strict majority of passing votes resolves a pass under majority quorum
    Given a jury of 3 votes with majority quorum
    And 2 votes pass and 1 vote fails
    When the votes are resolved
    Then the case verdict is "pass"

  Scenario: A strict majority of failing votes resolves a fail under majority quorum
    Given a jury of 3 votes with majority quorum
    And 1 vote passes and 2 votes fail
    When the votes are resolved
    Then the case verdict is "fail"

  Scenario: A tied vote under majority quorum does not reach quorum
    Given a jury of 2 votes with majority quorum
    And 1 vote passes and 1 vote fails
    When the votes are resolved
    Then the case verdict is "unjudged"
    And the reason names the quorum that was not reached

  # --- unanimous quorum: every vote must agree ---------------------------------

  Scenario: Unanimous agreement to pass resolves a pass under unanimous quorum
    Given a jury of 3 votes with unanimous quorum
    And all 3 votes pass
    When the votes are resolved
    Then the case verdict is "pass"

  Scenario: Unanimous agreement to fail resolves a fail under unanimous quorum
    Given a jury of 3 votes with unanimous quorum
    And all 3 votes fail
    When the votes are resolved
    Then the case verdict is "fail"

  Scenario: Any disagreement under unanimous quorum does not reach quorum
    Given a jury of 3 votes with unanimous quorum
    And 2 votes pass and 1 vote fails
    When the votes are resolved
    Then the case verdict is "unjudged"
    And the reason names the quorum that was not reached

  # --- sub-quorum never guesses -------------------------------------------------

  Scenario: A sub-quorum result is never recorded as a pass or a fail
    Given a jury whose cast votes do not reach its configured quorum
    When the votes are resolved
    Then the case verdict is "unjudged"
    And the case is never recorded as "pass" or "fail"

  # --- panel slot: reserved, validated, inert ----------------------------------

  Scenario: A jury block with a panel slot validates without affecting resolution
    Given a jury block that declares a "panel" of contributor-family ids
    When the jury configuration is parsed
    Then the panel value is accepted and retained on the parsed jury
    And resolving votes against that jury ignores the panel entirely

  Scenario: An invalid panel block fails jury schema validation
    Given a jury block whose "panel" value has no families listed
    When the jury configuration is parsed
    Then the jury configuration is rejected as invalid
