Feature: the validate verb validates batch manifests and reports item issues
  As a maintainer holding ratchet to the testing standard
  I want src/commands/validate.ts's batch validation and reporting paths under test
  So that batch manifests, the --type override, and every report branch are proven

  # validateDirectItem also recognises a name as a batch manifest (isBatch +
  # validateBatch), honours a --type change|spec override (normalizeType), and
  # routes the spec type to the feature store. printReport renders valid/invalid
  # change and spec results in both text and JSON, with printNextSteps guidance on
  # failure. These branches are unexercised today; these scenarios drive them over
  # an isolated tmpdir fixture so the batch DAG/manifest error paths and the full
  # reporting surface are exercised and measured.

  Background:
    Given an isolated tmpdir fixture repo built under os.tmpdir() with a .ratchet/ tree
    And the test process.chdir's into the fixture and restores cwd in afterEach
    And console.log/console.error are captured and process.exitCode is reset per test

  Scenario: a well-formed batch manifest validates as a batch item
    Given the fixture has a structurally valid batch manifest named "feat-batch"
    When the validate verb runs on "feat-batch" with noInteractive
    Then "Batch 'feat-batch' is valid" is printed
    And process.exitCode is 0

  Scenario: a malformed batch manifest reports the error with its location
    Given the fixture has a batch manifest that fails to load
    When the validate verb runs on the malformed batch with noInteractive
    Then "has issues" is printed with an ERROR entry carrying the failing location
    And process.exitCode is 1

  Scenario: a batch phase with a cyclic dependency reports a DAG error
    Given the fixture has a batch manifest whose phase has a dependency cycle
    When the validate verb runs on that batch with noInteractive
    Then a per-phase ERROR is reported under the phase path
    And process.exitCode is 1

  Scenario: a batch manifest validates in JSON mode
    Given the fixture has a structurally valid batch manifest
    When the validate verb runs on the batch with --json
    Then the JSON output reports one item of type "batch" that is valid

  Scenario: an invalid change reports issues, exit 1, and next-steps guidance
    Given the fixture has a change whose feature and plan are structurally invalid
    When the validate verb runs on that change with noInteractive
    Then "has issues" is printed with leveled issue lines
    And change-specific next-steps guidance is printed
    And process.exitCode is 1

  Scenario: an invalid change in JSON mode emits a structured failing report
    Given the fixture has a structurally invalid change
    When the validate verb runs on that change with --json
    Then the JSON output reports the change item as not valid with its issues

  Scenario: the --type spec override routes validation to the feature store
    Given the fixture has a spec capability in the feature store
    When the validate verb runs on that name with --type spec and noInteractive
    Then the specification is validated as a spec and reported accordingly

  Scenario: an invalid spec reports spec-specific next-steps guidance
    Given the fixture has a spec whose feature files are structurally invalid
    When the validate verb runs on that spec with --type spec and noInteractive
    Then "has issues" is printed with spec-specific next-steps guidance
    And process.exitCode is 1
