Feature: Structured evidence persistence for judged and skipped eval cases
  As ratchet's eval report and CLI output
  I want the run JSON to persist each judged case's resolved rubric, per-clause pass/fail evidence, and every juror's individual vote — and a skipped case's skip reason and source — surfaced through report.ts and the eval run/report output
  So that a judge verdict or a skip decision is auditable from the run JSON and CLI output instead of a single flattened sentence, without changing how a case's verdict decides the AND-over-contributors gate

  Background:
    Given an eval run being executed and persisted

  # --- resolved rubric persisted -----------------------------------------

  Scenario: A judged llm-judge case persists its resolved rubric
    Given a case judged against a derived two-clause rubric
    When the case is judged and the run is persisted
    Then the case's record carries the resolved rubric as those same two clause texts

  Scenario: A case with an explicit rubric override persists the declared rubric, not a re-derivation
    Given a case bound with an explicit "rubric" override
    When the case is judged and the run is persisted
    Then the case's record carries the declared rubric verbatim

  # --- per-clause boolean pass/fail and cited evidence --------------------

  Scenario: A judged case persists each clause's pass/fail boolean and cited evidence
    Given a vote that judges one clause "yes" with evidence and one clause "no" with evidence
    When the case is judged and the run is persisted
    Then the case's record lists both clauses with their boolean pass/fail and the cited evidence text

  # --- per-juror votes ------------------------------------------------------

  Scenario: A multi-vote jury persists every juror's individual vote
    Given a jury of 3 votes where 2 pass and 1 fails
    When the case is judged and the run is persisted
    Then the case's record lists 3 individual juror votes, each with its own clauses and overall pass/fail
    And the majority-decided case verdict is recorded alongside the per-juror detail

  Scenario: A single-vote case persists its one juror's vote
    Given a jury of 1 vote
    When the case is judged and the run is persisted
    Then the case's record lists exactly one juror vote matching the cast vote

  Scenario: A sub-quorum case persists every dissenting juror's vote, not just a tally sentence
    Given a jury of 2 votes with majority quorum where 1 vote passes and 1 vote fails
    When the case is judged and the run is persisted
    Then the case verdict is "unjudged"
    And the case's record still lists both individual juror votes

  # --- deterministic cases keep the same uniform shape ---------------------

  Scenario: A deterministic check case persists a one-item rubric and a single juror vote
    Given a bound "check" case judged by its pass condition
    When the case is judged and the run is persisted
    Then the case's record carries a one-item rubric naming the check's pass condition
    And the case's record lists exactly one juror vote matching the check's outcome

  # --- skipped case retains skip reason and source --------------------------

  Scenario: A case skipped by its @skip tag persists the tag source and the tagged file
    Given a Scenario tagged "@skip" in its source .feature file
    When an eval run executes
    Then the skipped case's record carries skip source "tag" and the source file as the detail

  Scenario: A case skipped by an eval.skip config pattern persists the config source and the matched pattern
    Given a project eval.skip config listing a pattern that matches the case id
    When an eval run executes
    Then the skipped case's record carries skip source "config" and the matched pattern as the detail

  # --- absence of judging detail where there is none -----------------------

  Scenario: An unbound case persists no rubric, clauses, or votes
    Given a case with no eval-spec binding
    When an eval run executes
    Then the case's record carries no rubric, clauses, or votes
    And the case verdict is "unjudged"

  Scenario: A manually-recorded verdict persists no rubric, clauses, or votes
    Given a run with a case judged automatically
    When the case's verdict is manually overridden
    Then the overridden record carries no rubric, clauses, or votes
    And the record's source is "manual"

  # --- report.ts surfaces the structured data -------------------------------

  Scenario: The report exposes each case's structured rubric, clauses, and juror votes
    Given a persisted run with a judged llm-judge case
    When the eval report is built
    Then the report lists that case's resolved rubric, per-clause results, and every juror's vote

  Scenario: The report exposes a skipped case's skip source and detail
    Given a persisted run with a case recorded "skipped"
    When the eval report is built
    Then the report lists that case's skip source and matched detail

  # --- surfaced through CLI output, gate untouched --------------------------

  Scenario: ratchet eval run --json includes the structured per-case detail
    Given a completed eval run
    When I run "ratchet eval run --json"
    Then the JSON output includes each case's rubric, clauses, votes, and skip detail where applicable

  Scenario: ratchet eval report --json includes the structured per-case detail
    Given a persisted run
    When I run "ratchet eval report --run <id> --json"
    Then the JSON output includes each case's rubric, clauses, votes, and skip detail where applicable

  Scenario: Adding structured persistence does not change the AND-over-contributors gate
    Given a run whose contributors would pass or fail under the existing aggregation core
    When the run is persisted with its new structured per-case fields
    Then the overall verdict and each contributor's pass/fail are unchanged from before the structured fields were added
