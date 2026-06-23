Feature: A dedicated publish job reachable only when the release decision is ALLOW
  As a maintainer of the ratchet package
  I want the publish to live in its own CI job, gated by the release-decision module's verdict
  So that the publish path is reachable ONLY on a green build of "main" and is skipped entirely for a non-main branch or any red gate — still dry-run, nothing published

  # This is the FIRST slice of the "real-npm-publish-on-main" phase. The prior
  # phases proved the "only when green" spine: a pure `decideRelease`
  # (src/core/ci/release-decision.ts) and a thin `release-gate` runner
  # (src/core/ci/release-gate.ts) that today exits 0 on ALLOW / non-zero on DENY,
  # consulted by a main-only step that immediately precedes a same-job
  # `npm publish --dry-run` step in `.github/workflows/ci.yml`.
  #
  # This slice promotes the publish out of that single job into its OWN `publish`
  # job whose reachability is governed by the proven decision — so "the publish
  # job is reachable ONLY when the release-decision module returns ALLOW on main"
  # becomes a structural property of the workflow graph, not just an in-job step
  # order. To do that the release-gate runner additionally emits a machine-readable
  # decision (`release_allowed=true|false`) to GITHUB_OUTPUT; the `ci` job exposes
  # that as a job output; and a separate `publish` job `needs` the `ci` job and is
  # conditioned on that output being `true`.
  #
  # SCOPE: this slice establishes the GATED JOB and the decision-output plumbing
  # only. The publish step inside the new job stays `npm publish --dry-run` — the
  # idempotent already-published guard (`idempotent-version-guard`) and the flip to
  # a real token+provenance publish (`real-npm-publish`) are the later `after`
  # changes in this phase and are out of scope here. `decideRelease`'s core logic
  # is unchanged.

  Background:
    Given the release-decision module decides ALLOW only when the branch is "main" and every wired gate is green
    And the release-gate runner adapts that verdict into a process exit code for the workflow

  Scenario: The release-gate runner emits a machine-readable ALLOW decision for the workflow graph
    Given the build is on the "main" branch with every wired gate green
    When the release-gate runner runs
    Then the decision is ALLOW
    And it writes "release_allowed=true" to the GitHub step output

  Scenario: The release-gate runner emits a machine-readable DENY decision
    Given the build is on the "main" branch with a red wired gate
    When the release-gate runner runs
    Then the decision is DENY
    And it writes "release_allowed=false" to the GitHub step output

  Scenario: The release-gate runner emits a machine-readable DENY decision off main
    Given the build is on a non-main branch with every wired gate green
    When the release-gate runner runs
    Then the decision is DENY
    And it writes "release_allowed=false" to the GitHub step output

  Scenario: The ci job exposes the release decision as a job output
    Given the CI workflow's "ci" job
    When the ci job's outputs are inspected
    Then it exposes a "release_allowed" output sourced from the release-gate step's output

  Scenario: A dedicated publish job is gated on the release decision
    Given the CI workflow
    When the jobs are inspected
    Then there is a separate "publish" job distinct from the "ci" job
    And the publish job needs the "ci" job
    And the publish job runs only when the ci job's "release_allowed" output is "true"

  Scenario: The gated publish job stays a dry-run in this slice
    Given the CI workflow's "publish" job
    When its steps are inspected
    Then it runs the publish path as "npm publish --dry-run"
    And it requires no npm token secret to run
