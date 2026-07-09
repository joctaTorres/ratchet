# restrict-manifest-permission-escalation

## Why

`full-autonomy` maps to each agent's strongest bypass flag (claude
`--dangerously-skip-permissions`, gemini `--yolo`, …) and drops the baseline
destructive-op denylist, yet `resolvePermissionsPolicy` resolves posture
nearest-wins across every scope — including the repo-committed per-batch
manifest. Cloning a repo whose `batch.yaml` sets
`permissions.posture: full-autonomy` and running `ratchet batch apply` silently
runs an unconstrained agent with no confirmation and no visible escalation
notice. The manifest is repo-author-controlled, not operator-controlled, so it
must never be able to raise the posture on its own. Fixes #87 (confirmed OPEN
and unfixed at decompose, 2026-07-09).

## What Changes

Implements `features/manifest-permission-scope/*.feature`:

- Permission-policy resolution clamps the **manifest** layer's posture: it may
  only NARROW (lower posture; its `deny` additions still union), never raise
  posture above the value resolved from the default/user/project layers
  (`narrow-only-resolution.feature`). Operator-owned user/project scopes keep
  their existing raise ability.
- A suppressed manifest raise is reported in the resolution result so callers
  can surface it instead of hiding it.
- `ratchet batch apply` gains an explicit `--allow-manifest-escalation` flag —
  the only way a manifest-raised posture takes effect. Without it, a headless
  run proceeds under the clamped posture and prints a warning naming the
  requested posture, the flag, and the operator-owned config scopes as the
  legitimate ways to raise it (`escalation-opt-in.feature`).
- `batch apply` prints the effective posture and its source scope at the start
  of every human-readable run; `--json` runs suppress the banner line
  (`apply-posture-banner.feature`).
- **BREAKING** (behavioral): a committed manifest that previously escalated a
  run to `full-autonomy` now runs at the operator-scope posture unless the
  operator passes `--allow-manifest-escalation` or raises posture in their own
  user/project config.

## Design

**Posture privilege ranking** (`src/core/batch/permissions-policy.ts`): export
a ranking `curated-allowlist (0) < repo-sandboxed-permissive (1) <
full-autonomy (2)` next to `PERMISSION_POSTURE_VALUES` so "raise" vs "narrow"
has exactly one definition. Pure data, unit-testable.

**Clamp at the merge seam** (`src/core/batch/config.ts`):
`resolvePermissionsPolicy(layers, options?)` gains
`options.allowManifestEscalation` (default `false`). In the existing low→high
fold, when the `manifest` layer's posture ranks ABOVE the posture accumulated
from the lower layers (default/user/project) and escalation is not allowed,
the posture assignment is skipped — posture and `postureSource` keep the
operator-scope values — and the return value carries
`suppressedEscalation: { scope: 'manifest', requested }`. A manifest posture at
or below the accumulated rank applies unchanged (narrowing stays allowed, and
`postureSource` becomes `manifest`, keeping `batch config` attribution
truthful). Deny-union, allow replace-by-nearest, and `raw` semantics are
untouched — the manifest's `deny` additions still land even when its posture
raise is refused. Only the `manifest` scope is clamped: user/project config is
operator-owned by definition, which is the trust boundary #87 draws. This is a
data-only change to a pure function — agent-neutral by construction
(`multi-agent-support`): the per-agent flag translator downstream sees only the
resolved posture, so no agent is special-cased.

**Threading** : `resolveBatchSettings(projectRoot, manifest?, options?)`
forwards `allowManifestEscalation` and exposes the suppression on
`ResolvedBatchSettings` (e.g. `suppressedEscalation`). All existing callers
(`batch config`, defaults resolution) pass no options and keep today's
narrow-by-default behavior — the safe direction.

**Apply surface** (`src/commands/batch/apply.ts`, `src/cli/index.ts`):
`batch apply` registers `--allow-manifest-escalation` (Commander maps it to
`BatchApplyOptions.allowManifestEscalation`) and passes it into
`resolveBatchSettings`. Immediately after resolution, before step selection,
the command prints a one-line banner `permissions: <posture> (<source> scope)`
(chalk-dim, matching existing output style) and — when a manifest raise was
suppressed — a chalk-yellow warning naming the requested posture and both
remediations. `--json` runs print neither line (JSON payload shapes stay
unchanged; this keeps the slice thin and machine consumers unbroken). The
engine, step selection, and lifecycle instructions are untouched — the CLI
stays a mechanical orchestrator (`delegated-lifecycle`); no lifecycle prose or
done-rule changes.

**Trade-offs / residuals**: the manifest can still add `allow` entries
(replace-by-nearest) under a non-raised posture, and `phase.proofOfWork.run`
remains manifest-supplied code execution — both are documented residuals of
#87, out of this thin slice. No confirmation prompt is added: `batch apply` is
headless by design, so the flag IS the explicit one-time confirmation and the
flagless refusal IS the headless refusal the issue requires.

**Testing** (`testing` standard): the new suite lives at
`test/batch-engine/manifest-permission-escalation.test.ts` (the phase
proof-of-work runs `npm test -- test/batch-engine/`), with the `.feature` files
named in the test header. Resolution-clamp scenarios are pure unit tests over
in-memory layers (no filesystem); the flag/banner scenarios are integration
tests over `batchApplyCommand` using the established
`fs.mkdtemp(os.tmpdir())` fixture pattern with a minimal `.ratchet/` tree,
cleaned in `afterEach`, asserting the committed-`batch.yaml`
`full-autonomy`-vs-project-`repo-sandboxed-permissive` case cannot silently
escalate. Existing suites touching `resolvePermissionsPolicy` /
`resolveBatchSettings` (`test/core/batch/config.test.ts`,
`test/batch-engine/agent-permissions.test.ts`,
`test/batch-engine/permission-flags-in-argv.test.ts`) are updated for the new
return shape and stay green; the coverage gate stays at or above the enforced
threshold.

**Documentation** (`documentation` standard): reference docs change in the same
change — `docs/configuration/config-yaml.md` (the `batch.permissions` merge
semantics: posture is nearest-wins across operator scopes but manifest-scope
posture is narrow-only, plus the suppression behavior) and
`docs/commands/batch.md` (the `--allow-manifest-escalation` flag and the
posture banner). Any existing diagram depicting the permissions merge is
updated if the clamp makes it stale. `README.md` is updated only if it
describes an affected surface (its command table row for `batch apply`).

## Tasks

- [x] 1.1 Add the posture privilege ranking (curated-allowlist < repo-sandboxed-permissive < full-autonomy) to `src/core/batch/permissions-policy.ts`
- [x] 1.2 Clamp the manifest layer's posture raise in `resolvePermissionsPolicy` behind an `allowManifestEscalation` option and return the suppressed-escalation report (`narrow-only-resolution.feature`)
- [x] 1.3 Thread `allowManifestEscalation` through `resolveBatchSettings` and expose the suppression on `ResolvedBatchSettings`
- [x] 2.1 Register `--allow-manifest-escalation` on `batch apply` in `src/cli/index.ts` and `BatchApplyOptions`, passing it into settings resolution (`escalation-opt-in.feature`)
- [x] 2.2 Print the effective-posture banner and the suppressed-escalation warning at the start of `batchApplyCommand`, suppressed under `--json` (`apply-posture-banner.feature`, `escalation-opt-in.feature`)
- [x] 3.1 Add `test/batch-engine/manifest-permission-escalation.test.ts` covering all narrow-only-resolution scenarios as pure unit tests, including the committed `batch.yaml` `full-autonomy` vs project `repo-sandboxed-permissive` silent-escalation assertion
- [x] 3.2 Add integration tests in the same suite for the `--allow-manifest-escalation` flag, the refusal warning, and the posture banner over `batchApplyCommand` with the tmpdir fixture pattern
- [x] 3.3 Update existing suites touching the resolution seam (`test/core/batch/config.test.ts`, `test/batch-engine/agent-permissions.test.ts`, `test/batch-engine/permission-flags-in-argv.test.ts`) for the new return shape; full suite and coverage gate green
- [x] 4.1 Documentation (`documentation` standard, mandatory): update `docs/configuration/config-yaml.md` permissions-merge semantics and `docs/commands/batch.md` (`--allow-manifest-escalation`, posture banner), refresh any stale permissions-merge diagram, and update `README.md` where it describes an affected surface
- [x] 5.1 Run `npm test -- test/batch-engine/` (phase proof-of-work) and the full suite; confirm exit code 0
