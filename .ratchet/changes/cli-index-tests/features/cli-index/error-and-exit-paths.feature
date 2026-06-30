Feature: the CLI entrypoint reports errors and exits non-zero
  As a maintainer holding ratchet to the testing standard
  I want src/cli/index.ts's error and exit paths under test
  So that a failing verb is surfaced to the user and exits non-zero, provably

  # Every registered .action in src/cli/index.ts wraps its verb in a try/catch
  # that calls ora().fail(...) and process.exit(1). These are the file's
  # largest uncovered region. Driving the in-process program with a fixture or
  # argv that makes a verb throw exercises those catch/exit lines without
  # terminating the test runner (process.exit is stubbed to throw a sentinel).

  Background:
    Given an isolated tmpdir fixture repo built under os.tmpdir()
    And telemetry is disabled for the test process via RATCHET_TELEMETRY=0
    And process.exit is stubbed to throw a sentinel instead of terminating
    And the in-process program from src/cli/index.ts is driven via parseAsync

  Scenario: a verb that throws is reported and exits with code 1
    Given a fixture where the target verb cannot succeed
    When the program parses argv for that command
    Then the catch block reports the error via ora().fail with the message
    And process.exit is called with 1

  Scenario: an unknown command is rejected and exits non-zero
    When the program parses argv for a command name that is not registered
    Then commander reports the unknown command
    And process.exit is called with a non-zero code

  Scenario: a missing required argument is rejected and exits non-zero
    When the program parses argv for a command missing a required argument
    Then commander reports the missing argument
    And process.exit is called with a non-zero code
