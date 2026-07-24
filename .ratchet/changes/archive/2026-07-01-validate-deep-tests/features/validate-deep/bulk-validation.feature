Feature: the validate verb runs bulk validation across changes and specs
  As a maintainer holding ratchet to the testing standard
  I want src/commands/validate.ts's bulk-validation paths under test
  So that --all/--changes/--specs, concurrency, JSON, and error handling are proven

  # validate.ts measures ~29% line coverage at phase entry; the existing
  # test/commands/validate.test.ts covers only the no-item hint, unknown-item,
  # ambiguous-item, and single valid-change happy path. The whole runBulkValidation
  # branch — the bulk flags, the concurrency-bounded queue, JSON vs text output,
  # the empty-queue early return, and the per-task error catch — is entirely
  # unexercised. These scenarios drive execute() with the bulk flags over an
  # isolated tmpdir fixture so those lines are exercised and measured.

  Background:
    Given an isolated tmpdir fixture repo built under os.tmpdir() with a .ratchet/ tree
    And the test process.chdir's into the fixture and restores cwd in afterEach
    And console.log/console.error are captured and process.exitCode is reset per test

  Scenario: --all validates both changes and specs and reports a totals line
    Given the fixture has one structurally valid change and one spec
    When the validate verb runs with the --all flag and noInteractive
    Then each item is printed with a pass marker
    And a "Totals: ... passed, ... failed" line is printed
    And process.exitCode is 0

  Scenario: --changes restricts the scope to changes only
    Given the fixture has a valid change and a spec
    When the validate verb runs with the --changes flag and noInteractive
    Then only the change is reported and the spec is not
    And process.exitCode is 0

  Scenario: --specs restricts the scope to specs only
    Given the fixture has a valid change and a spec
    When the validate verb runs with the --specs flag and noInteractive
    Then only the spec is reported and the change is not

  Scenario: a failing item drives a non-zero exit and a failed marker
    Given the fixture has a change whose plan.md is structurally invalid
    When the validate verb runs with the --changes flag and noInteractive
    Then the invalid change is printed with a fail marker
    And the totals line counts one failed item
    And process.exitCode is 1

  Scenario: an empty scope returns success with a no-items message
    Given the fixture has no changes and no specs
    When the validate verb runs with the --all flag and noInteractive
    Then "No items found to validate." is printed
    And process.exitCode is 0

  Scenario: an empty scope in JSON mode emits a zeroed summary
    Given the fixture has no changes and no specs
    When the validate verb runs with --all and --json
    Then the JSON output has an empty items array and totals of zero
    And process.exitCode is 0

  Scenario: JSON mode emits a structured report with a typed summary
    Given the fixture has one valid change and one spec
    When the validate verb runs with --all and --json
    Then the parsed JSON has an items array, a summary.totals, and version "1.0"

  Scenario: an explicit concurrency option bounds the validation queue
    Given the fixture has several valid changes
    When the validate verb runs with --changes, --concurrency 2, and noInteractive
    Then every change is validated and reported
    And process.exitCode is 0
