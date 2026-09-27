Feature: One definition of a tracked security deferral
  As an author resolving deferred items during decompose-phase
  I want the "tracked" outcome for a security-relevant item to meet the stop-and-surface guardrail's bar
  So that "tracked" cannot be read as a lower bar than the guardrail in the same body

  Scenario: A security-relevant item is tracked only by a filed, owned, plan-linked issue
    Given the generated decompose-phase workflow body
    When an author resolves a security-, permission-, or integrity-relevant deferred item as tracked
    Then the body requires the tracking issue to be filed and open
    And to have a named owner
    And to be linked from the change plan
    And it refers the author to the stop-and-surface guardrail for that bar rather than stating a different one

  Scenario: An open but unowned issue does not track a security deferral
    Given a prior-phase plan defers a permission-relevant item
    And an open tracking issue exists for it with no assignee
    When an author follows the decompose-phase resolution step
    Then the item is not reported as tracked
    And the author surfaces it to the user instead of proceeding

  Scenario: Non-security items keep the lighter tracked outcome
    Given a prior-phase plan defers a cosmetic, non-security item
    And an open tracking issue exists for it
    When an author follows the decompose-phase resolution step
    Then the item may be reported as tracked with that issue's number
