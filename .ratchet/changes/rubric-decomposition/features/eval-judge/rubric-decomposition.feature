Feature: Per-Then-clause rubric decomposition for the llm-judge contributor
  As ratchet's eval gate
  I want the llm-judge contributor to judge a case clause by clause against its Gherkin Then-steps, with each vote reasoning before it states a verdict and judging the evidence on its own merits
  So that a judge agent cannot rubber-stamp a vague overall impression — every asserted outcome is independently proven, and one unproven clause fails the case

  Background:
    Given an llm-judge-bound eval case

  # --- rubric derivation: one binary item per Then-clause ---------------------

  Scenario: A single-Then scenario derives a one-item rubric
    Given a scenario with one "Then" step and no "And"/"But" steps under it
    When the case's rubric is derived
    Then the rubric has exactly one item for that Then step

  Scenario: Then plus And/But steps each derive their own rubric item
    Given a scenario with a "Then" step followed by two "And" steps under it
    When the case's rubric is derived
    Then the rubric has exactly three items, one per Then/And step

  Scenario: And/But steps under Given or When are not rubric items
    Given a scenario whose "Given" and "When" steps are each followed by an "And" step
    And the scenario also has a "Then" step
    When the case's rubric is derived
    Then the rubric has exactly one item, derived only from the "Then" step
    And the "And" steps under "Given" and "When" are excluded from the rubric

  Scenario: An explicit rubric override takes precedence over auto-derivation
    Given a binding that declares an explicit "rubric" list
    When the case's rubric is derived
    Then the declared rubric is used verbatim
    And the Then-clauses are not auto-decomposed

  # --- per-vote agent prompt: CoT-before-verdict and anti-sycophancy ----------

  Scenario: The vote prompt requires reasoning before a verdict per clause
    Given a case with a derived rubric
    When the per-vote agent prompt is built
    Then the prompt instructs the agent to reason step by step about each rubric clause before stating any pass verdict for it
    And the prompt lists every rubric clause the agent must judge

  Scenario: The vote prompt instructs the agent to judge evidence independently
    Given a case with a derived rubric
    When the per-vote agent prompt is built
    Then the prompt instructs the agent to judge the evidence it finds on its own merits rather than defer to the scenario's or success criteria's framing
    And the prompt instructs the agent to answer "can't-tell" for a clause when its evidence is inconclusive

  # --- structured per-vote verdict: [{clause, pass, evidence}] ----------------

  Scenario: A vote whose output judges every clause yes returns a structured pass per clause
    Given a rubric with two clauses
    And the spawned agent's output judges both clauses "yes" with cited evidence
    When the vote is parsed
    Then the parsed vote is a list of two clause results, each with the clause text, a pass of true, and the cited evidence

  Scenario: A vote with one "no" clause fails closed on that clause
    Given a rubric with two clauses
    And the spawned agent's output judges one clause "yes" and the other "no"
    When the vote is parsed
    Then the parsed vote records the second clause as not passing
    And the cited evidence for the failing clause is preserved

  Scenario: A vote with a "can't-tell" clause fails closed on that clause
    Given a rubric with one clause
    And the spawned agent's output judges that clause "can't-tell"
    When the vote is parsed
    Then the parsed vote records that clause as not passing
    And the reason names the missing evidence

  Scenario: A vote missing a verdict for a rubric clause fails closed
    Given a rubric with two clauses
    And the spawned agent's output only addresses one of the two clauses
    When the vote is parsed
    Then the parsed vote records the unaddressed clause as not passing

  # --- all-yes gating on a single vote -----------------------------------------

  Scenario: A vote passes only when every clause passes
    Given a rubric with three clauses
    And the spawned agent's output judges all three clauses "yes" with evidence
    When the vote is parsed
    Then the vote's overall pass is true

  Scenario: A single failing or can't-tell clause fails the whole vote
    Given a rubric with three clauses
    And the spawned agent's output judges two clauses "yes" and one "can't-tell"
    When the vote is parsed
    Then the vote's overall pass is false
    And the failing clause is identified in the vote's structured result

  # --- judgeCase returns the structured result, replacing the flat reason -----

  Scenario: judgeCase returns the structured per-clause result instead of a flat reason string
    Given a bound llm-judge case with a derived rubric
    And the spawned agent's output judges every clause "yes" with evidence
    When the case is judged
    Then the returned verdict carries the structured list of clause results the vote produced
    And the case verdict is "pass"

  Scenario: judgeCase fails the case when the structured vote has a failing clause
    Given a bound llm-judge case with a derived rubric
    And the spawned agent's output judges one clause "no"
    When the case is judged
    Then the case verdict is "fail"
    And the returned verdict carries the structured list of clause results, including the failing clause's evidence
