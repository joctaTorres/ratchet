Feature: Landing-page hero carries the trust wedge
  As a developer evaluating ratchet from its landing page
  I want the hero and capability cards to lead with verifiable, anti-regression specs
  So that ratchet's differentiator is clear before I read anything else

  Scenario: Hero tagline leads with the anti-regression one-liner
    Given the Docusaurus site config at website/docusaurus.config.ts
    When the landing page renders the hero
    Then the tagline reads "AI-native spec-driven development that only moves forward"
    And the string "AI-native system for BDD-flavored spec-driven development" appears nowhere in the website sources

  Scenario: The eval capability card leads the card grid
    Given the FEATURES card list in website/src/pages/index.tsx
    When the landing page renders the capability cards
    Then the first card is tagged "// eval"
    And its body states that every Gherkin scenario doubles as a scored, baseline-diffed eval
    And its body states that behavior which passes today cannot silently regress
    And its body states that judging runs against fixtures, never the agent grading its own work

  Scenario: The spec card folds Gherkin into the behavior-is-the-contract framing
    Given the FEATURES card list in website/src/pages/index.tsx
    When the landing page renders the capability cards
    Then exactly one card is tagged "// spec"
    And its body describes executable Gherkin (Given/When/Then) as the contract the implementation must satisfy
    And its body states that a change is two artifacts: features plus a plan
    And no separate "// bdd" card remains

  Scenario: The batch card frames autonomy with a verifier
    Given the FEATURES card list in website/src/pages/index.tsx
    When the landing page renders the capability cards
    Then the card tagged "// batch" states that every phase is gated by an executable proof-of-work
    And its body states that the loop cannot advance by breaking what already worked
    And the landing page makes no unattended-autonomy promise that omits the verifier

  Scenario: Hero copy stays agent-neutral
    Given the landing page sources under website/src/pages/
    When the hero and capability cards render
    Then no copy names a specific coding agent
    And the install command remains "npx ratchet-ai@beta init" with no --tools value

  Scenario: Landing-page tests assert the retuned copy
    Given the pinned-copy tests in test/website/landing-page.test.ts and test/website/docusaurus-config.test.ts
    When the root test suite runs
    Then the tests assert the new tagline and the "// eval", "// spec", and "// batch" cards
    And the full suite passes with the coverage gate green
