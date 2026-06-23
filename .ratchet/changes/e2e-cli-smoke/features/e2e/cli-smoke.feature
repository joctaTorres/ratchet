Feature: End-to-end CLI smoke — drive the built CLI like a user and emit an e2e signal
  As a maintainer of the ratchet package
  I want an e2e suite that exercises the BUILT CLI the way a user running `npx ratchet` would, and turns the result into a green/red signal
  So that a broken end-to-end CLI can later block the release — proven against the real binary, not a mocked import

  # This is the e2e half of the "coverage + e2e gates" phase. It mirrors the
  # coverage slice's shape: a real signal-producer (here, a smoke that spawns the
  # built CLI as a subprocess) writes a machine-readable result, and a PURE
  # evaluator turns that result into an `e2e` gate SIGNAL (green | red) in the
  # exact shape the release-decision module already consumes. A thin runner adapts
  # the CI environment to the evaluator, exactly as `release-gate.ts` /
  # `coverage-gate.ts` do.
  #
  # "Like a user" is the commitment: the smoke runs `node bin/ratchet.js <args>`
  # as a child process against the freshly BUILT `dist/`, the same path
  # `npx ratchet` resolves through the package `bin`. It does NOT import internals
  # or call functions directly — it asserts on the process's exit code and stdout,
  # so a packaging/build/entrypoint regression that unit tests miss is caught.
  #
  # Like the coverage slice, this change produces the `e2e` signal but does NOT
  # add it to the release-decision module's wired-gate set — that is the separate
  # `after` change `wire-coverage-e2e-into-release-gate`. This slice exists to
  # prove the end-to-end CLI smoke and its green/red decision in isolation so the
  # wiring has a trustworthy signal to feed in.
  #
  # Fail-closed: anything other than an explicit, parseable result where every
  # check passed is red. The evaluator is a pure function of its parsed input —
  # no I/O, no clock — so every branch is exhaustively unit-testable.

  Background:
    Given the package exposes the CLI through `bin/ratchet.js` (the `npx ratchet` entrypoint)
    And the project has been built so `dist/` is present

  Scenario: The smoke drives the built CLI as a user would and it responds
    Given the built CLI binary at "bin/ratchet.js"
    When I run the CLI as a subprocess with "--version" the way `npx ratchet` would
    Then the process exits 0
    And its output reports the package version

  Scenario: The smoke exercises a user-facing command end to end
    Given the built CLI binary at "bin/ratchet.js"
    When I run the CLI as a subprocess with "--help"
    Then the process exits 0
    And its output lists the available commands a user can run

  Scenario: The smoke records a machine-readable result the evaluator can read
    Given the smoke has driven the built CLI through its user-facing checks
    When the smoke run finishes
    Then it writes a machine-readable result summarizing each check and an overall pass/fail

  Scenario: Green when the smoke result reports every check passed
    Given a parsed e2e result in which every check passed and the run is marked ok
    When I evaluate the e2e gate
    Then the e2e signal is "green"
    And there are no failure reasons

  Scenario: Red when the smoke result reports any failed check
    Given a parsed e2e result in which at least one check failed
    When I evaluate the e2e gate
    Then the e2e signal is "red"
    And the reasons name the failing check

  Scenario: Is fail-closed when the e2e result is missing or unparseable
    Given no parseable e2e result is available
    When I evaluate the e2e gate
    Then the e2e signal is "red"
    And the reasons include that the e2e result could not be read

  Scenario: The signal shape matches the release-decision gate signals
    Given a parsed e2e result in which every check passed and the run is marked ok
    When I evaluate the e2e gate
    Then the signal value is one the release-decision module accepts as a gate signal
    But the e2e signal is NOT yet added to the release-decision module's wired gates in this change
