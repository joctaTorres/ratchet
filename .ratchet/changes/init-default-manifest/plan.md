# init-default-manifest

## Why

The manifest schema, evaluator, and contributor are all shipped — `eval run` and
batch `verify` already gate on `.ratchet/evals/invariants.yaml` when one exists —
but `ratchet init` writes none. Every project starts with zero anti-gaming
guardrails until someone hand-authors the manifest, so the gate this batch built
is opt-in by omission. This change makes `ratchet init` write one starter
manifest so the gate is real from the first run.

## What Changes

Implements `features/eval-invariants/default-manifest.feature`:

- New `src/core/eval/default-manifest.ts` exporting
  `buildDefaultInvariantManifestYaml(projectRoot)`, returning the manifest text
  `ratchet init` writes:
  - `spec-not-weakened` (monotonic, `active: true`, `measure: scenario-count`) —
    always present and active. It is the one invariant ratchet can evaluate on
    every project unconditionally: the measure comes from ratchet's own run
    state (`run.cases.length`), not from anything stack-specific.
  - `tests-still-exist` (deterministic) — always **inert**
    (`active: false`). When a conventional test directory is detected under the
    project root, it is emitted as live, uncommented YAML with a concrete
    `check.run: test -d <detected-dir>`. When none is detected, it is emitted
    as a commented-out placeholder block instead of a guessed path.
  - `public-api-unchanged` (snapshot) — always **inert** and always a
    commented-out placeholder. A real `produce.run` needs a toolchain-specific
    command (a TS declaration diff, `cargo public-api`, etc.); ratchet cannot
    pick one without assuming a stack, so this entry is never live YAML in the
    default manifest, only a commented shape with multiple per-stack examples
    labeled as choices to pick from.
- New `detectTestDirectory(projectRoot)` helper: checks a small, ecosystem-
  neutral set of conventional directory names (`test`, `tests`, `spec`,
  `__tests__`) for existence under the project root and returns the first
  match or `null`. This is the only "stack detection" this slice adds —
  directory-existence, not language or tool sniffing.
- Wire scaffolding into `InitCommand`: add `.ratchet/evals/` to the directories
  `createDirectoryStructure` ensures, and write `invariants.yaml` with the
  same `'created' | 'exists' | 'skipped'` contract `createConfig` already uses
  — written once on first init, **never overwritten** on a re-run/extend mode,
  so a user's later edits (e.g. flipping an invariant active) are never
  clobbered.
- Documentation: `docs/eval-invariants.md` gains a "Default manifest" section
  replacing its closing note that named this change as the open downstream
  slice; `docs/commands/init.md` and `README.md`'s "What `init` creates" tree
  gain the new `.ratchet/evals/invariants.yaml` output.
- **Non-goal**: detecting or activating `public-api-unchanged` for any
  particular stack. No produce command this slice could pick is generalizable
  enough to ship live and active; the standing per-stack placeholder is the
  permanent shape, not a stopgap to replace later.
- **Non-goal**: broader stack detection (package manager, language, build
  tool) beyond test-directory existence. `generalizable-defaults` requires
  derive-detect-or-require; test-directory existence is the only detection
  this slice can do without assuming an ecosystem.

## Design

**One pure builder, one thin write site.** `buildDefaultInvariantManifestYaml`
is a pure function (project root in, manifest text out) so its output is
unit-testable without touching `InitCommand`. `InitCommand` only decides
*whether* to write (file absent) and calls it — mirroring how `createConfig`
separates `serializeConfig` (pure) from the existence check and write.

**Text-templated, not object-serialized.** The manifest mixes live YAML
entries with commented-out placeholder blocks for the same logical invariant.
Round-tripping typed `Invariant` objects through a YAML serializer cannot
produce a *commented* entry, so the builder composes the file as a template
string: the active `spec-not-weakened` block is always emitted verbatim; the
`tests-still-exist` block branches on `detectTestDirectory`; the
`public-api-unchanged` block is always the commented form. The result is
asserted against the real contract by feeding it through the existing
`loadInvariantManifest` in a test — the generated text must parse with no
error and the loaded set must contain exactly the invariants that are live
(uncommented), all others (commented) absent.

**Never active-but-vacuous, by construction.** Only `spec-not-weakened` is
ever emitted `active: true`; the builder has no branch that sets
`tests-still-exist` or `public-api-unchanged` active regardless of what is
detected. Detection only changes whether the inert scaffold is immediately
usable (uncommented, ready to flip to `active: true` once the user confirms
the check is right) or requires the user to author it themselves
(commented placeholder). This is the literal anti-vacuous guarantee the phase
goal names: activation is always a deliberate, informed user edit, never an
init-time guess.

**Idempotent write, matching `createConfig`'s contract.** `invariants.yaml` is
written only when absent — first init or a project that has never had one. A
re-run (extend mode) or any subsequent `ratchet init` leaves an existing file
untouched, exactly like `config.yaml`. This is required: once a user activates
or edits an invariant, a later `init` must not silently revert it.

**`generalizable-defaults` compliance.** No package manager, test runner,
build tool, language toolchain, or absolute/tool-specific path is ever written
into the manifest. The only command the builder ever emits live is `test -d
<dir>` — a POSIX directory predicate built from a detected *name*, not a
guessed tool invocation. The `public-api-unchanged` placeholder shows several
per-stack examples side by side, explicitly labeled as alternatives to choose
from, so no single ecosystem's command is presented as if it were universal.
This is the one place in the invariant set a toolchain literal could leak —
the prior three changes in this phase explicitly deferred it here — so this
slice is where that compliance is actually proven.

**`multi-agent-support` compliance.** This slice has no agent-facing surface:
it adds no skill, command, or template, and `.ratchet/evals/invariants.yaml`
is written identically regardless of which coding agents are selected during
`init`. There is no per-agent output to enumerate. (`delegated-lifecycle` is
likewise unaffected — no propose/apply/verify skill content changes.)

**`documentation` compliance (mandatory, blocking).**
- `docs/eval-invariants.md`: replace the closing note ("Writing the default
  manifest ... is the separate downstream `init-default-manifest` slice")
  with a "Default manifest" section describing exactly what `ratchet init`
  writes — `spec-not-weakened` active, `tests-still-exist` detected-or-
  commented, `public-api-unchanged` always commented — and why (never
  active-but-vacuous).
- `docs/commands/init.md`: add a behavior step describing the default
  manifest write (and its `created`/`exists`/`skipped` semantics, alongside
  the existing `config.yaml` step), and add
  `evals/invariants.yaml` to the "Directory layout created" tree.
- `README.md`: add `evals/invariants.yaml` to the "What `init` creates" tree.

**`testing` compliance.**
- **Unit** — `default-manifest.test.ts`: `spec-not-weakened` always present
  and active; `tests-still-exist` live with the detected directory name when
  one of the conventional directories exists, commented when none does;
  `public-api-unchanged` always commented; the generated text round-trips
  through `loadInvariantManifest` with no error and the loaded active set is
  exactly `['spec-not-weakened']`; no package-manager/test-runner/build-tool
  literal appears anywhere in the output. `detectTestDirectory` over a tmpdir
  fixture: each conventional name detected, none present returns `null`,
  first match wins when more than one exists.
- **Integration** — `init.test.ts`: a fresh `ratchet init` creates
  `.ratchet/evals/invariants.yaml`; re-running `init` (extend mode) on a
  project with a user-edited `invariants.yaml` leaves it byte-for-byte
  unchanged.
- **E2E** (`test/cli-e2e/`): `ratchet init` on a built CLI in a tmp project
  produces an `invariants.yaml` that a subsequent `ratchet eval run` loads
  without a manifest error.

## Tasks

- [x] 1.1 Add `src/core/eval/default-manifest.ts`: `detectTestDirectory(projectRoot)`
  checking `test`, `tests`, `spec`, `__tests__` for existence (first match,
  `null` if none) and `buildDefaultInvariantManifestYaml(projectRoot)` composing
  the three blocks described in Design. Export both from
  `src/core/eval/index.ts`.
- [x] 1.2 Unit-test `default-manifest.ts` (`test/core/eval/default-manifest.test.ts`,
  header names `features/eval-invariants/default-manifest.feature`): detection
  over a tmpdir fixture (each conventional name, none present, first-match
  precedence); generated text always carries `spec-not-weakened` active;
  `tests-still-exist` live-vs-commented branches on detection; `public-api-
  unchanged` always commented; the generated text loads cleanly through
  `loadInvariantManifest` with the active set exactly `['spec-not-weakened']`;
  assert no toolchain literal (`pnpm`, `npm`, `vitest`, `cargo`, `go test`, etc.)
  appears in the output.
- [x] 2.1 In `src/core/init.ts`: add `path.join(ratchetPath, 'evals')` to the
  directories `createDirectoryStructure` ensures (both extend-mode and
  first-init branches). Add a write step (mirroring `createConfig`'s
  `'created' | 'exists' | 'skipped'` contract) that writes
  `invariants.yaml` via `buildDefaultInvariantManifestYaml(projectPath)` only
  when the file does not already exist; never overwrite.
- [x] 2.2 Extend `test/core/init.test.ts`: a fresh init creates
  `.ratchet/evals/invariants.yaml` with `spec-not-weakened` active; re-running
  init (extend mode) over a project with a user-edited `invariants.yaml`
  leaves the file unchanged byte-for-byte.
- [x] 2.3 E2E: extend the relevant `test/cli-e2e/` init test so a fresh
  `ratchet init` followed by `ratchet eval run` (or `eval set`) on the built
  CLI loads the generated manifest with no manifest error.
- [x] 3.1 **[documentation standard — mandatory, blocking]** Update
  `docs/eval-invariants.md` (replace the closing downstream-note with a
  "Default manifest" section), `docs/commands/init.md` (behavior step +
  directory-layout tree), and `README.md` ("What `init` creates" tree).
  Cross-check no toolchain literal leaks (`generalizable-defaults`).
- [x] 4.1 Run `pnpm build && pnpm vitest run invariant` and the full suite +
  coverage gate; confirm green at or above the enforced `COVERAGE_THRESHOLD`
  (95% floor).
