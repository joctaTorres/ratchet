Feature: Cross-language shquote contract test
  As a ratchet maintainer
  I want the TypeScript shquote and the Python _shquote locked to one shared
  set of quoting vectors
  So that the two implementations cannot silently diverge

  Scenario: A single vectors file is the shared source of truth
    Given a shquote vectors file listing input strings and their expected single-quoted output
    And the vectors cover spaces, single quotes, double quotes, dollar signs, backticks, newlines, and the empty string
    When the TypeScript contract test and the Python contract test run
    Then both tests load their cases from that same vectors file
    And neither test hardcodes its own private copy of the vectors

  Scenario: The TypeScript shquote satisfies every vector
    Given the shared shquote vectors file
    When the vitest contract test applies shquote from spawn-command.ts to each input
    Then every output equals the vector's expected string

  Scenario: The Python _shquote satisfies every vector
    Given the shared shquote vectors file
    When the stdlib-unittest contract test applies _shquote from sidecar.py to each input
    Then every output equals the vector's expected string
