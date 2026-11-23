Feature: README credits record the absorbed upstream baselines
  As a ratchet maintainer
  I want the README credits section to record the exact upstream baselines the
  upstream-absorption batch absorbed — OpenSpec 2.0.0 and superpowers 7.0.2 —
  alongside the existing fork attribution
  So that the project's provenance is accurate, greppable, and preserved where
  readers already look for attribution

  Scenario: The absorbed OpenSpec baseline is recorded
    Given the repository README.md
    When its credits section is read
    Then it records the exact string "OpenSpec 2.0.0" as an absorbed upstream baseline

  Scenario: The absorbed superpowers baseline is recorded
    Given the repository README.md
    When its credits section is read
    Then it records the exact string "superpowers 7.0.2" as an absorbed upstream baseline

  Scenario: The existing fork attribution is kept alongside the baselines
    Given the repository README.md
    When its credits section is read
    Then it still attributes ratchet as a fork of OpenSpec by Fission-AI
    And it still states that ratchet is licensed under MIT

  Scenario: The recorded baselines are pinned by the phase's shared test
    Given the phase's shared rendered-output test file
      test/core/shared/brainstorm-v7-rendered-output.test.ts
    When it runs against the shipped README.md
    Then it asserts the credits section carries the exact strings
      "OpenSpec 2.0.0" and "superpowers 7.0.2" as absorbed upstream baselines
    And it asserts the existing fork attribution is preserved
