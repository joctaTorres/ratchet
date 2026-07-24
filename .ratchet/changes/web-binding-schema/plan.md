# Web binding schema

## Why

Tier-4 has no way to describe a browser scenario as an eval-spec binding — only
`deterministic` (bash check) and `llm-judge` (spawned agent) exist. Before the
`playwright-web-tier` phase can build the boot/readiness/run/teardown harness, a
case must be able to declare *that* it is a browser scenario and *what* it needs
to run one: an app to boot, a way to know it's ready, and the Playwright spec
that drives its Given/When/Then. This change adds that declaration — the schema
only — so later changes in the phase have a typed contract to execute against.

## What Changes

- `BindingKind` in `src/core/eval/spec.ts` gains `'web'` alongside `'deterministic'`
  and `'llm-judge'`.
- A new `WebBindingSchema` joins `BindingSchema`'s discriminated union with:
  `fixture` (existing), `kind: 'web'`, `start` (boot command), `readiness` (a
  URL-or-command probe paired with a required `timeoutMs`), `spec` (path to the
  Playwright test), and an optional `setup` (existing convention).
- `ratchet eval set` (`src/commands/eval/set.ts`) reports `web`-bound cases with
  the `web` kind label, alongside `deterministic` / `llm-judge` / `unbound`.
- `docs/commands/eval.md`'s `## Bindings` section documents the new binding
  shape, per `documentation`: a `### Web binding` subsection with an example and
  a field table, matching the style of the existing `### Deterministic binding`
  and `### LLM-judge binding` subsections.
- Out of scope for this change (later changes in the `playwright-web-tier`
  phase): the lifecycle harness that boots/probes/runs/tears down, the
  `web`→`deterministic` contributor-gate wiring, failure-artifact capture, and
  the conditional `ratchet doctor` Playwright probe. This change only makes the
  binding representable and visible in `eval set`; nothing yet executes it.

## Design

- **Readiness is a discriminated shape, not a bare string.** `readiness` is an
  object carrying exactly one of `url` or `command` plus a required `timeoutMs`:

  ```ts
  const WebReadinessSchema = z
    .object({
      url: z.string().min(1).optional(),
      command: z.string().min(1).optional(),
      timeoutMs: z.number().int().positive(),
    })
    .refine((r) => (r.url ? 1 : 0) + (r.command ? 1 : 0) === 1, {
      message: 'readiness requires exactly one of "url" or "command"',
    });
  ```

  Keeping `url` and `command` as sibling optional fields (refined to exactly
  one) mirrors how `DeterministicBindingSchema.check` is already a plain object
  rather than a nested discriminated union — simplest shape that still rejects
  zero-or-both at parse time.
- **No default `timeoutMs`.** The field is required with no fallback. A missing
  or zero/negative timeout would either fail to parse (good) or silently pick a
  number tuned to ratchet's own fixtures (bad, `generalizable-defaults`). The
  fail-closed contract described in the phase goal — "readiness not reached
  within it is a failure, never an assumed-ready pass" — is a property of the
  *harness* that consumes this field in a later change; this change's job is
  only to make the timeout mandatory so that harness has no way to skip it.
- **`start` and `spec` are plain strings, not playwright-specific.** `start` is
  a bash command (matches `check.run` / `setup`'s existing convention: a shell
  command run against the fixture working copy). `spec` is a repo-relative path
  string with no assumed runner — the change that wires execution decides how
  the path is invoked. Neither field hardcodes a package manager or test
  runner, satisfying `generalizable-defaults`.
- **`WebBindingSchema` joins the existing discriminated union** on `kind`,
  next to `DeterministicBindingSchema` and `LlmJudgeBindingSchema`, so
  `resolveEntry`'s existing `BindingSchema.safeParse` validation and warning
  path covers `web` bindings for free — no new parsing branch needed.
  `DeterministicBinding` / `LlmJudgeBinding` already export inferred types from
  the union members; `WebBinding` follows the same pattern.
- **`eval set`'s `SetCaseView.binding` union gains `'web'`.** `evalSetCommand`
  already derives the label from `bound.binding.kind`, so the only change is
  the type union and the color/tag branch already generalized to
  `chalk.green(\`[${v.binding}]\`)` for any bound kind — no new rendering branch,
  just the widened type.
- **Docs**: add a `### Web binding` subsection to `docs/commands/eval.md`
  between `### LLM-judge binding` and `## Fixtures`, with a YAML example and a
  field table in the same format as the two existing subsections, documenting
  `fixture`, `kind`, `start`, `readiness.url`/`readiness.command`,
  `readiness.timeoutMs`, `spec`, and `setup`. This is a small, non-core config
  shape (three sibling binding kinds already documented the same way) so no
  Mermaid diagram is warranted under `documentation`'s "core/central/large"
  bar — the existing bindings section has none either.
- **No contributor-gate change.** The phase goal gates the web binding on
  Playwright exit-zero "as a deterministic contributor" — i.e. a later change
  routes `web` verdicts through the existing `deterministic` `ContributorId`
  rather than minting a new one. `src/core/eval/aggregate.ts` and `gate.ts` are
  untouched here.

## Tasks

### 1. Schema

- [x] 1.1 In `src/core/eval/spec.ts`, add `WebReadinessSchema` (url-xor-command
      + required `timeoutMs`) and `WebBindingSchema` (`fixture`, `kind: 'web'`,
      `start`, `readiness`, `spec`, optional `setup`).
- [x] 1.2 Add `WebBindingSchema` to `BindingSchema`'s discriminated union; widen
      `BindingKind` to `'deterministic' | 'llm-judge' | 'web'`; export
      `WebBinding` (and `WebReadiness` if useful) inferred types alongside the
      existing `DeterministicBinding` / `LlmJudgeBinding` exports.

### 2. `eval set` reporting

- [x] 2.1 In `src/commands/eval/set.ts`, widen `SetCaseView.binding` to include
      `'web'` so `web`-bound cases render as `[web]` through the existing
      generalized tag/color logic.

### 3. Tests

- [x] 3.1 In `test/core/eval/spec.test.ts`, add unit tests per
      `features/eval-web-binding/web-binding-schema.feature`: a valid `web`
      binding with a URL readiness resolves; a valid `web` binding with a
      command readiness resolves; a binding with neither `url` nor `command`
      is rejected with a warning; a binding missing `timeoutMs` is rejected; a
      binding missing `spec` is rejected; a `web` binding with `setup` is
      accepted the same way `deterministic`/`llm-judge` bindings are.
- [x] 3.2 In `test/commands/eval/set.test.ts` (and/or its `eval-fixture.ts`
      helper), add a case bound with `kind: web` and assert it is tagged
      `[web]` in both the JSON (`binding: "web"`) and text output, alongside
      the existing `deterministic`/`llm-judge`/`unbound` cases.
- [x] 3.3 Run the full suite and coverage gate; confirm no regression per
      `testing` (95% floor, pyramid-appropriate placement — these are unit
      tests over `spec.ts` and an integration test over the `eval set` verb,
      no new E2E needed since the CLI surface shape is unchanged).

### 4. Documentation

- [x] 4.1 Per `documentation`, add a `### Web binding` subsection to the
      `## Bindings` section of `docs/commands/eval.md`: a YAML example (`kind:
      web` with `start`, `readiness.url` or `readiness.command`,
      `readiness.timeoutMs`, `spec`, optional `setup`) and a field table
      matching the existing `### Deterministic binding` / `### LLM-judge
      binding` subsections' format.
- [x] 4.2 Check `README.md` for any binding-kind enumeration or eval-spec
      example that lists `deterministic` / `llm-judge`; update it to mention
      `web` if such a list exists, per `documentation`'s README-sync rule. (No
      new diagram: bindings are a small, already-multiply-instanced config
      shape, not a core/large surface under `documentation`'s diagram bar.)
