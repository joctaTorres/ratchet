Feature: Decompose-phase enumerates issue requirements with the shared procedure
  As an author decomposing a later phase
  I want the earned-close check to enumerate an issue's requirements exactly as propose does
  So that a hedged security requirement cannot slip past the phase boundary unenumerated

  Scenario: The earned-close check carries the hedged-wording rule
    Given the generated decompose-phase workflow body
    When an author reads how to verify a prior phase's Fixes or Closes claim
    Then the body instructs them to fetch the issue through the project's issue tracker
    And to enumerate material requirements from both the explicit fix items and the problems named in the issue narrative
    And it states that hedged source wording such as "consider" does not lower the bar for a security-, permission-, or integrity-relevant requirement

  Scenario: Decompose-phase uses the same enumeration text as propose
    Given the generated decompose-phase and propose workflow bodies
    When their issue fetch and enumeration instructions are compared
    Then decompose-phase contains the shared fetch-and-enumeration text verbatim
    And decompose-phase carries no hand-written restatement of that procedure

  Scenario: A hedged security item on the worked example is enumerated at the phase boundary
    Given a prior phase claimed "Fixes #80"
    And issue #80 says "Consider requiring an explicit opt-in pairing flag" for a security-relevant override seam
    And the prior phase did not implement that pairing flag
    When an author follows the decompose-phase earned-close check
    Then the pairing flag is enumerated as a material requirement
    And the "Fixes #80" claim is surfaced as unearned and the remaining scope is carried forward
