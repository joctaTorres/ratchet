# Web binding lifecycle harness

## Why

`kind: web` bindings are representable (`web-binding-schema`) but not runnable:
`judgeCase` throws `"Web binding execution is not yet implemented"` the moment a
`web` binding is dispatched. Tier-4 browser scenarios need a mechanical harness
that actually boots the app, waits for it to become ready within a fail-closed
timeout, drives the Playwright spec, and always tears the process down — this
is the missing execution primitive the rest of the `playwright-web-tier` phase
(deterministic-contributor folding, failure-artifact capture, the doctor probe)
composes on top of.

## What Changes

- New core module `src/core/eval/web-lifecycle.ts` exporting `runWebLifecycle`,
  the lifecycle harness for a `WebBinding`: start the `start` command as a
  background process, poll `readiness` (URL or command) until it succeeds or
  `readiness.timeoutMs` elapses (timeout is a hard failure, never an assumed
  pass), run the Playwright spec at `spec` via a plain bash invocation, and
  kill the started process in a `finally` on every path.
- New injectable seams (`ProcessStarter`/`ProcessHandle`, `ReadinessChecker`)
  with real implementations, following the existing `BashRunner`/`Spawner`
  injectable-`deps` pattern from `src/core/batch/engine/`, so tests never spawn
  a real process or hit a real network/shell.
- `WebBinding`/`WebReadiness` re-exported from the `src/core/eval/index.ts`
  barrel alongside the new harness exports (they exist in `spec.ts` today but
  were never barrelled, and callers of `runWebLifecycle` need the type).
- Implements `features/web-lifecycle/readiness.feature` and
  `features/web-lifecycle/run-and-teardown.feature`.
- **Out of scope** (already named as their own later changes in this phase, per
  `.ratchet/batches/mature-eval/batch.yaml`): wiring `judgeCase`'s `web` branch
  and the `deterministic` contributor through this harness
  (`web-deterministic-fold`), trace/screenshot capture on failure
  (`web-failure-evidence`), and the conditional `ratchet doctor` Playwright
  probe (`doctor-conditional-playwright-probe`). `judgeCase` keeps throwing for
  `web` bindings until `web-deterministic-fold` lands; this change only builds
  and proves the harness those changes will call.
- No agent-facing surface (no skills/commands/templates) — nothing to
  enumerate per `multi-agent-support`; the Playwright invocation is a plain
  `bash(command, cwd)` call with no agent involved, so it is agent-neutral by
  construction rather than by special-casing.
- No `README.md` change: the harness is not yet reachable from any CLI command
  (`eval run` still throws for `web` bindings until `web-deterministic-fold`),
  so no described user-facing surface changes in this change.

## Design

**Shape of the harness.** Mirrors `judgeCheck` in `src/core/eval/judge.ts`
(bash a command, evaluate the result) but adds the missing background-process
lifecycle around it:

```ts
export interface ProcessHandle {
  readonly pid: number | null;
  kill(): void;
}
export type ProcessStarter = (command: string, cwd: string) => ProcessHandle;

export type ReadinessChecker = (readiness: WebReadiness, cwd: string, bash: BashRunner) => Promise<boolean>;

export interface WebLifecycleDeps {
  start?: ProcessStarter;
  bash?: BashRunner;
  checkReadiness?: ReadinessChecker;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export type WebLifecycleOutcome =
  | { kind: 'readiness-timeout' }
  | { kind: 'completed'; passed: boolean; result: BashResult };

export async function runWebLifecycle(
  binding: WebBinding,
  cwd: string,
  deps: WebLifecycleDeps = {}
): Promise<WebLifecycleOutcome>
```

- **Start as background process (the bash spawn seam, extended).** `realBashRunner`
  (`src/core/batch/engine/proof-of-work.ts`) only resolves on `close`, so it
  cannot represent "started, still running." `realProcessStarter` reuses the
  same `spawn('bash', ['-c', command], { cwd, ... })` primitive but returns
  immediately with a handle instead of awaiting completion, and starts the
  child `detached: true` in its own process group so `kill()` can signal the
  whole group (`process.kill(-pid, 'SIGTERM')`) — a dev-server launcher like
  `pnpm dev` commonly forks a nested process, and killing only the wrapper
  shell would leak the real server. This is the same injectable-`deps` pattern
  as `BashRunner`/`Spawner`: a `start` field defaulting to `realProcessStarter`,
  overridable in tests with a fake that records start/kill calls and never
  spawns anything.
- **Readiness polling, fail-closed.** Check-then-sleep (never sleep-then-check,
  so a same-tick-ready app isn't penalized one poll interval), looping while
  `now() < deadline` where `deadline = now() + binding.readiness.timeoutMs`.
  `defaultReadinessChecker` runs `bash(readiness.command, cwd)` and checks
  `exitCode === 0` for a command probe, or `fetch(readiness.url).ok` for a URL
  probe (exactly one is present per `WebReadinessSchema`'s refinement). Timeout
  elapsing with no success returns `{ kind: 'readiness-timeout' }` — the spec is
  never run and the case is never assumed ready, matching this phase's
  fail-closed boundary already established for `llm-judge` (sub-quorum) and
  `deterministic` (pass-condition) judging.
- **Run the Playwright spec via plain bash — agent-neutral.** `` `npx playwright
  test ${binding.spec}` `` run through the injected `bash` (default
  `realBashRunner`), the same seam `judgeCheck` already uses. `npx` is the one
  invocation that resolves a locally-installed `playwright` binary regardless
  of which package manager populated `node_modules/.bin` (npm, pnpm, or yarn
  all support it) — Playwright itself is the fixed, user-owned dependency this
  phase already commits to (via `kind: web`'s `spec` field), so this does not
  newly violate `generalizable-defaults`, it is the least ecosystem-specific way
  to invoke it. `passed = result.exitCode === 0` — Playwright's own reduction of
  a spec run to pass/fail, no interpretation of stdout.
- **Teardown in `finally`, always.** `handle.kill()` runs in a `finally`
  wrapping the readiness loop and the spec run, so it executes on the pass
  path, the fail path, the readiness-timeout path, and when `bash`/`fetch`
  throws unexpectedly — the exception still propagates (nothing swallows it),
  it just teardowns first. No explicit try/catch is needed around the spec
  invocation for this guarantee; `finally` alone satisfies it.
- **Test seams for a real clock.** `now`/`sleep` are injectable so
  `readiness.feature`'s timeout scenario runs instantly in unit tests (a fake
  `now()` that advances past the deadline, a `sleep` stub that resolves without
  delay) rather than actually waiting out a `timeoutMs`.
- **Deferred reduction to `CaseVerdict`.** `WebLifecycleOutcome` is intentionally
  not a `CaseVerdict` — reducing it into that shape and folding it into the
  `deterministic` contributor is `web-deterministic-fold`'s job (per
  `batch.yaml`'s phase decomposition). This keeps this change a thin, provable
  vertical slice: the harness's own start/poll/run/teardown contract, testable
  in isolation, with a narrow return type the next change composes.

**Documentation** (per the `documentation` standard — mandatory, not optional):
- `docs/eval-web-lifecycle.md` (new): a Reference page for the harness, in the
  same style as `docs/eval-verdict-aggregation.md`. Since this is a core flow
  (start → poll → run → teardown), it opens with an `## Overview` section whose
  first artifact is a vertical (`flowchart TD`) Mermaid diagram of that flow,
  high-contrast `classDef`s each with an explicit `color:`, and semantic
  Unicode symbols (⚙️ background process, 🌐 readiness probe, ✅/❌ outcomes).
  Documents `runWebLifecycle`'s contract, the injectable deps, and the
  `WebLifecycleOutcome` shape, and states plainly that `judgeCase` does not yet
  call it (deferred to `web-deterministic-fold`), so the doc never claims
  aspirational end-to-end behavior.
- `docs/commands/eval.md`'s existing `### Web binding` section gets a short
  addition describing the now-implemented lifecycle mechanics and linking to
  the new page — the field table there already documents `start`/`readiness`/
  `spec`, this just adds what runs them.

## Tasks

- [x] 1.1 Add `src/core/eval/web-lifecycle.ts`: `ProcessHandle`, `ProcessStarter`,
      `realProcessStarter`, `ReadinessChecker`, `defaultReadinessChecker`,
      `WebLifecycleDeps`, `WebLifecycleOutcome`, and `runWebLifecycle` per the
      Design section (background start, fail-closed readiness poll, bash-run
      Playwright spec, `finally`-teardown on every path).
- [x] 1.2 Barrel `runWebLifecycle`, `WebLifecycleOutcome`, `WebLifecycleDeps`,
      `ProcessHandle`, `ProcessStarter`, `WebBinding`, and `WebReadiness`
      through `src/core/eval/index.ts`.
- [x] 2.1 Add `test/core/eval/web-lifecycle.test.ts` covering
      `features/web-lifecycle/readiness.feature`: URL-probe readiness success,
      command-probe readiness success, and readiness-never-succeeds timing out
      (spec not run, process torn down) — using injected `start`/`checkReadiness`/
      `sleep`/`now` fakes so no test spawns a process or waits in real time.
- [x] 2.2 Extend `test/core/eval/web-lifecycle.test.ts` covering
      `features/web-lifecycle/run-and-teardown.feature`: passing spec (exit 0),
      failing spec (non-zero exit), teardown still runs and the error still
      propagates when the injected `bash`/`checkReadiness` throws unexpectedly,
      and the Playwright invocation goes through the injected `bash` fn directly
      (no spawner/agent adapter involved) to prove it is agent-neutral.
- [x] 3.1 Add `docs/eval-web-lifecycle.md` per the `documentation` standard: an
      `## Overview` with a vertical, high-contrast Mermaid flowchart of
      start/poll/run/teardown, plus the harness's contract, deps, and
      `WebLifecycleOutcome` shape, noting it is not yet wired into `judgeCase`.
- [x] 3.2 Update `docs/commands/eval.md`'s `### Web binding` section to describe
      the implemented lifecycle mechanics and link to
      `docs/eval-web-lifecycle.md`.
