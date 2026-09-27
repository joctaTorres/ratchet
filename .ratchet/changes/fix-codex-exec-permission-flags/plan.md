# fix-codex-exec-permission-flags

## Why

`ratchet batch apply` cannot start a `codex` agent under any permission posture
(issue #114). The codex mapper in `src/core/batch/runtime/agent-permissions.ts`
emits `--ask-for-approval` (sandboxed / curated) and `--full-auto`
(full-autonomy), and Codex CLI 0.157.1's `codex exec` rejects both before the
agent starts (clap exit 2: `error: unexpected argument '--ask-for-approval'
found`). The resulting parked reason then blames the model id, because the
model-attribution hint fires on any fast non-zero exit with no journal
progress, which sends the operator after the wrong fix.

## What Changes

- Codex permission mapping switched to options `codex exec` accepts (verified
  against codex-cli 0.157.1):
  - `repo-sandboxed-permissive` → `--sandbox workspace-write -c approval_policy=never`
  - `curated-allowlist` → `--sandbox workspace-write -c approval_policy=on-request`
  - `full-autonomy` → `--dangerously-bypass-approvals-and-sandbox` (replaces the
    removed `--full-auto`)
- New integration test that runs the installed `codex exec <posture flags> --help`
  for every posture and asserts exit 0. It is skipped when `codex` is not on PATH.
- Step-outcome mapping (`src/core/batch/engine/outcome.ts`): a non-zero exit
  whose stderr carries a CLI argument rejection (`unexpected argument '<opt>'
  found`) now yields a blocker that names the rejected option and the agent, in
  place of the "if this model id is invalid…" hint. This applies with or without
  an explicit model. Every other failure branch renders exactly as today.
- Reference docs (`docs/engine/agent-runtime.md` codex table,
  `docs/commands/batch.md`, `docs/engine/overview.md`, `README.md`) updated to
  the new flags and the new argv-rejection hint.
- Features implemented:
  `features/agent-permissions/codex-exec-flags.feature`,
  `features/agent-permissions/posture-translation.feature` (the codex
  `full-autonomy` example row now uses the bypass flag and a curated row is
  added; this replaces the stale store copy on archive),
  `features/honest-outcome/rejected-cli-option.feature`.

## Design

**Root cause.** `-a/--ask-for-approval` is an option on the root `codex` command
(the TUI). The `exec` subcommand does not have it. The adapter
(`src/core/batch/engine/agent.ts:149`) builds
`[...argv ('exec','-'), ...modelFlags, ...permissionFlags]`, so every permission
flag is parsed by `exec`. `--full-auto` has also been removed from `exec` in
0.157.1. The original mapping was never checked against a real binary. The
module header says so: "codex … NOT installed here … VERIFY AT APPLY".

**Approval policy via `-c`.** `codex exec` accepts `-c/--config key=value` and
checks the value when it loads config (`approval_policy=bogus` fails with
`unknown variant`). We emit the bare form `approval_policy=never`, not a
TOML-quoted `"never"`. The help text says a value that fails TOML parsing is used
as a raw string, and we confirmed that the bare value passes validation. The bare
form has no embedded quotes, so it passes unchanged through the local sidecar's
`shquote` join and through the docker and remote loci. We keep the design choice
of argv flags only.

**Why these three mappings.**
- Sandboxed keeps the intended meaning: workspace-write sandbox, approvals off.
  Writes are bounded by codex's own sandbox. The Bash denylist is still not
  expressible for codex (its execpolicy is file-based), which is the same
  coarse-denial limitation the module already documents.
- Curated keeps the intended meaning too: workspace-write sandbox with on-request
  approvals. Only the spelling changes. We do not switch to `--approve-for-me`,
  because that routes approvals to automatic review and would silently loosen
  the posture.
- For full-autonomy, `--dangerously-bypass-approvals-and-sandbox` is the `exec`
  flag equivalent to claude `--dangerously-skip-permissions`, gemini `--yolo`,
  cursor `--force` and opencode `--dangerously-skip-permissions`, which are what
  every other agent maps "operator opted out of all checks" to. It is broader
  than the old `--full-auto`. That is correct for this posture, and the docs table
  will state it.

**Security classification (security-remediation standard).** This is a
compatibility defect, not a severe exposure. It fails closed: the agent never
starts, so no control is bypassed. Its material requirements are:
(R1) sandboxed and curated codex runs start with a sandbox still enforced;
(R2) full-autonomy maps to the bypass only under that posture;
(R3) the docs and the permissions table report the flags that are actually emitted.
Each one maps to a task below. There are no deferrals. The PR may say
`Fixes #114` only after verify confirms R1–R3 and the outcome hint.

**Rejected-option hint.** Add a pure helper `detectRejectedCliOption(stderr)`
that matches clap's `unexpected argument '<opt>' found` and returns `<opt>`.
Codex (clap) and other clap/commander CLIs use this phrasing. In
`buildNonZeroExitFailure`, check it first when `sessionEntries.length === 0`
and `spawn.signal === null`. If it matches, emit a
`The "<agent>" agent rejected the command-line option "<opt>" — the installed
<agent> CLI does not support a flag ratchet passed. Check the agent CLI version
or override the flag via \`permissions.raw\`.` hint in `detail`, `blocker` and
`message`, keeping the stderr tail in `detail`. The agent name comes from
`modelAttribution.agent` when present. Otherwise it comes from a new optional
`agentName` field on `MapOutcomeInput`, filled by the caller from the adapter
name. If neither is available, the text says "the agent". The existing
model-attribution branch and the bare branch are unchanged when stderr has no
rejection, so existing exact-string assertions in `outcome.test.ts` and
`model-failure-attribution.test.ts` stay green.

**Scope held.** There is no runtime version detection or spawn-time `--help`
probing. The mapper stays pure, and the rejected-option hint covers the issue's
requirement to "fail … with a clear compatibility error". This touches the
batch-engine agent seam only. No skill, command or generated artifact changes,
so there are no per-agent generated outputs to enumerate (multi-agent-support).
The fix corrects one agent's mapper inside the per-agent translation module,
which is the one place agent-specific flags are allowed.

**Testing layers.** Unit tests cover the mapper (pure) and the outcome mapping
(pure). One integration test spawns the real `codex` binary with `--help` only,
which parses argv and makes no model call. It uses `it.skipIf(!codexOnPath)`, so
CI without codex stays green. Test headers name their `.feature`.

## Tasks

- [x] 1.1 Update `codexFlags` in `src/core/batch/runtime/agent-permissions.ts` to the three mappings above; rewrite the codex JSDoc and the module header's VERIFY-AT-APPLY note to record that codex is verified against codex-cli 0.157.1 (root cause: `-a` is root-only, not on `exec`; `--full-auto` removed)
- [x] 1.2 Update `test/batch-engine/agent-permissions.test.ts`: move codex out of the "verify-at-apply mappings" describe, assert exact argv for all three postures, assert `--ask-for-approval` and `--full-auto` never appear (header names `codex-exec-flags.feature` and `posture-translation.feature`)
- [x] 1.3 Add `test/batch-engine/codex-cli-compat.test.ts`: for each posture, spawn `codex exec ...resolvePermissionFlags('codex', …) --help` and assert exit 0; skip when `codex` is not on PATH (codex-exec-flags.feature, Scenario Outline + skip scenario)
- [x] 2.1 Add a pure `detectRejectedCliOption(stderr)` helper and the rejected-option branch in `buildNonZeroExitFailure` (`src/core/batch/engine/outcome.ts`), plus the optional `agentName` input threaded from the caller(s) that build `MapOutcomeInput`
- [x] 2.2 Add unit tests in `test/batch-engine/outcome.test.ts` for rejected-option.feature: with explicit model (no model hint, option + agent named, stderr tail kept), without a model (option named), and no-rejection stderr (model hint unchanged); confirm existing `model-failure-attribution.test.ts` assertions still pass
- [x] 3.1 Documentation (mandatory, per the `documentation` standard): update the codex table and full-autonomy note in `docs/engine/agent-runtime.md`; describe the rejected-option hint in `docs/commands/batch.md` and `docs/engine/overview.md` (the argv-rejection section and Mermaid diagram if it shows the attribution branch); update the matching failure-attribution passage in `README.md`
- [x] 4.1 Run `pnpm test` (full suite and coverage gate) and `pnpm build` green
- [x] 4.2 End-to-end proof: build, then run a real `ratchet batch apply` (or the headless change step) with `agent: codex` under the default `repo-sandboxed-permissive` posture, and confirm codex starts (no `unexpected argument` error) and the step reaches a journal entry
