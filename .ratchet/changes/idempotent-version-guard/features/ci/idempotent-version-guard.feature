Feature: An idempotent version guard skips publishing an already-published version without erroring
  As a maintainer of the ratchet package
  I want the publish job to consult a version guard before publishing
  So that re-running the pipeline on a version that is already on the registry is a clean no-op (SKIP) rather than a hard error — the release is idempotent

  # This is the SECOND slice of the "real-npm-publish-on-main" phase, after
  # `gated-publish-job` shipped the dedicated, gated `publish` job (still
  # `npm publish --dry-run`). That job is reachable ONLY when the proven
  # `decideRelease` returns ALLOW on `main`.
  #
  # The phase success criteria require the release to be IDEMPOTENT: "a re-run of
  # an already-published version does not error the pipeline". `npm publish` of a
  # version that already exists on the registry fails with a non-zero exit
  # (E409 / "cannot publish over the previously published versions"), which would
  # turn a perfectly green re-run RED. This slice adds the guard that makes that
  # case a deliberate, green SKIP.
  #
  # It mirrors the proven spine pattern exactly:
  #   - a PURE decision module — `decidePublishVersion({ version, publishedVersions })`
  #     in src/core/ci/version-decision.ts — answers SKIP (version already
  #     published) vs PUBLISH (new version), with no I/O;
  #   - a thin IMPURE runner — src/core/ci/version-guard.ts — gathers the local
  #     version and the set of already-published versions, calls the pure module,
  #     writes a machine-readable `should_publish=true|false` to GITHUB_OUTPUT, and
  #     ALWAYS exits 0 (a SKIP must never error the pipeline);
  #   - the `publish` job runs the guard step, then conditions the actual publish
  #     step on `should_publish == 'true'` — an already-published version skips the
  #     publish step while the job (and pipeline) stays green.
  #
  # SCOPE: the set of already-published versions is FORCED via environment (like
  # the GATE_* signals are), keeping the guard deterministic and side-effect-free.
  # The real registry query (`npm view ... versions`) and the flip to a real
  # token + provenance publish (with `npx ratchet --version` against the published
  # CLI) are the later `real-npm-publish` change and are OUT OF SCOPE here. The
  # publish step stays `npm publish --dry-run`. `decideRelease` is untouched.

  Background:
    Given the publish job is reachable only when the release decision is ALLOW on "main"
    And the package declares a local version in package.json

  Scenario: A new version is decided PUBLISH
    Given the local version is not present in the set of already-published versions
    When the version guard decides
    Then the outcome is PUBLISH
    And the reason set is empty

  Scenario: An already-published version is decided SKIP
    Given the local version is already present in the set of already-published versions
    When the version guard decides
    Then the outcome is SKIP
    And the reason explains the version is already published

  Scenario: The guard runner emits should_publish=true for a new version
    Given the local version is not among the already-published versions
    When the version-guard runner runs
    Then it writes "should_publish=true" to the GitHub step output
    And it exits zero

  Scenario: The guard runner emits should_publish=false for an already-published version
    Given the local version is among the already-published versions
    When the version-guard runner runs
    Then it writes "should_publish=false" to the GitHub step output
    And it exits zero so the pipeline is not errored

  Scenario: The publish job runs the version guard before the publish step
    Given the CI workflow's "publish" job
    When its steps are inspected
    Then a version-guard step exposes a "should_publish" output
    And the publish step runs only when "should_publish" is "true"

  Scenario: The publish step stays a dry-run in this slice
    Given the CI workflow's "publish" job
    When its publish step is inspected
    Then it runs the publish path as "npm publish --dry-run"
    And it requires no npm token secret to run
