Feature: Web binding schema for browser scenarios
  As an eval author
  I want to bind a case to a browser lifecycle instead of a bash check or an LLM judge
  So that tier-4 can cover Given/When/Then browser behavior mechanically, without a bespoke harness per case

  Background:
    Given a ratchet project with .ratchet/evals/specs/ and at least one .feature scenario

  Scenario: A web binding declares the app-boot and readiness lifecycle
    Given an eval-spec binding whose kind is "web"
    When the binding declares a fixture, a "start" boot command, a "readiness" probe, a "timeoutMs", and a "spec" path
    Then the binding resolves successfully
    And its kind is reported as "web"
    And no parse warning is produced for that binding

  Scenario: Readiness is probed by URL or by command
    Given a "web" binding whose readiness names a URL
    When the same binding shape is authored with a command instead of a URL
    Then both variants resolve successfully as valid readiness probes
    And a binding that declares neither a URL nor a command is rejected with a warning

  Scenario: The readiness timeout is the fail-closed boundary
    Given a "web" binding with a readiness probe and a timeoutMs
    When the binding is loaded
    Then the timeoutMs is required and must be a positive integer
    And a binding omitting timeoutMs does not resolve

  Scenario: A web binding names the Playwright spec that drives the scenario
    Given a "web" binding
    When the binding is loaded
    Then it provides a "spec" path to the Playwright test that drives the case's Given/When/Then
    And a binding omitting "spec" does not resolve

  Scenario: A web binding may declare a one-time fixture setup
    Given a "web" binding whose fixture needs bootstrapping before the app can start
    When the binding declares a "setup" command
    Then the setup is accepted the same way it is for "deterministic" and "llm-judge" bindings

  Scenario: eval set reports web-bound cases with the new kind label
    Given a "deterministic" binding, an "llm-judge" binding, a "web" binding, and one unbound case in scope
    When I run "ratchet eval set"
    Then the web-bound case is tagged "[web]"
    And the deterministic case is tagged "[deterministic]"
    And the llm-judge case is tagged "[llm-judge]"
    And the unbound case is tagged "[unbound]"
