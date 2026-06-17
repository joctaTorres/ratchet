Feature: Licensed engine
  As the engine vendor
  I want the engine to be worthless without a valid license
  So that a lifted distribution blob cannot be embedded in another tool

  Scenario: A valid license authorizes a run
    Given a configured, valid license
    When the engine starts a batch run
    Then it authenticates and obtains a run authorization before spawning any agent

  Scenario: Without a valid license the engine refuses to run
    Given no license or an invalid license
    When the engine is asked to run a step
    Then it refuses to spawn any agent
    And it reports that a valid license is required and how to obtain one

  Scenario: The license server response is load-bearing, not a boolean
    Given an authorized run
    When the engine prepares a transition
    Then required run material is obtained from the license service rather than embedded in the distribution
    And a blob without a valid license lacks what it needs to function

  Scenario: Offline grace within a signed lease
    Given a run that obtained a signed lease while online
    When connectivity is lost within the lease window
    Then the engine continues running steps until the lease expires
    And it requires re-authorization once the lease has expired

  Scenario: The open CLI is unaffected by engine licensing
    Given the engine is absent or unlicensed
    When I run "ratchet batch status", "ratchet batch view", or "ratchet batch config"
    Then those commands work normally without a license
