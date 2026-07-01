# rubric-decomposition

## Why

Today the `llm-judge` contributor returns one flat `{pass, reason}` per vote: the
spawned agent forms a single holistic impression of a whole scenario and can pass
it on a vague, sycophantic, or partially-true reading — a scenario with three
`Then` clauses can pass on evidence for one. The judge-hardening phase needs a
fail-closed rubric: each Then-clause judged and cited independently, with
all-yes required, before any panel/skip/persistence work can build on it.

## What Changes

- `judge.ts` gains a rubric-derivation step: `deriveRubric(c: EvalCase, binding:
  LlmJudgeBinding): string[]` walks `EvalCase.steps`, opens a new rubric item on
  every `Then` step, and appends an item for every `And`/`But` step that follows a
  `Then` (until the next `Given`/`When`/`Then` step). `And`/`But` steps under
  `Given`/`When` are excluded.
- `LlmJudgeBindingSchema` (`src/core/eval/spec.ts`) gains an optional `rubric:
  z.array(z.string().min(1)).optional()`. When present it is used verbatim and
  `deriveRubric` is not consulted (explicit override wins).
- `buildJudgeInstructions` is rewritten around the derived/declared rubric: it
  lists every clause, requires the agent to reason step-by-step about each clause
  **before** stating that clause's verdict (CoT-before-verdict), instructs the
  agent to judge the evidence on its own merits rather than defer to the
  scenario's or success criteria's framing (anti-sycophancy), and asks for a
  `"yes" | "no" | "can't-tell"` verdict per clause with cited evidence.
- `AgentVote` becomes structured: `{ pass: boolean; clauses: ClauseResult[] }`
  where `ClauseResult = { clause: string; pass: boolean; evidence: string }`.
  `parseAgentVote` parses the agent's per-clause JSON, fails closed on any
  missing/unparseable/`"can't-tell"` clause (`pass: false`), and derives the
  vote's own `pass` as all-yes over `clauses` (any non-pass clause fails the
  vote).
- `CaseVerdict.reason: string` is replaced by `CaseVerdict.evidence:
  ClauseResult[]` — the structured per-clause result of whichever vote decided
  the case (the deciding pass vote, or `votes[0]` on a clean fail). The
  `deterministic` path keeps a single-clause-equivalent shape so `judgeCase`
  returns one type regardless of binding kind (a one-item `clauses` array
  carrying the existing check pass/fail detail as `evidence`).
  **BREAKING**: callers reading `CaseVerdict.reason` (none outside
  `judge.ts`/its tests today) must switch to `CaseVerdict.evidence`.
- `resolveVotes` keeps its existing N-votes-majority-of-pass/fail behavior
  unchanged in shape (majority/disagreement/unjudged), now operating over each
  vote's all-yes-derived `pass` instead of a single agent-reported boolean, and
  selecting/returning structured `evidence` instead of a `reason` string.
- Implements `features/eval-judge/rubric-decomposition.feature` in this change.

## Design

- **Rubric derivation lives next to the prompt builder.** `deriveRubric` reads
  `EvalCase.steps` (already parsed by `gherkin-parser.ts`) the same way
  `renderSteps` does today — no parser changes needed in this slice. A clause
  boundary opens on `keyword === 'Then'` and stays open through subsequent
  `And`/`But` until a `Given`/`When`/`Then` keyword is seen again. This matches
  the phase success criterion ("one item auto-derived per Then/And/But-under-Then
  step") without touching `gherkin-parser.ts` (tag capture for `@skip` is the
  `skip-filters` change's concern, not this one).
- **Explicit override is a schema field on the binding, not a separate file.**
  Keeping `rubric:` on `LlmJudgeBindingSchema` mirrors how `success:` already
  lives there, keeps the binding the single source of judging config, and needs
  no new file-discovery path.
  Precedence: `binding.rubric ?? deriveRubric(c, binding)`.
- **All-yes gating happens at the vote level, not the case level.** This keeps
  `resolveVotes`'s existing majority-of-N-votes shape intact for this slice
  (multi-vote *quorum* config is the `jury-quorum-resolution` change). Each vote
  computes its own boolean `pass` as `clauses.every(c => c.pass)`; everything
  downstream of that boolean (majority counting, disagreement → `unjudged`)
  needs no change.
- **`"can't-tell"` is a fail-closed value, not a third outcome that propagates.**
  A clause result's `pass` is `true` only for an explicit `"yes"`; `"no"` and
  `"can't-tell"` both record `pass: false` with whatever evidence/explanation the
  agent gave (or a generated "no verdict for this clause" note when the clause is
  unaddressed in the agent's output). This keeps `ClauseResult.pass: boolean`
  simple while still satisfying "fail-closed on any no/can't-tell clause".
  Storing the three-way value would only be needed once the run JSON persists it
  (the `structured-evidence-persistence` change); this slice exposes it through
  the clause's `evidence` text instead of widening the type prematurely.
  Re-derived in `structured-evidence-persistence` if that change needs the literal.
- **Deterministic bindings get a uniform `CaseVerdict` shape.** Rather than a
  union (`reason: string` for deterministic vs `evidence: ClauseResult[]` for
  llm-judge), `judgeCheck` wraps its existing pass/fail detail as a single-item
  `clauses` array (e.g. `[{ clause: binding.check.pass, pass, evidence: detail
  }]`). This avoids a discriminated-union ripple through every `CaseVerdict`
  consumer for a kind that has no rubric concept of its own, and keeps
  `judgeCase`'s return type one shape.
- **Prompt structure.** `buildJudgeInstructions` enumerates the rubric as a
  numbered list, asks for a JSON array on the last block:
  `[{"clause": "...", "verdict": "yes"|"no"|"can't-tell", "evidence": "..."}]`
  (one entry per rubric item), with explicit instructions to (1) investigate and
  reason about each clause before deciding it, and (2) reach an independent
  judgment from observed evidence rather than assume the scenario's framing is
  accurate. `extractVerdictJson`'s balanced-brace/array scanning needs to extend
  to arrays (today it only scans `{...}` objects) — reuse the same
  string-literal-aware scanner for top-level `[...]` blocks.
- **Trade-off accepted:** prompts grow (one reasoning+verdict request per clause
  instead of one overall ask), which costs more judge tokens per case. This is
  the explicit phase trade-off (precision over cost) and is not reversible
  in-scope; it is not configurable in this slice.

## Tasks

- [x] 1.1 Add `rubric?: string[]` to `LlmJudgeBindingSchema` in `src/core/eval/spec.ts`
- [x] 1.2 Implement `deriveRubric(c, binding)` in `src/core/eval/judge.ts`: one item per `Then` step plus each following `And`/`But` until the next `Given`/`When`/`Then`; `Given`/`When`-rooted `And`/`But` excluded; `binding.rubric` short-circuits derivation when present
- [x] 1.3 Rewrite `buildJudgeInstructions` to enumerate the rubric, require step-by-step reasoning before each clause's verdict (CoT-before-verdict), instruct independent judgment of evidence over the scenario's framing (anti-sycophancy), and request a per-clause `yes|no|can't-tell` + evidence JSON array
- [x] 1.4 Define `ClauseResult { clause, pass, evidence }` and change `AgentVote` to `{ pass, clauses: ClauseResult[] }`; rewrite `parseAgentVote` to parse the per-clause array, fail closed (`pass: false`) on `"no"`, `"can't-tell"`, an unaddressed clause, or an unparseable response, and derive vote `pass` as all-yes over `clauses`
- [x] 1.5 Extend the balanced-block scanner (`extractVerdictJson`/`balancedBraceBlocks`) to also recognize a top-level `[...]` array so the per-clause verdict array parses the same way the prior single-object verdict did
- [x] 1.6 Replace `CaseVerdict.reason: string` with `CaseVerdict.evidence: ClauseResult[]`; update `resolveVotes` to select/return structured `evidence` from the deciding vote while keeping its existing majority/disagreement/unjudged behavior over each vote's derived `pass`
- [x] 1.7 Update `judgeCheck` (deterministic path) to return a one-item `clauses`-shaped `CaseVerdict.evidence` so `judgeCase` has one return shape across both binding kinds
- [x] 1.8 Update `test/core/eval/judge.test.ts` and `.ratchet/features/eval-judge/engine-backed-judge.feature`'s implementing tests for the new `CaseVerdict.evidence`/`AgentVote.clauses` shape; add unit tests for `deriveRubric` (Then-only, Then+And/But, Given/When And/But excluded, explicit override) and `parseAgentVote` (all-yes pass, single no/can't-tell fails closed, unaddressed clause fails closed) per [[testing]]
- [x] 1.9 Per [[documentation]]: update `docs/commands/eval.md`'s "LLM-judge binding" table (add `rubric`) and "Agent judge guarantees" section (per-clause all-yes gating, CoT-before-verdict, anti-sycophancy) referencing this standard, and update `README.md`'s `llm-judge` binding example/guard-rail prose (lines ~393-423) to match the new per-clause structured verdict
