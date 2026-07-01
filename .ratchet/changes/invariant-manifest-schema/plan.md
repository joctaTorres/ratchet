# invariant-manifest-schema

## Why

The eval gate's `invariants` contributor is currently a neutral placeholder that
always passes (`src/core/eval/aggregate.ts`), so the anti-gaming invariant set
has nowhere to come from. Before the evaluator, contributor wiring, or `ratchet
init` default can be built, the gate needs a typed, fail-closed loader for a
checked-in `.ratchet/evals/invariants.yaml` manifest — and it must fail closed,
because a malformed manifest that silently becomes an empty set is a vacuous pass
(exactly the gaming hole the invariant set exists to close).

## What Changes

This is the loader/schema vertical slice of the invariant set. It implements the
behavior in `features/eval-invariants/manifest-loader.feature`:

- Add a typed loader `loadInvariantManifest(projectRoot)` in a new
  `src/core/eval/invariants.ts` that parses `.ratchet/evals/invariants.yaml` into
  three invariant kinds — `deterministic` (absolute predicate), `monotonic`
  (non-decreasing measure vs the baseline run's recorded measure), `snapshot`
  (vs a checked-in golden) — each carrying a required `active` flag.
- Loader contract: an **absent** manifest returns an empty set (no error); a
  **present-but-malformed** (invalid YAML) or **invalid** (bad/unknown kind,
  missing required field, missing `active`, duplicate id) manifest surfaces a
  typed `InvariantManifestError` — **never a silently empty set** — so any caller
  fails closed.
- Export the `Invariant` discriminated-union types, the load result, the
  `invariantsManifestPath(projectRoot)` resolver, and `InvariantManifestError`.
- No CLI/config change and no consumer wiring in this slice: the loaded set is
  not yet evaluated or threaded into the contributor context (that is the
  downstream `invariant-kinds-evaluator` / `invariants-contributor` changes), and
  no default manifest is written (that is `init-default-manifest`).
- Reference documentation: a new `docs/eval-invariants.md` describing the
  manifest schema and the loader's fail-closed contract, and a `README.md`
  pointer to the new `.ratchet/evals/invariants.yaml` surface.

## Design

**Mirror the existing spec loader, invert its failure mode.** The binding loader
(`src/core/eval/spec.ts`) is the template: `yaml` for parsing, `zod`
`discriminatedUnion('kind', …)` for validation, a `*Path(projectRoot)` resolver
built on `RATCHET_DIR_NAME`. The invariant loader reuses all of that. The one
deliberate divergence is the failure mode: `loadEvalSpecs` collects *warnings*
and continues (an invalid binding leaves a case merely unbound → `unjudged`,
which is safe). An invariant manifest must not degrade that way — an invalid
manifest that resolved to an empty active set would let a gamed run pass. So the
loader **throws** `InvariantManifestError` on any parse/validation failure and
reserves the empty-set result exclusively for the genuinely-absent file.

**Manifest shape — a list of named invariants.** Top-level `invariants:` is a
YAML list (not a map) so declared order is preserved (violations are "surfaced
first") and per-stack placeholder comments read naturally for the downstream
default manifest. Each entry is a discriminated union on `kind` with shared
fields `id` (kebab-case, unique — the loader rejects duplicates), `active`
(required boolean — invariants are never active-by-default), and an optional
`description`:

- `kind: deterministic` → `check: { run: string, pass: string = 'exit-zero' }`,
  reusing the deterministic binding's predicate shape (`exit-zero` /
  `contains:` / `regex:` / substring).
- `kind: monotonic` → `measure: string` — the named metric whose current value
  the evaluator (downstream) compares non-decreasing against the baseline run's
  recorded measure (e.g. `scenario-count` for `spec-not-weakened`).
- `kind: snapshot` → `golden: string` (path to the checked-in golden) and
  `produce: { run: string }` (command emitting the current value to diff).

**Schema stays ecosystem-agnostic (forward constraint).** No invariant kind
bakes a toolchain: the deterministic predicate and the snapshot `produce` are
free-form, user-authored command strings, `monotonic.measure` is a named metric,
and `snapshot.golden` is a path. The schema therefore lets the downstream
`init-default-manifest` ship an agent-neutral default with no ratchet-specific
package manager / test runner / command string (per the `generalizable-defaults`
standard), and this loader injects no command of its own.

**Tool-agnostic core.** The loader is pure core logic identical for every coding
agent; it adds no agent-facing skill/command/template, so it is trivially
tool-agnostic.

**Testing strategy (`testing` standard).** The loader is a pure evaluator over
in-memory inputs, so it is proven at the **unit** layer (`test/core/eval/`),
isolated with the `fs.mkdtemp(os.tmpdir())` fixture pattern and torn down in
`afterEach`, mirroring `test/core/eval/spec.test.ts`. The test file header names
`features/eval-invariants/manifest-loader.feature`. No work is pushed up to
integration/E2E — there is no new CLI surface in this slice. The full suite and
the coverage gate stay green at or above the enforced `COVERAGE_THRESHOLD` (95%
floor), so the loader's branches (absent / valid / malformed / each invalid case)
are all covered.

**Documentation strategy (`documentation` standard).** A new Reference doc
`docs/eval-invariants.md` documents the manifest schema (the three kinds and
their fields, the `active` flag) and the loader's fail-closed contract as a
lookup-oriented Reference entry. Because the invariant set is a core anti-gaming
gate component, the doc opens with an `## Overview` whose first artifact is a
vertical (`flowchart TD`), high-contrast Mermaid diagram (every `classDef` sets
`color:`, nodes prefixed with semantic Unicode symbols) showing manifest →
typed loader → {absent ⇒ empty set | valid ⇒ typed set | broken ⇒ fail-closed
error}. `README.md` gains a pointer to the new `.ratchet/evals/invariants.yaml`
surface. The documentation task is mandatory and blocking.

## Tasks

- [x] 1.1 Add `src/core/eval/invariants.ts`: zod `discriminatedUnion('kind', …)`
      for `deterministic` (`check: { run, pass=exit-zero }`), `monotonic`
      (`measure`), and `snapshot` (`golden`, `produce: { run }`) invariants, each
      with shared `id` (min length 1), required `active: boolean`, and optional
      `description`; export the `Invariant` union types and an
      `InvariantManifest` load-result type.
- [x] 1.2 Implement `invariantsManifestPath(projectRoot)` resolving
      `<projectRoot>/<RATCHET_DIR_NAME>/evals/invariants.yaml`, and an
      `InvariantManifestError` class for surfaced parse/validation failures.
- [x] 1.3 Implement `loadInvariantManifest(projectRoot)`: return an empty set
      when the file is absent; throw `InvariantManifestError` on invalid YAML;
      validate the `invariants:` list with the schema, rejecting duplicate ids,
      and throw `InvariantManifestError` (naming the offending invariant) on any
      validation failure — never return a silently empty set for a
      present-but-broken manifest.
- [x] 2.1 Add `test/core/eval/invariants.test.ts` (unit, tmpdir fixture pattern,
      `afterEach` cleanup, header naming
      `features/eval-invariants/manifest-loader.feature`): load a manifest with
      all three kinds + active flags in declared order; assert each kind exposes
      its kind-specific fields; absent file ⇒ empty set, no throw; malformed YAML
      ⇒ throws `InvariantManifestError`; invalid invariant (unknown kind / missing
      `active` / missing kind-required field / duplicate id) ⇒ throws naming the
      invariant.
- [x] 2.2 Run `pnpm build && pnpm vitest run invariant` and the full suite +
      coverage gate; confirm green at or above the enforced `COVERAGE_THRESHOLD`.
- [x] 3.1 (documentation — mandatory, `documentation` standard) Create
      `docs/eval-invariants.md` Reference doc covering the manifest schema (three
      kinds, fields, `active` flag) and the loader's fail-closed contract, with an
      `## Overview` section whose first artifact is a vertical, high-contrast
      Mermaid diagram (every `classDef` sets `color:`, semantic Unicode node
      labels) of manifest → loader → {empty | typed set | fail-closed error}.
- [x] 3.2 (documentation — mandatory) Update `README.md` to point to the new
      `.ratchet/evals/invariants.yaml` manifest surface and the
      `docs/eval-invariants.md` Reference doc.
