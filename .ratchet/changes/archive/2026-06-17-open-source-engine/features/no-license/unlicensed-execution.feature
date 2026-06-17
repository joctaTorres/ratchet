Feature: Unlicensed engine execution
  As a user running batches
  I want the engine to execute without any license or authorization
  So that no key, server, or lease ever stands between me and running a step

  Scenario: A step runs without any license
    Given no license key is configured anywhere
    When the engine runs a batch step
    Then it spawns the configured agent and drives the transition
    And no authorization, signature check, or lease is required

  Scenario: No license key is read from the environment
    Given the engine spawns an agent subprocess
    When I inspect what the engine reads and forwards
    Then it never reads a RATCHET_LICENSE_KEY
    And it does not forward a license key into the spawned agent's environment

  Scenario: Licensing artifacts are gone
    Given the engine source
    When I look for the license manager, authorization service, and lease logic
    Then none of them exist
    And the engine has no failure mode that refuses to run for licensing reasons

  Scenario: The engine still fails closed on real execution errors
    Given a batch step whose agent crashes or whose proof-of-work fails
    When the engine evaluates the result
    Then it surfaces the failure as a blocked or failed step as before
    And the run state stays consistent and resumable
