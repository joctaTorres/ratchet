# gate-agent-cmd-override

## Why

`RATCHET_BATCH_AGENT_CMD` / `RATCHET_EVAL_AGENT_CMD` are read unconditionally at spawn time in three drifting copies (`src/core/batch/engine/engine.ts` `buildSpawnRequest`, `src/core/eval/judge.ts` `buildVoteRequest`, `src/core/eval/mutation-harness.ts` `buildSeedRequest`). Any leftover value (from an eval session, CI, or a `.envrc`) silently replaces the configured coding agent with a bare `bash -c <value>`. That run prints no notice, leaves no journal marker, drops every resolved permission flag, and `ratchet batch config` still shows the posture as if it were enforced (issue #80, which absorbed #112). Under the `security-remediation` standard this is a **Severe / High** agent/command-hijack plus permission-bypass exposure, so every material requirement below is in scope, and the change carries no deferrals.

## What Changes

Material requirements of the exposure (issue #80 close-gates). Each one maps to tasks below.

| # | Requirement | Tasks | Features |
|---|---|---|---|
| R1 | Loud notice on every overridden spawn, in text and `--json` (`agentOverride: true`) | 1.1, 2.2, 3.1, 4.2 | `override-notice.feature` |
| R2 | `via: "env-override"` provenance on every journal entry and run record produced under an override | 2.3, 2.4, 4.2 | `override-provenance.feature` |
| R3 | One shared `buildAgentSpawnRequest` helper used by engine, judge, and mutation harness | 1.1, 2.1, 4.1 | `shared-spawn-helper.feature` |
| R4 | Explicit operator opt-in gate, which the process environment cannot supply by itself | 1.1, 2.1, 3.1, 4.1 | `opt-in-gate.feature` |
| R5 | Existing e2e/eval harnesses keep working through a supported, documented opt-in | 5.1, 5.2, 5.3, 7.2 | `opt-in-gate.feature` |
| R6 | The override path honors the resolved permission policy, or refuses | 1.1, 2.1 | `override-permissions.feature` |
| R7 | `batch config` (text and `--json`) reports the real posture under an override | 3.2 | `config-posture-honesty.feature` |
| R8 | The eval side (`RATCHET_EVAL_AGENT_CMD`, judge, and mutation harness) is fixed in the shared helper | 4.1, 4.2 | `shared-spawn-helper.feature`, `override-provenance.feature` |
| R9 | Reference docs updated (`docs/engine/agent-runtime.md`, `docs/commands/batch.md`, `README.md`, plus the other affected command docs) | 6.1–6.4 | none (the `documentation` standard) |

- **New shared helper** in `src/core/batch/engine/agent.ts`, exported via `src/core/batch/engine/index.ts`. It contains `activeAgentCmdOverride(envVar, env)`, `buildAgentSpawnRequest(...)`, `agentOverrideNotice(envVar)`, `AgentOverrideRefusedError`, the `ENV_OVERRIDE_PROVENANCE = 'env-override'` constant, and the `SPAWN_VIA_ENV = 'RATCHET_SPAWN_VIA'` marker. All three spawn seams delegate to it.
- **BREAKING (test/operator seam only):** an active `RATCHET_BATCH_AGENT_CMD` / `RATCHET_EVAL_AGENT_CMD` is now **refused** unless the operator passes `--allow-agent-override`. The flag goes on `ratchet batch apply`, `ratchet apply`, `ratchet verify`, `ratchet propose`, and `ratchet eval run`. In-process callers pass `EngineDeps.allowAgentOverride` / `RunOptions.allowAgentOverride`. Behavior with no override set is byte-identical.
- **Permission forwarding.** An overridden spawn's argv is `bash -c <override> <agentName> <resolvePermissionFlags(agentName, policy, cwd)...>`, so the override receives `$0` = agent and `$@` = flags. The spawn is refused when a policy is present but the resolved agent has no permission translator and no `raw` entry.
- `StepResult` / `EngineStepOutcome` gain `agentOverride?: true`, and `JournalEntry` gains `via?: 'env-override'`. `EvalRun` gains `via?: 'env-override'`. `eval run --json` gains top-level `agentOverride: true`.
- `ratchet batch config` shows the posture as **NOT enforced** under an active override (text). Its JSON gains `agentOverride: { active, envVar, permissionsEnforced }`.
- Harness opt-ins: `test/cli-e2e/*` invocations, the in-process engine tests, and `.ratchet/evals/specs/*.yaml` scripts pass the opt-in.

## Design

**Gate (R4): a CLI flag plus an explicit engine dependency, never an environment variable.** The issue allows an allow-list env var, but a second env var has the same "leftover in `.envrc`" failure mode as the first. So the opt-in is `--allow-agent-override` on every verb that constructs a `RatchetBatchEngine` or runs evals. It is threaded as `EngineDeps.allowAgentOverride` and `RunOptions.allowAgentOverride` (default `false`). The helper takes `allowOverride` as an explicit parameter and **never reads the opt-in from `process.env`**. That keeps the helper a pure function of its inputs, which acceptance criterion #2 asks to unit-test directly.

An active override without the opt-in **refuses** the spawn with `AgentOverrideRefusedError`. It does not silently fall through to the real agent, because a leftover var is exactly the case the operator must hear about. The refusal message names the env var and the flag: `RATCHET_BATCH_AGENT_CMD is set but agent overrides are disabled; pass --allow-agent-override to run it, or unset the variable`. The engine catches it the same way as `UnknownAgentError`: a `failed` step whose `blocker`/`message` carry that text. Nothing is spawned, and the run-state stays resumable. On the eval side, `executeRun` checks before any case runs and throws the same error, so the run aborts before any spawn. The helper also throws if reached (defense in depth). A whitespace-only value is inactive, so no opt-in is needed and nothing is refused. That preserves the existing blank-is-unset contract in `.ratchet/features/agent-runtime/override-and-fallback.feature`.

**Shared helper (R3, R8).** Here is the signature:

```ts
buildAgentSpawnRequest({
  overrideEnvVar, env, allowOverride, instructions, cwd,
  agentName?, permissions?,          // for permission forwarding (engine only)
  buildAdapterRequest: () => AgentSpawnRequest,
  notify?: (line: string) => void,   // default: process.stderr.write(line + '\n')
}): { request: AgentSpawnRequest; agentOverride: boolean }
```

The helper owns everything about the override. That covers the trim check, the gate, the notice, permission forwarding, the `bash -c` request shape, and the `RATCHET_SPAWN_VIA` marker. Site-specific adapter resolution stays inside each caller's `buildAdapterRequest` closure: the engine's stage-map, spec parsing, and `emitsStreamJson`, and the eval side's bare `resolveAdapter`. The gate therefore exists in exactly one place without flattening genuinely different adapter paths. The engine still resolves the stage adapter before calling the helper, so an unknown agent is still rejected (`UnknownAgentError`) before any spawn, override or not. Its `adapter.name` then supplies `agentName` for permission forwarding. Per `delegated-lifecycle`, the helper is purely mechanical. It carries no instruction text and no lifecycle semantics.

**Permissions (R6): forward, never drop.** `resolveBatchSettings` always yields a `permissions` policy (default posture `repo-sandboxed-permissive`). Refusing whenever a policy exists would therefore refuse every override and break R5. Instead, the override request carries the exact flags the adapter would have received. The override runs as `bash -c <override> <agentName> <flags...>`: bash assigns the first trailing argument to `$0` and the rest to `$@`. A stub that ignores `$@` behaves as before. A wrapper that launches a real agent can pass `"$@"` through, and a faithful stub can assert on them. The spawn is **refused** when a policy is present but the resolved agent has no permission translator (`AGENT_MAPPERS`) and no `permissions.raw` entry. This arises only for an injected synthetic adapter, and it replaces a silently flagless spawn. It uses a new pure predicate, `canTranslatePermissions(agentName, policy)` in `agent-permissions.ts`. The eval judge and the mutation harness carry no permission policy today: their adapter requests get no permission flags. So there is nothing to void, and the forwarded list is empty. The docs say this explicitly. Ratchet **forwards but cannot enforce** flags for an arbitrary shell command. R7 therefore still reports the posture as not enforced.

**Notice (R1).** When the helper returns an override request, it calls `notify(agentOverrideNotice(var))` (`⚠ agent overridden by <VAR>`). The default writes to **stderr** on every spawn. That makes the notice unmissable in text mode, and it never corrupts `--json` stdout, which must stay a single JSON document. The engine sets `agentOverride: true` on the step outcome, and `toStepResult` carries it to `StepResult`. `batch apply --json` then emits it through the existing `JSON.stringify(result)`. The standalone change-step verbs' JSON carries it too. `eval run --json` adds a top-level `agentOverride: true`. A refused spawn prints the refusal, not the notice.

**Provenance (R2).** Journal entries have two producers:

1. The engine stamps `via: 'env-override'` on the transition-outcome entry it appends (the `appendJournalForLocus` call) whenever the spawn was overridden. The pr and decompose spawn paths stamp the same way.
2. `ratchet batch report` (and the batch-less `ratchet report` the standalone verbs prompt, added on main by #117), which the spawned stand-in invokes, stamps every entry it appends when its environment carries `RATCHET_SPAWN_VIA=env-override`. The helper exports that variable at the head of the `bash -c` script (`export RATCHET_SPAWN_VIA=env-override; <override>`) **only** for a request it actually built under an allowed override. It lives in the script rather than only on `request.env` because both ReX runtimes currently drop `request.env` (#89, still open). The exported marker reaches the stand-in under every runtime, independent of that fix.

Stamping on the injected marker rather than on the `RATCHET_BATCH_AGENT_CMD` var itself means a leftover var in the operator's shell does not mislabel a manual `batch report`. Spoofing the marker only over-stamps, which fails safe for auditing. For eval, `executeRun` stamps `via` on the persisted `EvalRun` when the run executed with an active, allowed `RATCHET_EVAL_AGENT_CMD`. The run is synthetic evidence whichever contributors actually fired. `via` is an optional string-literal field, and readers ignore it. No journal or run migration is needed, and override-free output is byte-identical. `ProofOfWorkRecord` is host-run and never passes through the agent seam, so it is not stamped.

**Posture honesty (R7).** `batch config` evaluates `activeAgentCmdOverride('RATCHET_BATCH_AGENT_CMD', process.env)` at its own invocation. It checks presence rather than the opt-in, because config cannot know which flags a later apply will receive. When the override is active, the text posture line becomes `posture  <p>  NOT ENFORCED — RATCHET_BATCH_AGENT_CMD overrides the agent (spawns refused unless --allow-agent-override; flags are forwarded to the override command, never enforced by ratchet)`, and the plain posture line is not printed. The JSON always carries `agentOverride: { active, envVar: 'RATCHET_BATCH_AGENT_CMD', permissionsEnforced: !active }`. No other command surface reports posture: `grep posture src/commands` finds only `batch config`. The generated `apply-batch` workflow template mentions posture only as the first-run prompt and makes no enforcement claim, so it stays unchanged.

**Harness opt-in (R5).** The following opt in:

- The CLI e2e tests (`test/cli-e2e/batch-pr-grouping-modes.test.ts`, `batch-pr-whole-batch.test.ts`, `eval.test.ts`) add `--allow-agent-override` to their `runCLI` args.
- The in-process engine tests that set the var to an active value pass `allowAgentOverride: true` in their `EngineDeps` (task 5.2).
- The eval specs `.ratchet/evals/specs/batch-orchestration.yaml` and `batch-propose-metadata.yaml` add the flag to their `ratchet batch apply` invocations.

`test/e2e/rex-local-stream.sh` hands a `bash -c` request straight to the runtime and never goes through the engine or the helper, so it is unaffected. The docs describe the flag as the supported way to opt in.

**Standards.**

- `testing`: the pure helper and `canTranslatePermissions` get unit tests with no fs and no spawn, covering argv, gate, notice, the env marker, and the closure called exactly once. Engine, report, config, eval run, and verb wiring get integration tests. CLI e2e tests keep proving the flag end to end. Test headers name the `.feature` files. The full suite and the coverage gate stay green.
- `multi-agent-support`: forwarding resolves flags per agent through the existing translator. It never names a specific agent, and the Examples table covers every spawnable agent.
- `generalizable-defaults` / `instruction-fed-config`: nothing new ships into consuming repos. The notice and flag are CLI surface, and the one template sentence is generic.
- `documentation`: R9, below.

**Documentation (R9).** Update these:

- `docs/engine/agent-runtime.md`: the override-seam contract (gate, refusal, notice, permission forwarding as `$0`/`$@`, `RATCHET_SPAWN_VIA`, `via` provenance, the shared helper).
- `docs/commands/batch.md`: the `--allow-agent-override` flag on `batch apply`, `agentOverride` in the JSON, and the not-enforced posture display in `batch config`.
- `docs/commands/eval.md` and `docs/eval-mutation-harness.md`: the flag, the refusal, and the run-record stamp.
- `docs/commands/apply.md`, `verify.md`, and `propose.md`: the flag.
- `.ratchet/evals/README.md`: the opt-in in the stub recipe.
- `README.md`: the command table and the permission-posture description get the flag and the caveat.

## Tasks

**1. Shared helper (R1, R3, R4, R6)**

- [x] 1.1 In `src/core/batch/engine/agent.ts`, add `activeAgentCmdOverride`, `agentOverrideNotice`, `AgentOverrideRefusedError`, `ENV_OVERRIDE_PROVENANCE`, `SPAWN_VIA_ENV`, and `buildAgentSpawnRequest`. The helper implements the gate: refuse when the override is active and not allowed, and when a policy is present but untranslatable. It also implements the notice via `notify` (stderr by default), the forwarding argv `bash -c 'export RATCHET_SPAWN_VIA=env-override; <cmd>' <agent> <flags...>`, which also exports the provenance marker. Add `canTranslatePermissions` to `src/core/batch/runtime/agent-permissions.ts`. Export both through `src/core/batch/engine/index.ts`.
- [x] 1.2 Unit tests (no fs, no spawn) in `test/batch-engine/agent-override-helper.test.ts`: active, blank, and unset override; refusal without opt-in (message names var and flag); opt-in honored; the argv carries `resolvePermissionFlags` output for each spawnable agent; refusal for an untranslatable agent under a policy; the provenance marker is exported only by override scripts, as proven by running the built argv through a real `bash`; `notify` called exactly once per override build and never otherwise; `buildAdapterRequest` called exactly once when inactive and never when active; `process.env` never consulted for the opt-in. Header names `shared-spawn-helper.feature`, `opt-in-gate.feature`, and `override-permissions.feature`.

**2. Batch engine (R1–R4, R6)**

- [x] 2.1 `RatchetBatchEngine` accepts `EngineDeps.allowAgentOverride` (default `false`) and optional `notify`. `buildSpawnRequest` resolves the stage adapter first, then delegates to `buildAgentSpawnRequest`, passing `agentName = adapter.name` and `permissions = settings.permissions`. All three spawn paths (transition, pr, decompose) map `AgentOverrideRefusedError` to a `failed` step carrying the message, with no spawn.
- [x] 2.2 Thread `agentOverride?: true` onto `EngineStepOutcome` / `StepResult` (`src/core/batch/engine/contract.ts`) for overridden spawns.
- [x] 2.3 Add `via?: 'env-override'` to `JournalEntry` (`src/core/batch/journal.ts`). The engine stamps it on the transition, pr, and decompose outcome entries it appends for overridden spawns.
- [x] 2.4 `src/commands/batch/report.ts` stamps `via: 'env-override'` on every entry it appends when `process.env.RATCHET_SPAWN_VIA === 'env-override'`.
- [x] 2.5 Integration tests. Extend `test/batch-engine/engine-agent-override.test.ts`: refused without opt-in (stub not run, failed step, resumable); honored with opt-in; `agentOverride` on the result; stamped outcome entry; forwarded permission argv; untranslatable-agent refusal; blank override unaffected. Add to `test/commands/batch/report.test.ts`: stamped when the marker is set, and unstamped when only `RATCHET_BATCH_AGENT_CMD` is set. Headers name the features.

**3. Command surfaces (R1, R4, R7)**

- [x] 3.1 Add the `--allow-agent-override` option to `batch apply`, `apply`, `verify`, and `propose` in `src/cli/index.ts`, threaded into each `RatchetBatchEngine` construction (`src/commands/batch/apply.ts`, `src/commands/apply.ts`, `verify.ts`, `propose.ts`). The JSON result carries `agentOverride`. Integration tests: each verb refuses without the flag and runs the stub with it. `batch apply --json` stdout parses as one JSON document with `agentOverride: true`.
- [x] 3.2 `src/commands/batch/config.ts`: when an override is active, print the NOT ENFORCED posture line in place of the plain one, and always add `agentOverride: { active, envVar, permissionsEnforced }` to the JSON. Tests in `test/commands/batch/config.test.ts` assert the plain posture line never appears alongside an active override, and that output is unchanged when no override is active. Check `src/core/templates/workflows/apply-batch.ts`: it only describes the first-run posture prompt and never presents the posture as enforced, so it needs no change. Header names `config-posture-honesty.feature`.

**4. Eval side (R1–R4, R8)**

- [x] 4.1 `judge.ts` `buildVoteRequest` and `mutation-harness.ts` `buildSeedRequest` delegate to `buildAgentSpawnRequest` with `overrideEnvVar: 'RATCHET_EVAL_AGENT_CMD'` and the run's `allowAgentOverride`, threaded from `RunOptions` through `executeRun` to both seams. `executeRun` refuses up front, before any case runs, when the override is active and not allowed.
- [x] 4.2 `EvalRun` (`src/core/eval/run.ts`) gains `via?: 'env-override'`, stamped at persistence under an allowed active override. `src/commands/eval/run.ts` accepts `--allow-agent-override`, adds `agentOverride: true` to the `--json` payload, and the helper's notice reaches stderr. Integration tests in `test/commands/eval/run.test.ts`: refused without the flag, stamped with it, unstamped without an override. The judge and mutation-harness suites cover the delegated seams at the helper level.

**5. Harness opt-in (R5)**

- [x] 5.1 Add `--allow-agent-override` to every override-using `runCLI` call in `test/cli-e2e/batch-pr-grouping-modes.test.ts`, `batch-pr-whole-batch.test.ts`, and `eval.test.ts`. Add one e2e assertion that the override without the flag exits non-zero with the refusal message.
- [x] 5.2 Pass `allowAgentOverride: true` in the engine deps of every in-process test that sets `RATCHET_BATCH_AGENT_CMD` to an active value: `test/batch-engine/engine-agent-override.test.ts` and `engine-runtime.test.ts`. The other eight `test/batch-engine/*` files only clear the variable in their setup, so their tests stay unchanged.
- [x] 5.3 Add the flag to the `ratchet batch apply` invocations in `.ratchet/evals/specs/batch-orchestration.yaml` and `.ratchet/evals/specs/batch-propose-metadata.yaml`. Confirm `test/e2e/rex-local-stream.sh` bypasses the engine and needs no change.

**6. Documentation (R9)**

- [x] 6.1 `docs/engine/agent-runtime.md`: document the override-seam contract (opt-in gate and refusal, stderr notice, `agentOverride`, permission forwarding as `$0`/`$@` plus the untranslatable refusal, `RATCHET_SPAWN_VIA`, `via` provenance, the shared helper). Re-verify the existing diagrams and tables.
- [x] 6.2 `docs/commands/batch.md`: document the `batch apply --allow-agent-override` flag, `agentOverride` in the JSON, the `batch config` NOT ENFORCED display, and the `agentOverride` JSON block. Document the flag in `docs/commands/apply.md`, `verify.md`, and `propose.md`.
- [x] 6.3 `docs/commands/eval.md` and `docs/eval-mutation-harness.md`: document the flag, the refusal, the notice, and the `via` run-record stamp. Update the stub recipe in `.ratchet/evals/README.md`.
- [x] 6.4 `README.md`: add the flag to the command table and the posture caveat under an override. Update `docs/engine/overview.md:583` if its override mention changes meaning.

**7. Verification**

- [x] 7.1 `pnpm lint` and `pnpm build` pass.
- [x] 7.2 `pnpm vitest run` passes in full, including the cli-e2e suite with the documented opt-in, and `pnpm vitest run --coverage` meets the enforced threshold.
- [x] 7.3 Walk R1–R9 against the implemented code and tests. Claim `Closes #80` only if every requirement is implemented and verified; otherwise say "partially addresses #80".
