Feature: An incomplete run cannot be promoted to baseline
  As a ratchet maintainer
  I want baseline promotion to route its decision through the aggregation core's completeness signal
  So that an incomplete run can never become the regression baseline future runs are judged against

  Background:
    Given the verdict-aggregation core reports whether a run is complete (no case left unjudged)

  Scenario: Promoting a complete passing run succeeds
    Given a persisted run in which every case carries a pass or fail verdict
    And the aggregation core reports the run complete
    When the run is promoted to baseline
    Then the baseline points at that run id

  Scenario: Promoting an incomplete run is rejected
    Given a persisted run that still has at least one unjudged case
    And the aggregation core reports the run incomplete
    When the run is promoted to baseline
    Then promotion is rejected with an error naming the run as incomplete
    And the baseline is left unchanged
