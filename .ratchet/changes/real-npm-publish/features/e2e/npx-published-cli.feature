Feature: Phase proof — a real publish lands on a registry and npx runs the published CLI
  As a maintainer
  I want the blackbox publish harness to perform a REAL publish to a staged registry and then run the package via npx
  So that I can see, end to end, that a green build on "main" actually publishes ratchet-ai and that `npx ratchet-ai --version` executes the freshly published CLI — while a red gate or a non-main ref publishes nothing

  # This completes the phase-4 proof-of-work, `bash test/e2e/npx-publish.sh`. The
  # earlier slices grew it to prove (a) GATING — the publish path is reachable only
  # when the release-gate runner records `release_allowed=true` on `main` — and
  # (b) IDEMPOTENCY against a forced published-version set, all while the publish
  # was `npm publish --dry-run` and nothing left the machine.
  #
  # This slice flips the proof from dry-run to a REAL publish. Because actually
  # uploading to npmjs.org from a test would be non-deterministic and irreversible,
  # the harness stands up a STAGED local registry (e.g. verdaccio) — exactly the
  # "real (or staged-registry) publish" the phase proof-of-work permits — and:
  #   - on the ALLOW + should_publish path, performs a REAL `npm publish` to the
  #     staged registry (with provenance attestation disabled for the offline
  #     staged run), then
  #   - runs the package through npx against that staged registry and asserts
  #     `npx ratchet-ai --version` actually executes the PUBLISHED `ratchet` CLI and
  #     prints the published version (not a locally-linked copy), and
  #   - re-runs the version guard with its real registry source pointed at the
  #     staged registry and asserts the just-published version is now seen as
  #     already-published -> should_publish=false -> a green, idempotent SKIP.
  #
  # The gating cases are PRESERVED: a forced red wired gate and a non-main ref must
  # each keep release_allowed=false so the publish path is never reached and the
  # staged registry receives nothing.
  #
  # Inputs (branch, GATE_* signals) remain FORCED via environment so the harness is
  # deterministic; the staged registry is local and torn down at the end, so the
  # proof stays side-effect-free against the real npm registry.

  Scenario: A green build on main publishes to the staged registry and npx runs the published CLI
    Given the package is built
    And a staged npm registry is running
    And the release gate ALLOWs on "main" with every wired gate green
    And the local version is not yet on the staged registry
    When the gated publish path runs against the staged registry
    Then the version guard reports should_publish "true"
    And a real "npm publish" uploads the package to the staged registry
    And running "npx ratchet-ai --version" against the staged registry executes the published CLI
    And the version it prints matches the published version

  Scenario: Re-running the already-published version is a green, idempotent SKIP via the real registry query
    Given the package has just been published to the staged registry
    And the release gate ALLOWs on "main" with every wired gate green
    When the version guard runs with its registry source pointed at the staged registry
    Then it sees the local version as already published
    And it reports should_publish "false"
    And no second publish is attempted
    And the version guard exits zero so the re-run does not error the pipeline

  Scenario: A forced red wired gate publishes nothing
    Given the package is built
    And a staged npm registry is running
    And the release gate runs on "main" with a forced red wired gate
    When the gated publish path runs against the staged registry
    Then the runner records "release_allowed=false"
    And the publish path is not reached
    And nothing is uploaded to the staged registry

  Scenario: A non-main ref publishes nothing
    Given the package is built
    And a staged npm registry is running
    And the release gate runs on a non-main branch with every wired gate green
    When the gated publish path runs against the staged registry
    Then the runner records "release_allowed=false"
    And the publish path is not reached
    And nothing is uploaded to the staged registry
