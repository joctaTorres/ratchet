# brainstorm-workflow

## Why

Ratchet has no collaborative front door: today a user must already know whether
their idea is one change (`/rct:propose`) or a phased effort
(`/rct:propose-batch`) before any design dialogue happens. A `/rct:brainstorm`
skill — adapted from the superpowers `brainstorming` skill — gives users a
guided design conversation that ends by recommending and routing into the right
ratchet proposer, so design thinking precedes (and chooses) the artifact path.

## What Changes

- Add a new ratchet workflow skill **`ratchet-brainstorm`** and command
  **`rct-brainstorm`** ("RCT: Brainstorm"), defined once as a shared body and
  rendered per agent — mirroring `propose-batch.ts` / `apply-batch.ts`.
- The skill runs a collaborative design flow: explore project context → ask
  clarifying questions one at a time → propose 2-3 approaches with a leading
  recommendation → present the design section-by-section with per-section
  approval. Implements `features/brainstorm/explore-and-clarify.feature` and
  `features/brainstorm/approaches-and-design.feature`.
- An optional, capability-gated visual aid offered just-in-time (never upfront,
  never depending on any server), with a text-only fallback. Implements
  `features/brainstorm/visual-companion.feature`.
- A new terminal: after design approval, recommend and (on an explicit gate)
  chain into `/rct:propose` (single change) or `/rct:propose-batch` (split into
  phases). Implements `features/brainstorm/route-to-propose-or-batch.feature`.
- **REMOVED from the source skill** (must not appear): the writing-plans / "never
  invoke any implementation skill" terminal; the decompose-into-sub-projects
  behavior; and the post-approval design-doc write, spec self-review, and written
  -spec review gate. Captured as negative scenarios in
  `features/brainstorm/route-to-propose-or-batch.feature`.
- Register the new workflow so `ratchet init` emits it for **every** supported
  agent, and add registry-iterating render tests. Implements
  `features/brainstorm/multi-agent-surface.feature`.

## Design

### Shared body rendered per agent

Following the existing pattern in `src/core/templates/workflows/propose-batch.ts`
and `apply-batch.ts`, create `src/core/templates/workflows/brainstorm.ts` with a
single `BRAINSTORM_BODY` string constant shared by:

- `getBrainstormSkillTemplate(): SkillTemplate` — `name: 'ratchet-brainstorm'`,
  `instructions: BRAINSTORM_BODY`.
- `getRctBrainstormCommandTemplate(): CommandTemplate` — `name: 'RCT: Brainstorm'`,
  `category: 'Workflow'`, `tags: ['workflow', 'brainstorm', 'experimental']`,
  `content: BRAINSTORM_BODY`.

There are no agent-specific copies of the content. The command is the genuinely
per-tool surface: the shared body is formatted into each tool's command file via
its adapter (`src/core/command-generation/registry.ts` +
`generateCommand`), and the skill body is written into each tool's
`SKILL.md`.

### Per-agent output table (enumerated empirically)

Skill dir = `<tool.skillsDir>/skills/ratchet-brainstorm/` (SKILL.md inside);
command path from each adapter's `getFilePath('rct-brainstorm')`:

| Agent          | Skill file                                      | Command file                                   |
| -------------- | ----------------------------------------------- | ---------------------------------------------- |
| claude         | `.claude/skills/ratchet-brainstorm/SKILL.md`    | `.claude/commands/rct/rct-brainstorm.md`       |
| codex          | `.codex/skills/ratchet-brainstorm/SKILL.md`     | `~/.codex/prompts/rct-rct-brainstorm.md` *     |
| cursor         | `.cursor/skills/ratchet-brainstorm/SKILL.md`    | `.cursor/commands/rct-rct-brainstorm.md`       |
| github-copilot | `.github/skills/ratchet-brainstorm/SKILL.md`    | `.github/prompts/rct-rct-brainstorm.prompt.md` |
| opencode       | `.opencode/skills/ratchet-brainstorm/SKILL.md`  | `.opencode/commands/rct-rct-brainstorm.md`     |

\* The codex adapter resolves to a global prompts dir
(`$HOME/.codex/prompts/...`), not a repo-relative path — confirmed via
`CommandAdapterRegistry.getAll()[].getFilePath('rct-brainstorm')`. Implementation
should re-derive all paths from the registry rather than hard-coding them.

### Agent-neutral phrasing

The body refers to "the coding agent" / "your agent", never "Claude". Any
tool-specific step is phrased optional-with-fallback: the structured-question
tool (e.g. AskUserQuestion) is "if your agent has one, otherwise ask in plain
prose", matching propose-batch's wording.

### Visual-companion adaptation (no server dependency)

The superpowers source assumes a bundled browser companion server; ratchet has
none. The body reframes it as an optional, capability-gated aid: "if your
agent/environment can show visuals (mockups, diagrams, comparisons), offer it
just-in-time for genuinely visual questions; otherwise continue text-only." It is
offered as its own message only the first time a question is genuinely clearer
shown than told, decided per question, and never depends on any superpowers
server or file. Plain-prose/text fallback always works.

### Routing logic (the new terminal)

After the design is approved the skill recommends a route and presents an
explicit gate before chaining in (consistent with propose-batch → apply-batch):

- Single, cohesive change → recommend and, on approval, chain into
  `/rct:propose`.
- Big effort that should be split into multiple changes → recommend and, on
  approval, chain into `/rct:propose-batch` (which does the phase slicing —
  brainstorm itself does no decomposition into separate sub-project spec cycles).

The gate is never automatic; the skill explains the why (single vs split) and
invokes no skill other than propose / propose-batch. It writes no design doc,
runs no spec self-review, and has no separate written-spec review gate.

### Registration / wiring

Register `brainstorm` everywhere the batch workflows are registered:

- `src/core/templates/skill-templates.ts` — re-export
  `getBrainstormSkillTemplate` and `getRctBrainstormCommandTemplate` from
  `./workflows/brainstorm.js`.
- `src/core/shared/skill-generation.ts` — add to `getSkillTemplates()`
  (`{ template: getBrainstormSkillTemplate(), dirName: 'ratchet-brainstorm', workflowId: 'brainstorm' }`)
  and to `getCommandTemplates()`
  (`{ template: getRctBrainstormCommandTemplate(), id: 'brainstorm' }`), plus the
  corresponding imports.
- `src/core/profiles.ts` — add `'brainstorm'` to `CORE_WORKFLOWS` and
  `ALL_WORKFLOWS` so a stock `ratchet init` emits it for all agents.

### Tests

Add `test/core/templates/workflows/brainstorm.test.ts` mirroring
`test/core/templates/workflows/propose-batch.test.ts`: assert the shared body is
shared between skill and command; assert agent-neutral phrasing and the optional
-with-fallback structured-question wording; assert the routing hand-off (both
`/rct:propose` and `/rct:propose-batch`, gated) and the removed behaviors
(no writing-plans / implementation skill, no sub-project decomposition, no design
-doc write). Add a registry-iterating test that renders the command through every
adapter via `generateCommand` and asserts the routing hand-off survives each
tool's formatting (matching `/rct[:-]propose` and `/rct[:-]propose-batch`).

## Tasks

- [x] 1.1 Read the superpowers `brainstorming` SKILL.md and the existing
  `propose-batch.ts` / `apply-batch.ts` templates to lock the shared-body style.
- [x] 1.2 Create `src/core/templates/workflows/brainstorm.ts` with a single
  `BRAINSTORM_BODY` constant and `getBrainstormSkillTemplate()` +
  `getRctBrainstormCommandTemplate()` sharing it (satisfies
  `multi-agent-surface.feature` shared-body scenario).
- [x] 1.3 Write the body's explore-context and one-at-a-time clarifying-questions
  steps, with structured-question tooling optional + plain-prose fallback
  (satisfies `explore-and-clarify.feature`).
- [x] 1.4 Write the capability-gated, just-in-time, per-question visual-aid
  section with text-only fallback and no server dependency (satisfies
  `visual-companion.feature`).
- [x] 1.5 Write the 2-3 approaches + section-by-section design + isolation/clarity
  steps with per-section approval (satisfies `approaches-and-design.feature`).
- [x] 1.6 Write the terminal routing section: recommend propose vs propose-batch,
  explicit gate, chain in on approval, no other skills (satisfies
  `route-to-propose-or-batch.feature`).
- [x] 1.7 Ensure the body omits all REMOVED behaviors (writing-plans terminal,
  sub-project decomposition, design-doc write, spec self-review, written-spec
  review gate) — verify against the negative scenarios.
- [x] 2.1 Re-export the two new template getters from
  `src/core/templates/skill-templates.ts`.
- [x] 2.2 Register the skill and command entries in
  `src/core/shared/skill-generation.ts` (`getSkillTemplates` + `getCommandTemplates`)
  with `workflowId`/`id` = `brainstorm`.
- [x] 2.3 Add `'brainstorm'` to `CORE_WORKFLOWS` and `ALL_WORKFLOWS` in
  `src/core/profiles.ts` so `ratchet init` emits it for every agent.
- [x] 3.1 Add `test/core/templates/workflows/brainstorm.test.ts`: shared-body,
  agent-neutral phrasing, optional-with-fallback tooling, routing hand-off, and
  removed-behavior assertions.
- [x] 3.2 Add a registry-iterating render test that renders the command through
  every adapter and asserts the routing hand-off survives each tool's formatting
  (satisfies `multi-agent-surface.feature` registry-iteration scenario).
- [x] 3.3 Run `pnpm build` and the test suite; confirm `ratchet init` (or an
  init-emission test) writes the skill + command to all per-agent paths in the
  table above.
