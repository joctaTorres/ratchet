# open-source-engine

## Why

The batch engine was built as a separate, licensed package to protect it as IP.
That decision has been reversed: the whole project ships under **MIT**. With no
license to enforce, the machinery that existed only to support a separately-sold
engine — the license layer, the optional dynamic import, and "engine-absent" as
a first-class state — is now dead weight. This change removes all of it and
folds the engine into the main package so `ratchet batch apply` just works for
everyone.

This change **supersedes** the licensing and engine-absent behavior specified in
the `batch-engine` and `batch-orchestration` changes; those changes remain as
the historical record of what was originally designed (they are not edited).

## What Changes

- **BREAKING (vs the in-flight design): the licensed engine is gone.** No
  `RATCHET_LICENSE_KEY`, no license manager, no authorization service, no signed
  run-authorization or offline-grace lease. The engine executes steps directly.
- **Engine folded into the main `ratchet` package.** The `@ratchet/batch-engine`
  workspace package is removed; its source moves under the main package
  (`src/core/batch/engine/`). `batch apply` runs the engine in-process.
- **Engine-absent state and its plumbing removed.** Delete the optional
  dynamic-import bootstrap, the `loadBatchEngine`/`registerBatchEngine`
  registry, and the "engine is not installed / activate" messaging. `batch apply`
  calls the engine directly.
- **MIT license added.** Root `LICENSE` (MIT); `license: "MIT"` in package
  metadata.
- **Tests reworked** to the new reality: drop the license tests, the
  engine-install helper, and the engine-present/absent e2e split; keep and adapt
  the engine behavior + lifecycle tests.
- **Opportunistic fix (review #1):** thread the phase's real `success` criteria
  into the llm-judge proof-of-work request (was incorrectly using
  `proofOfWork.pass`). Now that the engine is being moved, fix it in passing.

Note: review finding #2 (license key leaked via forwarded `process.env`) is
**dissolved** by this change — there is no license key to leak.

## Design

**Fold, don't reinvent.** The engine logic (single-step executor, agent
adapter, transitions, proof-of-work, halt/resume, run-state, lock) is sound and
stays as-is behaviorally. It moves from `packages/batch-engine/src/*` into the
main package under `src/core/batch/engine/*`, with imports rewired from the
`ratchet` package specifier to relative paths. The `BatchEngine` contract
(`src/core/batch/engine.ts`) collapses from a runtime-registered seam into a
direct internal type/entry point: `batch apply` constructs the resolved step
context and calls the engine function directly.

**Delete the optional-load seam.** `src/core/batch/engine-bootstrap.ts`, the
`ENGINE_PACKAGE` dynamic import, the registry singleton, and the
absent/version-mismatch branches in `src/commands/batch/apply.ts` are removed.
The contract-version check is unnecessary in-package and goes away (or becomes a
plain internal call). `src/core/index.ts` re-exports are simplified.

**Remove licensing end to end.** Delete `license.ts` and its tests; remove the
authorize-before-spawn call and the env forwarding of any key in the engine's
spawn path; the engine's only failure modes are real execution errors (agent
crash, proof-of-work failure) which still surface as blocked/failed and stay
resumable.

**Build + packaging.** Revert the engine-package build step in `build.js`;
remove `packages/batch-engine/` (package.json, tsconfig, dist) and its
`pnpm-workspace.yaml` entry; regenerate `pnpm-lock.yaml`. The main build emits
the engine as part of `dist/`.

**Tests.** Remove `test/helpers/engine-install.ts`, `test/batch-engine/
license.test.ts`, and the engine-present/absent e2e that exercised the separate
package; relocate the remaining `test/batch-engine/*` to import the engine from
its new in-package path; drop license-lease/refuse-before-spawn assertions from
`engine-flow.test.ts` and keep the genuine behavior tests; the bundled-engine
e2e simply asserts `batch apply` reaches/executes the engine with no install.

**Proof-of-work success fix.** In the (moved) proof-of-work module, the
`llm-judge` request is built with the phase `success` criteria from the resolved
step context, not `proofOfWork.pass`. Add/adjust a test asserting the judge
receives the phase success criteria.

## Tasks

- [x] 1.1 Add root `LICENSE` (MIT) and set `license: "MIT"` in the root package.json
- [ ] 2.1 Remove the licensing code: delete `license.ts`, the authorize-before-spawn call in the engine, and any license-key env reads/forwarding in the spawn path
- [ ] 2.2 Delete license tests and any license-specific assertions in other tests
- [ ] 3.1 Move the engine source from `packages/batch-engine/src/*` into the main package (`src/core/batch/engine/*`); rewire `ratchet`-specifier imports to relative paths
- [ ] 3.2 Remove the `packages/batch-engine` package (package.json, tsconfig, dist), its `pnpm-workspace.yaml` entry; regenerate `pnpm-lock.yaml`
- [ ] 3.3 Revert the engine-package build step in `build.js` so the engine builds as part of the main `dist/`
- [ ] 4.1 Collapse the `BatchEngine` contract into a direct internal entry point; remove `engine-bootstrap.ts`, the dynamic import, the register/load registry, and the contract-version-mismatch path
- [ ] 4.2 Update `src/commands/batch/apply.ts` to call the engine directly; remove the engine-absent and install/activate messaging; simplify `src/core/index.ts` re-exports
- [ ] 5.1 Remove `test/helpers/engine-install.ts` and the engine-present/absent e2e split; replace with a bundled-engine e2e asserting `batch apply` executes with no separate install
- [ ] 5.2 Relocate remaining `test/batch-engine/*` to import the engine from its new in-package path; drop license-lease/refuse-before-spawn assertions, keep genuine behavior tests
- [ ] 6.1 Fix the proof-of-work llm-judge request to use the phase `success` criteria from the step context (not `proofOfWork.pass`); add a test asserting it
- [ ] 7.1 Update the PR #10 description / any README mention to reflect MIT + bundled engine (no licensing, no separate install)
- [ ] 8.1 Confirm `pnpm build && pnpm test && pnpm lint` green; confirm no license/activation strings remain (grep) and no `@ratchet/batch-engine` references linger
