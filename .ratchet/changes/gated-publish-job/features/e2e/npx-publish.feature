Feature: Phase proof — the publish job is reachable only when the gate ALLOWs on main
  As a maintainer
  I want a blackbox harness that drives the release-gate runner and watches the gating decision flow into the publish job
  So that I can see, end to end, that a green build of "main" makes the publish path reachable (as a dry-run) while a forced red gate or a non-main ref skips publish entirely

  # This is the phase-4 proof-of-work seed: `bash test/e2e/npx-publish.sh`. It is a
  # blackbox harness, not a unit test — it builds the package and runs the real
  # `release-gate.js` runner over forced gate signals, capturing the runner's
  # GITHUB_OUTPUT exactly as the `ci` job does, then asserts whether the `publish`
  # job's gate condition (`release_allowed == 'true'`) is satisfied and, when it
  # is, exercises the dry-run publish path the way the gated job would.
  #
  # SCOPE for THIS slice: prove REACHABILITY/GATING of the publish job. Inputs are
  # FORCED by setting the runner's GATE_* / branch environment over a scratch
  # GITHUB_OUTPUT file — no GitHub Actions runner required and no real source is
  # sabotaged, so the harness is deterministic and side-effect-free. The publish it
  # observes is `npm publish --dry-run` and nothing is uploaded. The later phase
  # changes thicken this same harness toward a real/staged-registry publish and a
  # `npx ratchet --version` assertion against the published CLI (idempotency and the
  # real token+provenance publish are `idempotent-version-guard` and
  # `real-npm-publish`).

  Scenario: A green build on main makes the publish path reachable as a dry-run
    Given the package is built
    And the release gate runs on the "main" branch with every wired gate green
    When the release-gate runner is executed and its step output is captured
    Then the runner records "release_allowed=true" in its step output
    And the publish job's gate condition is satisfied
    And the dry-run publish path is exercised and nothing is published

  Scenario: A forced red gate skips the publish path entirely
    Given the package is built
    And the release gate runs on the "main" branch with a forced red wired gate
    When the release-gate runner is executed and its step output is captured
    Then the runner records "release_allowed=false" in its step output
    And the publish job's gate condition is not satisfied
    And the dry-run publish path is not reached

  Scenario: A non-main ref skips the publish path entirely
    Given the package is built
    And the release gate runs on a non-main branch with every wired gate green
    When the release-gate runner is executed and its step output is captured
    Then the runner records "release_allowed=false" in its step output
    And the publish job's gate condition is not satisfied
    And the dry-run publish path is not reached
