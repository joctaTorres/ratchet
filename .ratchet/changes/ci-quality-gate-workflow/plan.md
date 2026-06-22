# ci-quality-gate-workflow

## Why

The `ci-npx-release` batch ships an npm release pipeline that publishes only when every quality gate is green. The riskiest, most integration-heavy part is the pipeline shape itself, so phase 1 (`gated-release-path-dry-run`) stands up the whole thing end to end as a dry-run. This change is the **first, thinnest slice** of that phase: the CI workflow skeleton — `install -> lint -> test` on push and pull request, where a red lint or test blocks everything downstream (the release path included).

It deliberately does **not** ship the release-decision module or the `npm publish --dry-run` step — those are the next two changes in the phase (`release-decision-module`, then `gated-dry-run-publish`). This slice exists to give them a real, parseable workflow to plug into and to prove the green `install -> lint -> test` spine that gates the entire release path.

## What Changes

- Add `.github/workflows/ci.yml`: a GitHub Actions workflow triggered on `push` and `pull_request`.
- The CI job: checkout -> setup Node/pnpm -> install dependencies (`pnpm install`) -> lint (`pnpm lint`) -> test (`pnpm vitest run` / `pnpm test`), in that order. A non-zero lint or test exit fails the job (default GitHub Actions step semantics), turning the run red and stopping subsequent steps — so the (later-added) release path is never reached on a red build.
- The workflow leaves a clearly marked seam for the main-only release-gate + `npm publish --dry-run` step that `release-decision-module` and `gated-dry-run-publish` will fill in — this change does not add a publish step.
- Add a small, reusable workflow-parsing helper plus tests under `test/ci/` that load `.github/workflows/ci.yml`, parse it with the existing `yaml` dependency, and assert: triggers include `push` and `pull_request`; the job's steps run `install -> lint -> test` in that relative order; the release path (when present) sits after that spine. The later changes reuse this same parser to assert their release-gate step and dry-run publish.
- Implements `features/ci/quality-gate-workflow.feature`.
- Multi-agent surface: **none**. This is CI/build infrastructure (YAML + a parser/test); no agent-specific files, skills, or commands.

## Design

**Thin vertical slice, shared seam.** The phase proof-of-work is `pnpm lint && pnpm vitest run test/ci`. That command spans all three phase-1 changes; this change owns the part that is purely about the workflow's *shape*. Concretely it must make the `test/ci` suite able to (a) find and parse `ci.yml` and (b) assert the `install -> lint -> test` ordering and trigger set. The release-decision assertions and the dry-run-publish assertions are added by the next two changes against the same parsed model.

**Workflow parser (reused downstream).** Add a tiny helper (e.g. `test/ci/helpers/workflow.ts`, or `src/core/ci/workflow.ts` if it belongs in shippable source) that reads `.github/workflows/ci.yml`, parses it with `yaml`, and exposes a structured view: `on` triggers, jobs, and each job's ordered step list (with `run`/`uses`/`name`). Keep it framework-light — just enough structure for ordering and presence assertions. Both `gated-dry-run-publish` (asserting the release-gate step precedes `npm publish --dry-run`) and this change consume it, so design the shape to be extensible without churn.

**Ordering semantics.** "install before lint before test" is asserted on the *index* of the matching steps within the job, not on exact step names — match steps by their `run` command containing `install` / `lint` / `test` (and `uses` for checkout/setup). This keeps the assertion robust to cosmetic naming while still pinning the gate order. Failure semantics (red lint/test blocks downstream) come for free from GitHub Actions' default `success()` step condition; the test asserts the *structure* that guarantees it (no release-path step before the lint/test steps), since a unit test cannot run the real Actions runner.

**Triggers.** `on: [push, pull_request]` so both branch pushes and PRs run the gate. The main-only narrowing for the release path is the next changes' concern, not this one — this workflow runs the install/lint/test spine on every event.

**Trade-offs.** Parsing the YAML and asserting structure (rather than executing the workflow) is the pragmatic proof at this layer: it pins triggers and step order deterministically in CI without a runner-in-runner. The real red/green behavior is exercised for real every time the workflow runs on GitHub — which the batch explicitly wants observable on a real push. Putting the parser under `test/ci/helpers` keeps it out of the shipped package unless a later change needs it in `src`.

## Tasks

- [x] 1.1 Add `.github/workflows/ci.yml` triggered on `push` and `pull_request`, with a job that runs checkout -> setup Node + pnpm -> `pnpm install` -> `pnpm lint` -> test, in that order.
- [x] 1.2 Leave a clearly commented seam after the test step for the main-only release-gate + `npm publish --dry-run` step that later phase-1 changes will add (do not add a publish step here).
- [x] 2.1 Add a workflow-parsing helper under `test/ci/` (using the existing `yaml` dep) that loads `.github/workflows/ci.yml` and exposes triggers, jobs, and ordered steps; shape it for reuse by the later release-gate/publish assertions.
- [x] 2.2 Add `test/ci/quality-gate-workflow.test.ts` asserting: triggers include `push` and `pull_request`; the job runs install -> lint -> test in that relative order; checkout precedes the package steps; any release-path step sits after the install/lint/test spine.
- [x] 3.1 Run `pnpm lint && pnpm vitest run test/ci` locally; confirm lint is clean and the new `test/ci` tests pass (exit 0).
- [x] 3.2 Confirm the change adds no agent-specific branching and no real publish step (dry-run and gating are introduced by `release-decision-module` and `gated-dry-run-publish`).
