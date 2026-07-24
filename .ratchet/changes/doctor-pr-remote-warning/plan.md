# doctor-pr-remote-warning

## Why

Phase 2 spawns a PR agent at batch completion that pushes the work branch and
opens a PR (`pr-spawn-at-completion` / `pr-step-apply-wiring`). If the user has
turned PR grouping on but their repo has no configured git remote, that push has
nowhere to go and the batch fails only at the very end — after all the work is
done. `ratchet doctor` already validates the external preconditions for a run
(agent CLI, runtime, docker, playwright); it should also warn, up front, when
`prGrouping` is active but the repo cannot push, so the missing remote is caught
before a completed batch trips over it.

## What Changes

- A new **conditional, advisory** doctor check `pr-remote` is added to the pure
  check engine (`src/core/doctor/`). It is appended to the report **only** when
  `prGrouping` is active (`whole-batch`) **and** the repo has no configured git
  remote; in every other case it is absent from the report entirely — never a
  passing row, never a hidden/skipped row — mirroring how the `playwright` check
  is conditionally appended only when a web binding is in scope.
- When emitted, the check is a non-required warning: `status: 'info'`,
  `severity: 'optional'`, so it renders with the advisory glyph and `(optional)`
  tag and **never** affects doctor's `ok` flag or exit code.
- Silence is guaranteed in two cases: `prGrouping: off` (the default → no output,
  behavior unchanged) and `prGrouping` active with a remote already configured.
- Documents the new check in `docs/commands/doctor.md` and the `README.md`
  doctor line (per the `documentation` standard).
- Implements `features/doctor-pr-remote-warning/warning.feature`.

Not a breaking change: the default `prGrouping` is `off`, so for every existing
project doctor's output is byte-for-byte unchanged.

## Design

**A conditional check, following the established `playwright` precedent.**
`runDoctorChecks(deps, projectRoot)` already conditionally appends the
`playwright` check via a scope predicate (`hasWebBindingInScope(projectRoot)`),
reading real config from disk while the side-effecting probe flows through the
injected `BootstrapDeps`. The `pr-remote` check reuses that exact shape rather
than inventing a new one:

- A new `src/core/doctor/checks/pr-remote.ts` exports
  `checkPrRemote(deps: BootstrapDeps, projectRoot: string): DoctorCheck | null`.
  It returns `null` (→ omitted from the report) whenever doctor should stay
  silent, and a single `DoctorCheck` only in the warn case. Keeping the
  detection and the verdict in one function means exactly one git probe and one
  clear rule for "silent vs. warn."
- `runDoctorChecks` calls it after the existing checks and pushes the result
  only when non-null, so the aggregator stays a pure data-in/data-out function
  and the `pr-remote` row is genuinely absent (not a hidden `pass`) when silent:
  `const pr = checkPrRemote(deps, projectRoot); if (pr) checks.push(pr);`

**Resolving `prGrouping` (scope = project ← default).** The check reads the
effective mode via `resolveBatchSettings(projectRoot).settings.prGrouping` from
`src/core/batch/config.ts` — the same nearest-wins cascade landed by
`pr-grouping-config`, with no manifest scope (doctor is a whole-repo diagnostic,
not a per-change one). An unset setting resolves to `'off'`, so the common case
is silent for free. "Active" means `prGrouping !== 'off'` (today only
`whole-batch`), which stays correct when Phase 3 widens the enum.

**Detecting a configured remote through the `run` seam.** The check probes
`deps.run('git', ['-C', projectRoot, 'remote'])`. A remote is considered
configured iff the command exits `0` **and** its trimmed stdout is non-empty
(`git remote` lists one remote name per line). Any other outcome — non-zero exit
(not a git repo / git absent) or empty output — is treated as "no configured
remote," which is the safe direction for an advisory-only check that never
blocks. Routing through `deps.run` (not a direct `execFileSync`) keeps the check
unit-testable with an in-memory fake, exactly like `checkDocker`.

**Warn verdict shape.** The emitted check is:
`{ id: 'pr-remote', label: 'Git remote (PR grouping)', status: 'info',
severity: 'optional', detail: …, remedy: … }`. Because `isReportOk` only
considers `required` checks, an `info`/`optional` verdict cannot change `ok` or
the exit code — satisfying the "never fails doctor" scenario with no change to
`render.ts` / `exitCodeFor`.

**Forge-agnostic detail and remedy (`generalizable-defaults`).** The check ships
strings into arbitrary user repositories, so they must not name a specific
forge CLI or toolchain. The detail states that `prGrouping` is active but the
repo has no configured git remote to push to; the remedy tells the user to
configure a git remote (e.g. a generic `git remote add <name> <url>` shape),
and deliberately names **no** forge tool (`gh`/`glab`/etc.) — which forge CLI
opens the PR stays entirely out of this check, matching how the whole PR feature
keeps forge specifics out of ratchet. `git` itself is the version-control
substrate the feature is built on, not a leaked build/test toolchain, so naming
"git remote" is appropriate and agnostic.

**Not in scope.** No spawn, engine, lifecycle, or agent-instruction code is
touched — so `delegated-lifecycle`, `multi-agent-support`, and
`instruction-fed-config` do not apply here. This is a pure diagnostic slice: the
warning surfaces a precondition; it does not change how or whether the PR agent
is spawned (that is `pr-spawn-at-completion`).

**Testing (`testing`).** Pure check logic proven at the **unit** layer — no
filesystem repo, no real process — by injecting a fake `BootstrapDeps` whose
`run` returns a scripted `git remote` result, and pointing `projectRoot` at a
tmpdir whose `.ratchet/` config sets `prGrouping`. A new
`test/core/doctor/pr-remote.test.ts` (header names
`features/doctor-pr-remote-warning/warning.feature`) covers the four scenarios:
active + no remote → one `info`/`optional` `pr-remote` check whose
detail/remedy match and whose presence leaves `report.ok === true`;
`prGrouping: off` → no `pr-remote` check; active + remote configured → no
`pr-remote` check. The existing `test/core/doctor/doctor.test.ts` aggregator
test is extended to assert the row is absent by default (behavior unchanged) and
present under an active-grouping/no-remote fixture. Tests use the tmpdir fixture
pattern (`fs.mkdtemp(os.tmpdir())`, cleaned up in `afterEach`), stay isolated
and order-independent, and keep the full suite and the coverage gate green at or
above the enforced `COVERAGE_THRESHOLD`.

**Documentation (`documentation`, mandatory).** `docs/commands/doctor.md` gains a
new `### Git remote (`pr-remote`) — optional, conditional` section describing
when the check appears (active `prGrouping` + no configured remote), its
`info`/`optional` verdict, its detail/remedy, and that it never affects the exit
code; the `## Checks` intro is updated to note this second conditional check
alongside `playwright`. `README.md`'s doctor description is updated to mention
the PR-remote warning. Per this standard, doctor.md documents each check as a
prose Reference section (it carries no Mermaid overview today, matching how the
`playwright` check was added); adding one advisory check to that existing
list is not a new core component/flow, so no new diagram is introduced — the
change keeps the Reference accurate and complete without over-documenting
visually.

## Tasks

- [x] 1.1 Add `src/core/doctor/checks/pr-remote.ts` with
      `checkPrRemote(deps, projectRoot): DoctorCheck | null`: resolve
      `prGrouping` via `resolveBatchSettings(projectRoot)`, return `null` when
      `off`; otherwise probe `deps.run('git', ['-C', projectRoot, 'remote'])`,
      return `null` when a remote is configured (exit 0 + non-empty stdout), and
      otherwise return the `info`/`optional` `pr-remote` warning with a
      forge-agnostic detail and git-remote remedy (`generalizable-defaults`).
- [x] 1.2 Wire the check into `runDoctorChecks` in `src/core/doctor/index.ts`:
      call `checkPrRemote(deps, projectRoot)` after the existing checks and push
      it only when non-null, keeping the aggregator pure.
- [x] 2.1 Add unit tests `test/core/doctor/pr-remote.test.ts` (header naming
      `features/doctor-pr-remote-warning/warning.feature`) covering all four
      feature scenarios via a fake `BootstrapDeps` + tmpdir config fixture, and
      extend `test/core/doctor/doctor.test.ts` to assert the row is absent by
      default and present under active-grouping/no-remote (`testing`).
- [x] 3.1 (`documentation`, mandatory — tag `documentation`) Update
      `docs/commands/doctor.md` with the new `pr-remote` check section and the
      `## Checks` intro, and update `README.md`'s doctor line. Enumerated files:
      `docs/commands/doctor.md`, `README.md`.
