Feature: Phase proof — re-publishing an already-published version is an idempotent, green SKIP
  As a maintainer
  I want the blackbox publish harness to also prove the idempotent version guard
  So that I can see, end to end, that a new version reaches the (dry-run) publish path while an already-published version is SKIPped without erroring the pipeline

  # This thickens the phase-4 proof-of-work harness, `bash test/e2e/npx-publish.sh`,
  # shipped (as the reachability seed) by `gated-publish-job`. That harness already
  # proves the GATING: the publish path is reachable ONLY when the release-gate
  # runner records `release_allowed=true` on `main`, and a red gate or non-main ref
  # keeps it unreached.
  #
  # This slice adds the IDEMPOTENCY layer on top of the ALLOW path: once the
  # release decision permits publishing, the harness runs the version-guard runner
  # over a FORCED set of already-published versions (captured from GITHUB_OUTPUT
  # exactly as the publish job would), and only when the guard records
  # `should_publish=true` is the dry-run publish path exercised. Crucially, the
  # SKIP case must keep the pipeline GREEN (exit 0) — that is the idempotency
  # guarantee the phase requires.
  #
  # SCOPE for THIS slice: the already-published set is FORCED via environment — no
  # real registry is queried and nothing is uploaded (the publish stays
  # `npm publish --dry-run`). The real registry query and the real
  # token+provenance publish with an `npx ratchet --version` assertion against the
  # published CLI are the later `real-npm-publish` change.

  Scenario: A new version on a green main reaches the dry-run publish path
    Given the package is built
    And the release gate ALLOWs on "main" with every wired gate green
    And the local version is not among the already-published versions
    When the version-guard runner is executed and its step output is captured
    Then the version guard records "should_publish=true"
    And the dry-run publish path is exercised and nothing is published
    And the pipeline exits zero

  Scenario: An already-published version is SKIPped without erroring the pipeline
    Given the package is built
    And the release gate ALLOWs on "main" with every wired gate green
    And the local version is already among the already-published versions
    When the version-guard runner is executed and its step output is captured
    Then the version guard records "should_publish=false"
    And the dry-run publish path is not reached
    And the pipeline still exits zero so the re-run is idempotent
