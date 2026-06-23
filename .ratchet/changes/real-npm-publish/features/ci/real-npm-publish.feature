Feature: A green build on main performs a REAL provenance publish behind the proven gates
  As a maintainer of the ratchet-ai package
  I want CI to actually publish the package to the npm registry (with provenance) on a green push to "main"
  So that end users can run the freshly published CLI via npx — while every quality gate and the main-only rule still strictly govern whether anything is published

  # This is the FINAL slice of the "real-npm-publish-on-main" phase. The prior
  # slices proved the full publish path as a SAFE DRY-RUN:
  #   - `gated-publish-job` promoted the publish into its own `publish` job that
  #     `needs: [ci]` and runs only when `needs.ci.outputs.release_allowed == 'true'`
  #     (the unit-tested `decideRelease` verdict, ALLOW only on `main` with every
  #     wired gate green), and
  #   - `idempotent-version-guard` added a `version-guard` step whose
  #     `should_publish` output gates the publish step, so an already-published
  #     version is a green SKIP rather than a hard E409 error.
  # In both, the publish step was `npm publish --dry-run` — nothing was ever
  # released, and no npm token or provenance permission existed.
  #
  # This slice FLIPS that proven dry-run into a REAL release, and NOTHING about the
  # gating changes:
  #   - the publish step becomes a real `npm publish` with provenance and public
  #     access, authenticated by an `NPM_TOKEN` repository secret;
  #   - the `publish` job is granted `id-token: write` permission so npm can mint a
  #     provenance attestation, with `contents: read` kept minimal;
  #   - the version guard's already-published set is sourced from a REAL registry
  #     query (`npm view ratchet-ai versions`) instead of a forced env list, so the
  #     idempotency decision reflects what is actually on the registry — while the
  #     `PUBLISHED_VERSIONS` env override is PRESERVED so tests and the staged
  #     proof stay deterministic and offline.
  #
  # The two fail-closed gates from earlier slices are UNCHANGED and still both
  # apply in series: the job-level release gate (`release_allowed == 'true'`) and
  # the step-level version guard (`should_publish == 'true'`). A red lint, test,
  # coverage, e2e, or security signal — or any non-main ref — must still result in
  # NO publish. `decideRelease`, `WIRED_GATES`, and `decidePublishVersion` are
  # untouched: this slice swaps a data SOURCE and the publish COMMAND, not any
  # decision logic.
  #
  # NOTE on naming: the package is `ratchet-ai` and exposes the `ratchet` bin, so
  # the registry query targets `ratchet-ai` and end users invoke the published CLI
  # as `npx ratchet-ai --version` (which runs the `ratchet` bin).

  Background:
    Given the package is named "ratchet-ai" and exposes a "ratchet" bin
    And the publish job is reachable only when the release decision is ALLOW on "main"
    And the publish step is reached only when the version guard reports should_publish == "true"

  Scenario: The publish job performs a real provenance publish (no dry-run)
    Given the CI workflow's "publish" job
    When its publish step is inspected
    Then it runs "npm publish" without "--dry-run"
    And it publishes with provenance enabled
    And it publishes with public access

  Scenario: The publish job is authenticated by the npm token secret
    Given the CI workflow's "publish" job
    When its publish step is inspected
    Then the publish is authenticated from an "NPM_TOKEN" repository secret
    And no token value is hard-coded in the workflow

  Scenario: The publish job is granted provenance permissions
    Given the CI workflow's "publish" job
    When its permissions are inspected
    Then it is granted "id-token: write" so npm can mint a provenance attestation
    And "contents" permission is kept at "read"

  Scenario: The real publish stays behind BOTH proven gates
    Given the CI workflow's "publish" job
    When its gating is inspected
    Then the job still needs the "ci" job
    And the job still runs only when the ci job's "release_allowed" output is "true"
    And the real publish step still runs only when "should_publish" is "true"

  Scenario: The version guard sources the already-published set from the real registry
    Given the version guard is asked which versions are already published
    And the PUBLISHED_VERSIONS override is not set
    When it resolves the already-published set
    Then it queries the npm registry for the published versions of "ratchet-ai"
    And it feeds that set into the unchanged decidePublishVersion module

  Scenario: A brand-new package with no published versions still publishes the first release
    Given the registry has no published versions for "ratchet-ai" yet
    When the version guard resolves the already-published set
    Then the set is empty
    And the local version is decided PUBLISH

  Scenario: The PUBLISHED_VERSIONS override still wins over the registry query
    Given the PUBLISHED_VERSIONS override lists the local version
    When the version guard resolves the already-published set
    Then the override is used instead of querying the registry
    And the local version is decided SKIP

  Scenario: A registry query that fails ambiguously does not error the pipeline and does not republish
    Given the PUBLISHED_VERSIONS override is not set
    And the registry query fails for a reason other than "package not found"
    When the version guard runs
    Then it does not publish (it fails safe toward SKIP)
    And it still exits zero so the pipeline is not errored
