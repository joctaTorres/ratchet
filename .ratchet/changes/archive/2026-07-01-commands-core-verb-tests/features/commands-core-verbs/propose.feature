Feature: propose verb behavior is proven by tests
  As a maintainer holding ratchet to the testing standard
  I want the propose verb's name-derivation and precondition contract under test
  So that its fail-fast (no-spawn) guarantees can only ratchet upward

  Background:
    Given an isolated tmpdir fixture repo built under os.tmpdir()
    And the engine agent spawn is replaced by an injected fake runtime
    So that no real agent is ever spawned during the test

  Scenario: derives a kebab-case change name from a free-text objective
    Given an objective "Add user authentication"
    When deriveChangeName is called with that objective
    Then it returns the kebab-case slug "add-user-authentication"

  Scenario: a blank or unsluggable objective with no --name fails fast with no spawn
    Given an objective that is blank or punctuation-only
    And no explicit --name option
    When proposeCommand runs
    Then it throws an actionable error asking for a non-empty objective or --name
    And the injected runtime is never invoked

  Scenario: an explicit --name short-circuits derivation from the objective
    Given an objective and an explicit --name "chosen-change"
    When proposeCommand runs
    Then the step context is built for change "chosen-change"

  Scenario: propose refuses to clobber an existing change
    Given a change "already-here" already exists under .ratchet/changes/
    When proposeCommand runs with an objective deriving "already-here"
    Then it throws an actionable error directing to apply/verify or a different --name
    And the injected runtime is never invoked

  Scenario: a happy-path propose advances via the forced propose transition
    Given a valid objective and an injected runtime that returns an advanced result
    When proposeCommand runs
    Then exactly one step runs with the forced transition "propose"
    And the rendered result reports the change as proposed

  Scenario: --json renders the structured result as a single JSON object
    Given a valid objective and an injected runtime that returns a step result
    When proposeCommand runs with --json
    Then a single valid JSON object is printed carrying the transition and state
