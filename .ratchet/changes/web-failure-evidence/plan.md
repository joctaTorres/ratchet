# web-failure-evidence

## Why

`kind: web` bindings now run end-to-end (`web-lifecycle-harness`,
`web-deterministic-fold`): a failure is judged correctly, but nothing survives
past the throwaway fixture working copy to explain *why* it failed beyond a
one-line exit-code sentence. The phase's definition of done requires a failed
`web`-bound case to capture the Playwright trace and a screenshot and persist
them as durable run evidence — referenced by path from the case's record, the
same structured-sibling-field shape `structured-evidence-persistence` already
established for `rubric`/`votes`/`skip` — so a browser-scenario regression is
reproducible from the run record alone, without re-running the app or digging
through a tmp directory that nothing ever cleans up.

## What Changes

- `src/core/eval/web-lifecycle.ts`: the Playwright invocation forces
  `--trace=retain-on-failure` and routes a JSON report to a file via
  `PLAYWRIGHT_JSON_OUTPUT_NAME`, alongside the existing human-readable `list`
  reporter on stdout. After the spec runs, `runWebLifecycle` reads that JSON
  report and extracts whichever `trace`/`screenshot` attachments Playwright
  itself recorded, exposing them as a new optional `artifacts?: WebArtifacts`
  field on `WebLifecycleOutcome`'s `completed` variant. A new `WebArtifacts`
  type (`{ trace?: string; screenshot?: string }`) is exported.
- `src/core/eval/judge.ts`: `CaseVerdict` gains `artifacts?: WebArtifacts`;
  `judgeWeb` copies `outcome.artifacts` straight through when present.
  `judgeCheck`/`judgeAgent`/`unjudgedModeMismatch` are untouched — `artifacts`
  is `web`-only and stays absent for every other binding kind.
- `src/core/eval/run.ts`: `CaseRecord` gains `artifacts?: WebArtifacts` (a
  structured sibling of `reason`, present only on a failed judged `web`-bound
  case that captured at least one file). New `runArtifactsDir(projectRoot,
  runId, caseId)` and `persistCaseArtifacts(projectRoot, runId, caseId,
  artifacts)` — the latter copies the harness's ephemeral, fixture-cwd-scoped
  files into `.ratchet/evals/runs/<runId>/artifacts/<caseId>/` and returns
  their paths relative to `projectRoot`, i.e. the moment ephemeral evidence
  becomes durable run evidence.
- `src/core/eval/execute.ts`: `judgeBound` (now taking `projectRoot`/`runId`)
  calls `persistCaseArtifacts` when `judgeCase`'s verdict carries `artifacts`,
  and sets the returned `CaseRecord.artifacts` to the durable, project-relative
  result.
- `src/core/eval/report.ts`: `CaseDetail` gains `artifacts?: WebArtifacts`,
  populated from the record exactly like the existing `skip` field.
- `src/commands/eval/report.ts`: `printCaseDetail` prints a failing case's
  `Trace: <path>` / `Screenshot: <path>` lines beneath the existing per-clause
  breakdown, when present.
- `src/core/eval/index.ts` barrel: export `type WebArtifacts` from
  `web-lifecycle.js`; export `runArtifactsDir`, `persistCaseArtifacts` from
  `run.js`.
- Implements `features/web-failure-evidence/failure-artifacts.feature`.
- **Out of scope** (later change in the `playwright-web-tier` phase per
  `.ratchet/batches/mature-eval/batch.yaml`): the conditional `ratchet doctor`
  Playwright probe (`doctor-conditional-playwright-probe`).
- No agent-facing surface (no skills/commands/templates) — the Playwright
  invocation stays a plain `bash(command, cwd)` call with no agent involved,
  matching `judgeWeb`'s existing agent-neutral construction.

## Design

- **Trace is forced; screenshot is Playwright's own opt-in, read from its own
  report — never fabricated.** Verified directly against Playwright 1.61's
  `test` CLI (`npx playwright test --help`): `--trace <mode>` is a real CLI
  override, but there is **no** `--screenshot` CLI flag — screenshot capture is
  exclusively a `playwright.config.ts` `use.screenshot` setting, with no way to
  force it from the invocation. A live run against a minimal fixture confirmed
  the shape precisely: with only `--trace=retain-on-failure` set, a failing
  test's JSON-reporter attachments contained `trace` (and Playwright's own
  `error-context`) but no `screenshot`; adding `use: { screenshot:
  'only-on-failure' }` to the fixture's `playwright.config.ts` made a
  `screenshot` attachment (`test-failed-1.png`) appear; a passing test produced
  zero attachments either way. So this change forces the one flag that *is*
  forceable (trace) and, for the screenshot, reads whichever attachments
  Playwright itself reports rather than assuming one exists — the harness
  never claims a screenshot was captured when the project's own Playwright
  config didn't enable it. This is the honest, config-independent contract:
  the phase's "captures the trace and a screenshot" is satisfied whenever
  Playwright records both, and is never gamed by fabricating a path that
  doesn't exist.
- **Playwright's own JSON reporter is the source of truth for what was
  captured, not filesystem globbing.** Rather than guessing at Playwright's
  internal `--output` directory/file naming (which is title-dependent and
  undocumented as a stable contract), the harness adds the `json` reporter
  alongside the existing human-readable `list` reporter
  (`--reporter=list,json`) and points the JSON reporter at a file via the
  `PLAYWRIGHT_JSON_OUTPUT_NAME` env var (verified live: with that env var set,
  `list`'s human output still goes to stdout — unchanged from today — while
  the JSON report, containing each test result's `attachments: [{name,
  contentType, path}]`, goes to the named file). The env var is set inline in
  the shell command string (`PLAYWRIGHT_JSON_OUTPUT_NAME=<file> npx
  playwright test ...`) rather than by widening `BashRunner`'s `(command,
  cwd)` signature to accept an `env` parameter — that seam is shared by
  `judgeCheck` and the batch engine's proof-of-work runner, and threading a new
  parameter through it for this one caller is unjustified churn when a plain
  shell-level env assignment does the same thing.
- **Reading the report is a new injectable seam, following the existing
  pattern.** `WebLifecycleDeps` gains `readReport?: (path: string) =>
  Promise<string>`, mirroring the `FileReader` seam `invariant-evaluator.ts`
  already established for "read a file as part of evaluation" (not reused
  directly — that type lives in an unrelated module; this is the same
  one-line shape, declared locally to avoid a cross-cutting import between
  orthogonal concerns). The default reads the real file
  (`fs.promises.readFile`); tests inject a fake returning canned JSON, so no
  test spawns Playwright or touches a real report file.
- **Extraction fails soft, verdict stays fail-closed.** Reading or parsing the
  report can fail (Playwright crashed before writing one, an unexpected
  schema) — that failure is caught and treated as "no artifacts", never as an
  error that crashes the run or changes the verdict. The verdict is decided
  purely by `result.exitCode` exactly as it is today; artifact capture is
  strictly additive evidence, so a report-read failure can only ever cost
  evidence, never mask or manufacture a pass/fail. This also means every
  existing `web`-lifecycle/`judge`/`execute` test that injects a fake `bash`
  without a real Playwright report continues to pass unchanged: the (real,
  unfaked) default `readReport` simply hits `ENOENT` against a file that was
  never written and resolves to no artifacts.
- **A passing case captures no artifact by Playwright's own construction, not
  by a harness special-case.** `retain-on-failure` (trace) and
  `only-on-failure` (screenshot, when configured) are Playwright's own
  conditional-capture semantics — confirmed live: a passing run's JSON report
  has `attachments: []`. The harness does one unconditional thing (read
  whatever the report says) on every completed run; the phase's "a passing
  case captures no artifact" falls out of that without an `if (failed)`
  branch anywhere in `runWebLifecycle`.
- **Readiness-timeout still captures nothing, unchanged.** That branch returns
  before the Playwright spec (and therefore the report) exists at all — no
  report path is ever read on that path, matching the existing code structure.
- **Ephemeral in the harness, durable at persistence — the same layering
  `structured-evidence-persistence` used for `skip`.** `runWebLifecycle`/
  `judgeWeb` know nothing about run ids or the project's `.ratchet/`
  directory — they only see the fixture's throwaway working copy (`cwd`), so
  `CaseVerdict.artifacts` carries the harness's own ephemeral, absolute,
  cwd-scoped paths, exactly as Playwright reported them. `execute.ts` is
  already the one layer that knows both `projectRoot` and the run's id (it
  already calls `persistRun`), so it is where "ephemeral evidence" becomes
  "persisted run evidence": `persistCaseArtifacts` copies each present file
  into `.ratchet/evals/runs/<runId>/artifacts/<caseId>/` and returns
  project-relative paths. This is the layering that makes "reproducible from
  the run record alone" literally true — the fixture tmp directory
  `FixtureManager` never cleans up can vanish (OS temp-dir eviction, another
  run reusing the same cache key) without invalidating the run's own evidence.
  `runArtifactsDir`/`persistCaseArtifacts` live in `run.ts` next to
  `runsDir`/`runPath`, the module that already owns the run's on-disk layout.
- **`WebArtifacts` is one type, reused across the ephemeral and durable
  shapes.** Same precedent as `ClauseResult`/`JurorVote` (defined once in
  `judge.ts`, carried unchanged from in-memory judging into the persisted
  `CaseRecord` and the report's `CaseDetail`): `WebArtifacts` is defined once
  in `web-lifecycle.ts` and flows through `CaseVerdict.artifacts` (ephemeral,
  absolute paths) into `CaseRecord.artifacts`/`CaseDetail.artifacts` (durable,
  project-relative paths) unchanged in shape, only in path meaning — each call
  site's doc comment says which.
- **`ClauseResult` is not widened.** `artifacts` is case-level (one trace, one
  screenshot per Playwright run), not per-clause, and is `web`-only; adding it
  to `ClauseResult` would ripple an unused optional field into every
  `deterministic`/`llm-judge` clause for no reason. It lives as a structured
  sibling field on `CaseVerdict`/`CaseRecord`/`CaseDetail` instead — the same
  choice `structured-evidence-persistence` made for `skip`.
- **CLI surfacing follows the existing free-JSON / explicit-text split.**
  `eval report --json`/`eval run --json` already serialize the full
  `EvalReport`/`report.cases`, so `artifacts` reaches JSON output for free the
  moment it exists on `CaseDetail` — no command-layer JSON change needed. Text
  output gains two dim lines (`Trace: ...`, `Screenshot: ...`) under
  `printCaseDetail`'s existing per-clause breakdown, printed only when
  present.

**Documentation** (per the `documentation` standard — mandatory, not
optional):
- `docs/eval-web-lifecycle.md`: update the "Run the spec" sequence step to
  describe the forced `--trace=retain-on-failure`, the `list,json` reporter
  pair with `PLAYWRIGHT_JSON_OUTPUT_NAME`, and the resulting `artifacts`
  extraction (including the honest screenshot caveat: only present when the
  project's own `playwright.config` enables `use.screenshot`); update the
  `WebLifecycleDeps` table with `readReport`; update `WebLifecycleOutcome`'s
  shape to include `artifacts?: WebArtifacts`; update the Overview Mermaid
  diagram's FAIL path to show an artifact-capture step before teardown.
- `docs/commands/eval.md`: `### Web binding` section's closing paragraph
  currently says trace/screenshot capture is deferred — replace with the
  now-true statement (captured on failure, persisted under
  `.ratchet/evals/runs/<run-id>/artifacts/<case-id>/`, referenced by path from
  the run JSON), keeping only the `ratchet doctor` probe as deferred. `eval
  run`'s Behavior section (the existing "Structured per-case detail" step)
  gains a sentence noting a failed `web`-bound case's `artifacts.trace`/
  `artifacts.screenshot` paths persist alongside `rubric`/`clauses`/`votes`.
  `eval report`'s Behavior section's `CaseDetail` shape listing gains
  `artifacts?` and a note that the text rendering prints the trace/screenshot
  paths beneath the per-clause breakdown.
- `README.md`: the existing "A third kind, `web`, ..." paragraph gains a
  clause noting a failure now persists its Playwright trace (and a screenshot
  when the project's Playwright config captures one) as run evidence.

## Tasks

### 1. Harness: capture and expose artifacts

- [x] 1.1 In `src/core/eval/web-lifecycle.ts`: add `export interface
      WebArtifacts { trace?: string; screenshot?: string }`; add
      `readReport?: (path: string) => Promise<string>` to `WebLifecycleDeps`
      with a real default reading the file at that path (`fs.promises.readFile`,
      utf-8); add `artifacts?: WebArtifacts` to `WebLifecycleOutcome`'s
      `completed` variant.
- [x] 1.2 Change the Playwright bash invocation to `` `PLAYWRIGHT_JSON_OUTPUT_NAME=${REPORT_FILE_NAME} npx playwright test ${binding.spec} --trace=retain-on-failure --reporter=list,json` `` (a local `REPORT_FILE_NAME` constant, e.g. `.ratchet-web-report.json`); after the bash call resolves, read `path.join(cwd, REPORT_FILE_NAME)` via `readReport` and extract attachments per the Design section (a small internal walker over the JSON reporter's `suites[].specs[].tests[].results[].attachments[]`, matching `name === 'trace'` / `name === 'screenshot'`); set `artifacts` on the returned outcome only when at least one was found; any read/parse failure is caught and treated as no artifacts (never thrown, never changes `passed`).
- [x] 1.3 Barrel `type WebArtifacts` through `src/core/eval/index.ts` alongside the existing `web-lifecycle.js` exports.

### 2. Judge: carry artifacts through the verdict

- [x] 2.1 In `src/core/eval/judge.ts`: import `type WebArtifacts` from
      `./web-lifecycle.js`; add `artifacts?: WebArtifacts` to `CaseVerdict`;
      in `judgeWeb`, spread `outcome.artifacts` onto the returned verdict when
      present (both the pass and fail branches — presence is decided entirely
      by what the harness reports, not by `judgeWeb` re-deciding pass/fail).

### 3. Persistence: ephemeral → durable run evidence

- [x] 3.1 In `src/core/eval/run.ts`: import `type WebArtifacts` from
      `./web-lifecycle.js`; add `artifacts?: WebArtifacts` to `CaseRecord`; add
      `runArtifactsDir(projectRoot, runId, caseId): string` (`path.join(runsDir(projectRoot), runId, 'artifacts', caseId)`)
      and `persistCaseArtifacts(projectRoot, runId, caseId, artifacts:
      WebArtifacts): WebArtifacts | undefined` — for each of `trace`/
      `screenshot` present on the input, `mkdirSync(dir, {recursive: true})`
      then `copyFileSync` the source into that directory under its own
      basename, collecting the copied file's path relative to `projectRoot`;
      returns `undefined` when neither is present (nothing to persist, nothing
      created on disk).
- [x] 3.2 In `src/core/eval/execute.ts`: widen `judgeBound` to take
      `projectRoot: string, runId: string` (first two params); after computing
      `verdict`, call `persistCaseArtifacts(projectRoot, runId, c.id,
      verdict.artifacts)` when `verdict.artifacts` is present and set the
      result on the returned `CaseRecord.artifacts`; update `executeRun`'s call
      site to pass `projectRoot, run.runId`.
- [x] 3.3 Barrel `runArtifactsDir`, `persistCaseArtifacts` through
      `src/core/eval/index.ts` alongside the existing `run.js` exports.

### 4. Report and CLI surfacing

- [x] 4.1 In `src/core/eval/report.ts`: add `artifacts?: WebArtifacts` to
      `CaseDetail` (import the type from `./judge.js`'s re-export or directly
      from `./web-lifecycle.js`); populate it in `caseDetails()` from
      `record?.artifacts`, conditionally spread exactly like the existing
      `skip` field.
- [x] 4.2 In `src/commands/eval/report.ts`'s `printCaseDetail`, print `Trace:
      <path>` and `Screenshot: <path>` dim lines (each only when present)
      beneath the existing per-clause breakdown.

### 5. Tests

- [x] 5.1 Update the 5 existing exact-command-string assertions in
      `test/core/eval/web-lifecycle.test.ts` (both the `fakeBash` response
      keys and the `bashCalls`/`toBe` assertions) to the new command string
      from task 1.2, per [[testing]]. Existing tests that don't inject
      `readReport` continue to pass unchanged (the real default hits `ENOENT`
      against a report that was never written and yields no artifacts) — add
      an explicit test asserting exactly that (no `readReport` override, no
      thrown error, `outcome.artifacts` is `undefined`).
- [x] 5.2 Add unit tests in `test/core/eval/web-lifecycle.test.ts` covering
      `features/web-failure-evidence/failure-artifacts.feature`: a
      `readReport` fake returning JSON with only a `trace` attachment yields
      `outcome.artifacts` = `{ trace: <path> }`; one with both `trace` and
      `screenshot` attachments yields both; one with `attachments: []` (a
      passing run) yields `outcome.artifacts` `undefined`; a `readReport` that
      throws (report file missing) yields `outcome.artifacts` `undefined` with
      no thrown error and `passed`/`result` unaffected; the readiness-timeout
      path never calls the injected `readReport` at all.
- [x] 5.3 Extend `test/core/eval/judge.test.ts`'s `judgeCase: web` describe
      block: a failing spec whose injected `web.readReport` reports `trace`
      and `screenshot` attachments produces a `CaseVerdict.artifacts` matching
      both; a passing spec (empty attachments) produces `artifacts`
      `undefined`; the readiness-timeout case produces `artifacts` `undefined`.
- [x] 5.4 Add unit tests in `test/core/eval/run.test.ts` for
      `persistCaseArtifacts`/`runArtifactsDir`: given a real trace file and a
      real screenshot file on disk, it copies both under
      `.ratchet/evals/runs/<runId>/artifacts/<caseId>/` and returns paths
      relative to `projectRoot` pointing at the copies (not the originals);
      given `{}` (neither field), it returns `undefined` and creates no
      directory; extend the existing "round-trips rubric/clauses/votes/skip on
      a CaseRecord unchanged" test to also round-trip `artifacts`.
- [x] 5.5 Extend `test/core/eval/execute.test.ts`'s
      `executeRun: web-bound cases gate through the deterministic contributor`
      describe block per `features/web-failure-evidence/failure-artifacts.feature`:
      a failing web-bound case whose injected `web.bash`/`web.readReport`
      report a trace+screenshot ends up with `CaseRecord.artifacts.trace`/
      `.screenshot` as project-relative paths under
      `.ratchet/evals/runs/<runId>/artifacts/<caseId>/`, and the files exist on
      disk at `path.join(root, record.artifacts.trace)`; a passing web-bound
      case's `CaseRecord.artifacts` is `undefined`.
- [x] 5.6 Extend `test/core/eval/report.test.ts`: `buildReport`'s `cases[]`
      includes `artifacts` for a run whose `CaseRecord` carries it, and omits
      it (or leaves it `undefined`) for one that doesn't.
- [x] 5.7 Run the full suite and coverage gate; confirm no regression per
      [[testing]] (95% floor). No new E2E test: `kind: web` bindings are not
      exercised against a real Playwright anywhere in `test/cli-e2e/` today
      (Playwright is an opt-in, uninstalled dependency in this repo), so unit
      (`web-lifecycle.test.ts`, `judge.test.ts`) and integration
      (`execute.test.ts`, `run.test.ts`, `report.test.ts`) coverage with
      injected seams is the correct pyramid layer, matching how
      `web-lifecycle-harness`/`web-deterministic-fold` already tested this
      without a real Playwright process.

### 6. Documentation

- [x] 6.1 Per [[documentation]], update `docs/eval-web-lifecycle.md`: the "Run
      the spec" sequence step, the `WebLifecycleDeps` table (`readReport`
      row), the `WebLifecycleOutcome` shape (`artifacts?: WebArtifacts`), and
      the Overview Mermaid diagram's FAIL path (an artifact-capture node before
      teardown, high-contrast `classDef` with an explicit `color:`).
- [x] 6.2 Update `docs/commands/eval.md`'s `### Web binding` section (replace
      the "still deferred" sentence covering trace/screenshot, per the Design
      section) and the `eval run` / `eval report` Behavior sections'
      structured-detail steps to mention `artifacts`.
- [x] 6.3 Update `README.md`'s `web` binding-kind paragraph per the Design
      section.
