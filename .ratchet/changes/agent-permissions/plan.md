# agent-permissions

## Why

When `ratchet batch apply` spawns a headless coding agent (`claude -p` and peers),
the agent hits a wall of approval prompts with no human present to approve them, so
it stalls and effectively does nothing. An autonomous batch — especially the new
`apply-batch-orchestrator` that loops `ratchet batch apply` unattended — is
dead-on-arrival without a permission policy that tells the spawned agent what it may
do without prompting. This change gives ratchet an agent-agnostic permission posture,
a per-agent flag translator, and a first-run setup that unblocks headless runs while
keeping the agent bounded to the repo.

## What Changes

- Add a structured, agent-agnostic `permissions:` policy (nested object, not flat
  keys) with a `posture` plus optional `allow`/`deny` tool-pattern lists and an
  optional per-agent `raw` override escape hatch. Postures:
  `repo-sandboxed-permissive` (default), `curated-allowlist`, `full-autonomy`.
- Add the `permissions:` block to all three config scopes: user/global
  (`src/core/global-config.ts`), project (`src/core/project-config.ts` `batch:`
  schema), and per-change (`src/core/batch/manifest.ts`
  `BatchSettingsOverrideSchema`). Extend `BatchSettings` + `resolveBatchSettings`
  (`src/core/batch/config.ts`) to resolve and merge the policy across scopes.
- Add a new policy→flags translator module `src/core/batch/runtime/agent-permissions.ts`
  with a per-agent mapping (claude/codex/gemini/cursor). Implements the behavior in
  `features/agent-permissions/posture-translation.feature`,
  `repo-sandboxed-default.feature`, and `raw-override.feature`.
- Wire the translator into the adapter registry (`src/core/batch/engine/agent.ts`)
  so each adapter appends its resolved permission flags to its base argv; the flags
  then flow unchanged through the local/docker sidecar runtime
  (`runtime/rex-sidecar-runtime.ts`) and the remote runtime
  (`runtime/rex-remote-runtime.ts`).
- Add a first-run guided setup that fires on the first batch command when no
  permission config exists at any scope, mirroring `ratchet init`'s interactive flow,
  saving to the project config by default with a save-to-user option. Implements
  `features/agent-permissions/first-run-setup.feature`.
- Make the first-run setup strictly non-blocking: detect no-TTY / CI / non-interactive
  and fall back to the default posture WITHOUT prompting. Idempotent — once a config
  exists at any scope, never re-prompt.
- Extend `redactSettings` (`src/core/batch/config.ts`) so any secret-bearing policy
  field (e.g. a raw override carrying a token) is redacted in display/logging.
- Add unit + e2e tests, including a no-TTY-no-hang test and posture→flags assertions.
- Implements the contract in: `features/agent-permissions/posture-translation.feature`,
  `repo-sandboxed-default.feature`, `scope-layering.feature`,
  `first-run-setup.feature`, `raw-override.feature`.

## Design

### Policy schema (structured, nested)

A single agent-agnostic policy object, shared by all three scopes:

```
permissions:
  posture: repo-sandboxed-permissive | curated-allowlist | full-autonomy   # scalar
  allow: [ "<agent-neutral tool pattern>", ... ]                           # list
  deny:  [ "<agent-neutral tool pattern>", ... ]                           # list
  raw:                                                                     # escape hatch
    claude: [ "--flag", "value" ]
    codex:  [ ... ]
    gemini: [ ... ]
    cursor: [ ... ]
```

- Defined once as a zod schema and reused across scopes. Project
  (`src/core/project-config.ts:46-60`) and manifest
  (`src/core/batch/manifest.ts:50-62`, currently `.strict()`) embed it inside the
  existing `batch:` object; the global/user scope (`src/core/global-config.ts:15-20`)
  gains a `batch.permissions` block (user scope has no batch settings today). The
  manifest's `.strict()` stays — `permissions` becomes a known key.
- `posture` is a scalar; `allow`/`deny` are lists; `raw` is a per-agent map of raw
  argv arrays. Tool patterns are agent-neutral in the common path; the translator
  maps them to each agent's native flag syntax. Per the multi-agent-support standard,
  nothing in the shared policy is Claude-specific — agent specifics live only in the
  translator's per-agent map and the optional `raw` override.

### Posture → flags mapping table (per agent)

Claude and Gemini flags are confirmed from `claude --help` / `gemini --help` on this
machine. Codex and `cursor-agent` are not installed here — their mappings are the
intended design and are marked **verify at apply**.

| Posture                    | claude (verified)                                                                                          | codex (verify at apply)                          | gemini (verified)                  | cursor-agent (verify at apply)        |
|----------------------------|-------------------------------------------------------------------------------------------------------------|--------------------------------------------------|------------------------------------|---------------------------------------|
| repo-sandboxed-permissive  | `--permission-mode acceptEdits` + `--add-dir <repoRoot>` + `--disallowedTools <denylist>`                   | `--sandbox workspace-write` + `--ask-for-approval never` | `--approval-mode auto_edit`        | force/non-interactive flag + repo scope |
| curated-allowlist          | `--permission-mode default` + `--allowedTools <allow>` + `--disallowedTools <deny>`                         | `--sandbox workspace-write` + curated approval   | `--approval-mode default`          | allow/deny equivalent                 |
| full-autonomy              | `--dangerously-skip-permissions`                                                                            | `--full-auto` (or `--sandbox danger-full-access`) | `--yolo` (`-y`) / `--approval-mode yolo` | yolo/force-all equivalent             |

Notes on confirmed claude flags (from `claude --help`): `--permission-mode` choices
are `acceptEdits, auto, bypassPermissions, default, dontAsk, plan`;
`--allowedTools`/`--disallowedTools` take comma/space-separated tool names like
`"Bash(git *)" Edit`; `--dangerously-skip-permissions` bypasses all checks;
`--add-dir` scopes allowed directories. Gemini
confirmed: `--approval-mode {default,auto_edit,yolo,plan}` and `-y/--yolo`.

**DECISION (locked): argv flags ONLY — no settings-file route.** The policy is
injected exclusively via command-line flags (`--permission-mode` / `--allowedTools` /
`--disallowedTools` / `--add-dir`, and per-agent equivalents). We deliberately do NOT
write a transient `--settings` JSON. Rationale: argv flows trivially through all three
loci (local sidecar, docker, remote REST) with no temp-file lifecycle to plumb into
containers/remote servers. **Accepted consequence:** denials are COARSE / tool-level —
e.g. "rm -rf outside repo" and "curl | sh" become blunt `--disallowedTools`-style Bash
denials, not path-aware rules. That is acceptable for v1; a settings-file route for
path-precise denials is a documented future enhancement, out of scope here.

The translator emits `acceptEdits` (not `bypassPermissions`) for the sandboxed default
so edits proceed unprompted while the deny list and `--add-dir` repo scoping still
bound the agent; `--dangerously-skip-permissions` is reserved for `full-autonomy`.

### Repo-sandboxed denylist (default posture)

The default posture's deny set forbids: `rm -rf` targeting paths outside the project
root, `sudo`, writes outside the repo, and obvious network-exfil shell pipes like
`curl ... | sh`. Encoded as agent-neutral patterns and translated to
`--disallowedTools` (claude) / sandbox restrictions (codex) / approval gating (gemini)
plus `--add-dir`/`--sandbox` repo scoping so in-repo edits and ordinary build/test
commands run unprompted. Implements `repo-sandboxed-default.feature`.

### Translation module + where adapters/runtimes consume it

- New module `src/core/batch/runtime/agent-permissions.ts` exports
  `resolvePermissionFlags(agentName, policy, repoRoot): string[]` and the per-agent
  posture maps. It is pure (policy in, argv fragment out) so it is unit-testable
  without spawning anything.
- The adapter registry (`src/core/batch/engine/agent.ts:111-121`) today builds argv
  via `CommandAgentAdapter`'s `argv: (instructions) => string[]` thunk; claude's is
  `() => ['-p','--output-format','stream-json','--verbose','--include-partial-messages']`
  (agent.ts:111-117). `buildRequest` calls `this.argv(...)` at agent.ts:94. Each
  adapter will append `resolvePermissionFlags(...)` to its base argv inside
  `buildRequest`, given the resolved policy + repo root from `AgentRequestContext`.
- Flags flow unchanged downstream: `engine.ts:325-327` resolves the adapter and calls
  `buildRequest`; the resulting `AgentSpawnRequest.args` is consumed by both runtimes
  — `rex-sidecar-runtime.ts` `buildRunCommand` (~lines 132-135, spawned at ~210) and
  `rex-remote-runtime.ts` `buildRemoteRunCommand` (~lines 107-110, executed ~243-247).
  No runtime behavior changes beyond carrying the extra args (local + docker + remote
  all covered by appending to `args`).

### Scope precedence + list-merge semantics

Resolution extends `resolveBatchSettings` (`src/core/batch/config.ts:141-185`), which
today cascades **defaults ← project ← manifest** with per-field scalar override. We
add the user/global scope at the bottom, giving:

**built-in default ← user/global ← project ← per-change manifest.**

- `posture` (scalar): nearest scope wins (override), matching existing scalar merge.
- `deny` (list): **union across all scopes** — safety-critical denials accumulate and
  a narrower scope cannot silently drop a broader scope's denial.
- `allow` (list): **replace by the nearest defining scope** — an allow list expresses
  a deliberate, self-contained allowance, so the most specific scope that sets it wins
  outright (no union). Documented and asserted in `scope-layering.feature`.
- `raw` (per-agent map): nearest scope that defines a given agent's entry wins for
  that agent.

### First-run trigger + no-TTY fallback + save-to-project default

- A shared `program.hook('preAction', ...)` already runs before every command
  (`src/cli/index.ts:85-101`); the batch command tree lives under `batchCmd`
  (`src/cli/index.ts:374-483`, subcommands new/status/view/list/config/report/apply).
  The first-run check fires from a batch-scoped pre-action (so it only triggers on
  `batch *`), short-circuiting when a config already exists at any scope (idempotent).
- Interactivity is decided by the existing `isInteractive()` helper
  (`src/utils/interactive.ts:22-28`), which returns false for `CI`,
  `OPEN_SPEC_INTERACTIVE=0`, or no `process.stdin.isTTY`. When non-interactive: no
  prompt, fall back to `repo-sandboxed-permissive`, do NOT write any config, never
  block. This is the load-bearing guarantee for headless/CI runs.
- When interactive: mirror `ratchet init`'s guided flow (it uses `@inquirer/prompts`
  / `@inquirer/core` with `chalk` styling — `src/core/init.ts:215`,
  `src/prompts/searchable-multi-select.ts:28-37`) to prompt for a posture and a save
  scope. Default save target is the project config `.ratchet/config.yaml` (matching
  init's project-relative `createConfig` at `src/core/init.ts:595-603`); an option
  saves to the user config dir (`getGlobalConfigDir()`,
  `src/core/global-config.ts:35-56`, e.g. `~/.config/ratchet`) instead.

### Secrets / redaction

`redactSettings` (`src/core/batch/config.ts:81-99`) today redacts `authToken` via
`SECRET_SETTING_KEYS`. Extend redaction to walk the resolved `permissions.raw`
fragments and mask any secret-bearing token before settings are printed/logged,
keeping the existing `***` placeholder. Implements the redaction scenario in
`raw-override.feature`.

### Limitation (explicit)

Ratchet only controls the flags it passes to the spawned agent. It does NOT control
the user's global Claude hooks or the RTK command-rewrite layer. A permissive agent
posture means fewer operations reach those layers (fewer prompts), but ratchet cannot
disable them. This is documented as a known boundary, not a bug.

## Tasks

- [x] 1.1 Define the agent-agnostic `permissions` zod schema (posture enum, allow/deny lists, per-agent `raw` map) as a single shared schema
- [x] 1.2 Add the `permissions` block to the project `batch:` schema in `src/core/project-config.ts`
- [x] 1.3 Add a `batch.permissions` block to the user/global config in `src/core/global-config.ts`
- [x] 1.4 Add `permissions` to `BatchSettingsOverrideSchema` in `src/core/batch/manifest.ts`, keeping `.strict()`
- [x] 1.5 Extend `BatchSettings` and `resolveBatchSettings` in `src/core/batch/config.ts` to add the user/global scope and resolve `permissions` with documented merge semantics (posture override; deny union; allow replace-by-nearest; raw per-agent nearest-wins)
- [x] 2.1 Create `src/core/batch/runtime/agent-permissions.ts` exporting `resolvePermissionFlags(agent, policy, repoRoot)` and the per-agent posture maps
- [x] 2.2 Encode the repo-sandboxed-permissive denylist (rm -rf outside repo, sudo, out-of-repo writes, curl|sh) as agent-neutral patterns plus repo-scoping
- [x] 2.3 Implement claude mapping (verified flags) and gemini mapping (verified flags) in the translator
- [x] 2.4 Implement codex and cursor-agent mappings per the design table; mark uncertain flags "verify at apply"
- [x] 2.5 Honor the per-agent `raw` override (append for matching agent, ignore others)
- [x] 3.1 Wire `resolvePermissionFlags` into each adapter's `buildRequest` in `src/core/batch/engine/agent.ts` so resolved flags append to the base argv
- [x] 3.2 Pass the resolved policy + repo root through `AgentRequestContext` from `engine.ts` so adapters can consume it
- [x] 3.3 Confirm flags flow unchanged through local/docker sidecar (`rex-sidecar-runtime.ts`) and remote (`rex-remote-runtime.ts`) runtimes
- [x] 4.1 Add the batch-scoped first-run hook that detects a missing permission config at all scopes
- [x] 4.2 Implement the no-TTY/CI/non-interactive fallback (use `isInteractive()`): no prompt, default posture, no config write, never block
- [x] 4.3 Implement the interactive guided setup mirroring `ratchet init` (posture choice + save scope), default save to project `.ratchet/config.yaml`, option to save to user config dir
- [x] 4.4 Make first-run idempotent: once a config exists at any scope, never re-prompt
- [x] 5.1 Extend `redactSettings` to redact secret-bearing values inside `permissions.raw`
- [x] 6.1 Unit-test the translator: posture→flags assertions per agent (claude + gemini verified; codex/cursor against intended map)
- [x] 6.2 Unit-test scope resolution: posture override, deny union, allow replace-by-nearest, raw per-agent nearest-wins, and the no-config default
- [x] 6.3 Unit-test the denylist patterns (rm -rf outside repo, sudo, out-of-repo write, curl|sh)
- [x] 6.4 Add a no-TTY-no-hang e2e test: a batch command with no config and no TTY returns the default posture without prompting or blocking
- [x] 6.5 e2e: confirm resolved permission flags appear in the spawned agent argv across local/docker/remote loci
- [x] 7.1 Build and test green (`pnpm build`, full test suite)
