Feature: the CLI entrypoint dispatches commands and parses flags
  As a maintainer holding ratchet to the testing standard
  I want src/cli/index.ts's command dispatch and flag parsing under test
  So that the user-facing entrypoint's wiring is proven, not assumed

  # src/cli/index.ts is instrumented by coverage but the existing test/cli-e2e
  # suite drives a SPAWNED bin/ratchet.js, so it never instruments this file
  # (it runs in a separate process). These scenarios drive the in-process
  # `program` over an isolated tmpdir fixture so the entrypoint's own lines —
  # the preAction telemetry hook, getCommandPath, global-flag handling, and each
  # registered .action wrapper — are exercised and measured.

  Background:
    Given an isolated tmpdir fixture repo built under os.tmpdir() with a valid .ratchet/ tree
    And telemetry is disabled for the test process via RATCHET_TELEMETRY=0
    And process.exit is stubbed so an action's exit does not terminate the runner
    And the in-process program from src/cli/index.ts is driven via parseAsync

  Scenario: a known command dispatches to its verb over the fixture
    Given the fixture is a structurally valid ratchet project
    When the program parses argv for "status --json"
    Then the status verb runs against the fixture and emits JSON to stdout
    And the preAction telemetry hook resolves the command path for tracking

  Scenario: a grouped subcommand dispatches with its command path resolved
    When the program parses argv for "batch list --json"
    Then the batch list verb runs against the fixture
    And getCommandPath resolves the actionCommand to the colon-joined path "batch:list"

  Scenario: the --json flag is parsed and routed to the verb
    When the program parses argv for a command with "--json"
    Then the parsed options carry json=true into the verb

  Scenario: the global --no-color flag sets NO_COLOR before the command runs
    When the program parses argv for any command with "--no-color"
    Then the preAction hook sets process.env.NO_COLOR to "1"

  Scenario: --version prints the package version and exits
    When the program parses argv for "--version"
    Then the package version is printed
    And the stubbed process exit records a zero exit
