# npm-trusted-publishing

## Why

The gated `publish` job authenticates to npm with a long-lived `NPM_TOKEN` repository secret. Since npm's December 2025 token changes, a write-capable granular token lasts at most 90 days (7 by default). It also needs "bypass 2FA" ticked, which is off by default, and npm is targeting January 2027 to end direct publishing with bypass-2FA tokens. A token-based publish path will keep expiring silently. Moving the job to npm **trusted publishing** (GitHub OIDC) removes the stored credential entirely.

No release has gone out since `0.1.0-beta.3` (2026-07-02), and `main` still carries that version. Every `main` run since then has hit the version guard's SKIP (`version "0.1.0-beta.3" is already published`), so the token has not been used since July. Bumping to `0.1.0-beta.4` in this change ships a release and proves the new auth path on its first run.

## What Changes

- `.github/workflows/ci.yml`, `publish` job:
  - Add a step that installs npm `^11.5.1` globally (the minimum npm CLI for trusted publishing) after `Setup Node.js` and before the publish step.
  - Remove `env: NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` from the `Publish to npm (provenance)` step. No executable line of the workflow references `NPM_TOKEN` any more.
  - Keep `permissions: id-token: write` / `contents: read`. `id-token: write` now serves both the OIDC token exchange and provenance. Rewrite the comments that describe token auth so they describe trusted publishing instead.
  - Keep `npm publish --provenance --access public --tag <resolved>`, both fail-closed gates, the version guard, and the dist-tag resolver unchanged.
- `test/ci/real-npm-publish.test.ts`: replace the "authenticated from the NPM_TOKEN secret" block with trusted-publishing assertions (no `NODE_AUTH_TOKEN` env on the publish step, no `secrets.NPM_TOKEN` in executable YAML, npm 11 install step ordered before publish).
- `test/ci/dry-run-publish-wiring.test.ts`: invert `wires the npm auth token for the publish path`, which currently requires `NODE_AUTH_TOKEN` and `secrets.NPM_TOKEN`, into an assertion that neither appears in executable YAML.
- `package.json`: bump `version` from `0.1.0-beta.3` to `0.1.0-beta.4`.
- `src/core/ci/README.md`: update the `publish` job paragraph (token auth → trusted publishing).
- New Reference doc `docs/engine/release-publish.md` for the publish job.
- Features: `features/ci/real-npm-publish.feature` fully replaces the store copy. The scenario "The publish job is authenticated by the npm token secret" is replaced by "…authenticates through npm trusted publishing, not a stored token" and "…runs an npm CLI that supports trusted publishing". The permissions scenario is reworded to cover OIDC. All other scenarios are carried over unchanged.

## Design

**Auth mechanism.** In GitHub Actions, npm CLI ≥ 11.5.1 requests an OIDC ID token, which the job's `id-token: write` permission makes available. It exchanges that token with the registry for a short-lived publish credential. The registry accepts the exchange only if `ratchet-ai` has a matching trusted-publisher configuration on npmjs.com (owner `joctaTorres`, repository `ratchet`, workflow filename `ci.yml`, no environment). Trusted publishing also generates provenance automatically. `--provenance` stays on the command because it is harmless and keeps the existing provenance assertion meaningful.

**Why upgrade npm in the job.** `setup-node` with `node-version: 22` ships npm 10.x, which has no OIDC support. A dedicated `npm install -g npm@^11.5.1` step runs before publish. A caret range is used instead of `@latest`, so a future npm major can't change publish behavior without review.

**`registry-url` stays.** `actions/setup-node` with `registry-url: https://registry.npmjs.org` writes the `.npmrc` registry line that npm's own trusted-publishing example relies on. Only the `NODE_AUTH_TOKEN` env is removed. The comment on `registry-url` is rewritten because it currently claims to exist so that `NODE_AUTH_TOKEN` is honored.

**No token fallback.** The step deliberately sets no `NODE_AUTH_TOKEN`. A leftover secret fallback would let a stale or over-scoped token keep working unnoticed, which is the failure this change removes. Docs and comments must state trusted publishing as the only auth path ("no lying security controls").

**Permitted event.** The job runs on `push` to `main`, an event npm accepts for trusted publishing. `pull_request_target` and `issue_comment` are rejected by npm, and the workflow uses neither. `pull_request` runs never reach `publish` because the main-only gate blocks them.

**48-hour validation window (rollout ordering).** Since 2026-10-02, a trusted-publisher configuration with no successful publish expires 48 hours after it is created. So the npmjs.com configuration must be created **no earlier than 48 hours before** this change merges to `main`. The beta.4 bump makes the merge run publish immediately, which validates the configuration on its first run. If the configuration is missing or expired, the publish step fails with an auth error, the `publish` job goes red, and the pipeline does not publish. The fix is to recreate the configuration and re-run the job; the version guard keeps that re-run idempotent.

**Security classification (security-remediation standard).** This change hardens credential handling. It does not remediate a known severe or high exposure: there was no leak, only a credential whose design forces expiry and rotation. Material requirements, each mapped to a task:
1. No long-lived npm credential is referenced by the workflow (2.1, 3.1, 3.2).
2. No silent token fallback remains on the publish path (2.1, 3.1).
3. The old `NPM_TOKEN` is revoked on npmjs.com and its repository secret deleted (6.3).
4. Operator-facing docs and comments describe the real auth path (2.3, 4.1, 4.2).

Nothing is deferred.

**Testing (testing standard).** The workflow is proven structurally at the unit layer through the existing `test/ci/helpers/workflow.ts` parsed-workflow model, the same approach as every other `test/ci` test. GitHub Actions can't be executed in a unit test. No integration or E2E layer applies. Test headers name `features/ci/real-npm-publish.feature`. Coverage is unaffected because no `src/` logic changes.

**Documentation (documentation standard).** No `docs/` page currently covers the publish path. `docs/engine/release-publish.md` is added as a Reference entry (sidebar position 5, beside `coverage-gate.md`). It has an `## Overview` with a vertical, high-contrast Mermaid flowchart of the publish path: gates → version guard → dist-tag → npm upgrade → OIDC publish. That is a core flow, so the diagram is mandatory. The page also has one section per publish-job step and a section listing the npmjs.com trusted-publisher fields. `README.md` describes only installing `ratchet-ai@beta` and nothing about the publish path. The install instructions stay correct because beta.4 publishes under the `beta` dist-tag, so README needs no edit, and the task records that check.

**Out of scope.** The archived dry-run-era features (`gated-publish-job.feature`, `idempotent-version-guard.feature`, `dry-run-publish-wiring.feature`) already describe a superseded dry-run state and are not rewritten here.

## Tasks

### 1. Feature contract

- [x] 1.1 Confirm `features/ci/real-npm-publish.feature` in this change is a full replacement of `.ratchet/features/ci/real-npm-publish.feature`: every scenario except the token-auth one is carried over unchanged, and the token-auth scenario is replaced by the two trusted-publishing scenarios.

### 2. Workflow

- [x] 2.1 In `.github/workflows/ci.yml` `publish` job, remove the `env: NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` block from the `Publish to npm (provenance)` step; keep its `if:` and `run:` unchanged.
- [x] 2.2 Add a step `Upgrade npm for trusted publishing` running `npm install -g npm@^11.5.1`, placed after `Setup Node.js` and before `Publish to npm (provenance)`.
- [x] 2.3 Rewrite the workflow comments that describe `NPM_TOKEN`/`NODE_AUTH_TOKEN` auth (the job header block, the `permissions` comment, the `registry-url` comment, the publish-step comment) so they describe trusted publishing via OIDC; no comment may claim token auth.

### 3. Tests (testing standard, unit layer)

- [x] 3.1 In `test/ci/real-npm-publish.test.ts`, replace the `the publish is authenticated from the NPM_TOKEN secret` block with a `trusted publishing` block asserting: the publish step's `env` has no `NODE_AUTH_TOKEN`; comment-stripped workflow source contains no `secrets.NPM_TOKEN` and no `NODE_AUTH_TOKEN`; the publish `run` carries no `_authToken`/`npm_token=` literal. Update the file header to describe trusted publishing and name `features/ci/real-npm-publish.feature`.
- [x] 3.2 In the same file, assert a publish-job step whose `run` matches `npm install -g npm@^?11` exists and its index is less than the `npm publish` step's index.
- [x] 3.3 Update the permissions test description to cover OIDC (assertions unchanged: `id-token: write`, `contents: read`).
- [x] 3.4 In `test/ci/dry-run-publish-wiring.test.ts`, change `wires the npm auth token for the publish path` to assert the comment-stripped workflow does NOT match `NODE_AUTH_TOKEN` or `secrets\.NPM_TOKEN`, and rename its `describe` from "authenticated from the npm token secret" to trusted-publishing wording.
- [x] 3.5 Run `pnpm vitest run test/ci` and then the full `pnpm lint && pnpm vitest run`; all green.

### 4. Documentation (documentation standard, mandatory)

- [x] 4.1 Create `docs/engine/release-publish.md` (Reference, `sidebar_position: 5`) with: an `## Overview` containing a vertical `flowchart TD` Mermaid diagram of the publish path (release gate → `publish` job gate → version guard → dist-tag → npm ≥11.5.1 → OIDC exchange → `npm publish --provenance`), every `classDef` setting `color:`, semantic symbols on nodes; one section per `publish`-job step; a "Trusted publisher configuration" section listing the npmjs.com fields (publisher GitHub Actions, owner `joctaTorres`, repository `ratchet`, workflow `ci.yml`, environment empty, Allowed actions `npm publish` on and `npm dist-tag` off) and the 48-hour validation rule; and a statement that no npm token secret is used.
- [x] 4.2 Update the `publish` job paragraph in `src/core/ci/README.md` to state authentication is npm trusted publishing (OIDC via `id-token: write`, npm ≥ 11.5.1), with no `NPM_TOKEN` secret, and link `docs/engine/release-publish.md`.
- [x] 4.3 Check `README.md` for any publish-path or token description; record in the PR that none exists and the `ratchet-ai@beta` install instructions remain correct (no README edit), or update it if one is found.

### 5. Release

- [x] 5.1 Bump `package.json` `version` from `0.1.0-beta.3` to `0.1.0-beta.4`.
- [x] 5.2 Run `pnpm build && node dist/core/ci/dist-tag.js` and confirm it prints `beta`.

### 6. Maintainer steps outside the repo (manual; record completion in the PR)

- [x] 6.1 Within 48 hours before merging, on npmjs.com → `ratchet-ai` → Settings → Trusted Publisher, add a GitHub Actions publisher: owner `joctaTorres`, repository `ratchet`, workflow filename `ci.yml`, environment blank, Allowed actions = **`npm publish`** ticked (configurations created after 2026-09-03 default to stage-only, which would leave CI's direct `npm publish` unauthorized), `npm dist-tag` left unticked (the workflow sets the tag via `npm publish --tag`, never `npm dist-tag`).
- [ ] 6.2 After merge, confirm the `main` run's `Publish to npm (provenance)` step succeeded and `npm view ratchet-ai@0.1.0-beta.4 version` prints `0.1.0-beta.4` (provenance badge visible on the npm package page).
- [ ] 6.3 After 6.2 succeeds, revoke the old `NPM_TOKEN` granular token on npmjs.com and delete the `NPM_TOKEN` repository secret on GitHub; optionally set the package's publishing access to "Require two-factor authentication and disallow tokens".
