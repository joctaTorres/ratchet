# Nested planning homes

## Why

Ratchet currently assumes exactly one `.ratchet` directory per repository, resolved by walking up from cwd to the first match. In monorepos and large repos this forces every team's changes, features, and standards into a single shared store. This change lets complex repos split planning into nested `.ratchet` directories per sub-module, with the root `.ratchet` remaining a full planning home that also discovers, addresses, and aggregates its children.

## What Changes

- Nearest-wins resolution: commands run inside a sub-module resolve that module's `.ratchet`, not the root's (`features/nested-planning-homes/resolution.feature`).
- `archive`, `list`, and `view` are routed through the central planning-home resolver instead of hardcoding `./.ratchet` (`resolution.feature`, scenario "list, view, and archive obey walk-up resolution").
- Filesystem discovery of nested `.ratchet` directories from the root, with an optional `modules:` registry in root `config.yaml` acting as a lint/allowlist — mismatches in either direction warn but never hide modules (`discovery.feature`).
- Module identity: name defaults to the path relative to the root; a module's `config.yaml` may declare a `name:` override (`discovery.feature`).
- New `--module <name>` option on change-scoped commands (`new change`, `status`, `instructions`, `view`, `archive`) to target a module's planning home from anywhere in the repo (`module-addressing.feature`).
- Root `ratchet list` aggregates root changes plus all module changes, labeled by module; a broken module degrades to a warning, not a failure (`root-aggregation.feature`).
- Standards layering: module changes see root standards plus module standards, module wins on tag collision; tag validation runs against the layered set (`standards-layering.feature`).
- Module-local feature stores: archiving a module change materializes features into the module's own `.ratchet/features/`; standard reverse-links are regenerated in the home that defines the standard, with module-qualified feature entries (`module-feature-store.feature`).
- No breaking changes: a repo with a single root `.ratchet` behaves exactly as today — no module concept, no new output, no warnings.

## Design

**Resolution model.** The existing walk-up in `src/core/planning-home.ts` already implements nearest-wins; it stays the default resolution path. The new work is layered on top of it rather than replacing it:

- `PlanningHome` gains `parent?: PlanningHome` (lazily resolved by continuing the walk-up past the current root) and `moduleName?: string`. A home whose walk-up finds another `.ratchet` above it is a *module*; the topmost home is the *root*. The unused `PlanningHomeKind = 'workspace'` stub is repurposed/retired in favor of this parent-link model — kind stays `'repo'` to avoid touching `ActionContext` semantics in this change.
- Prerequisite refactor: `src/core/archive.ts`, `src/core/list.ts`, and `src/core/view.ts` currently build `path.join('.', '.ratchet', 'changes')` by hand. They must call `resolveCurrentPlanningHomeSync()` first; otherwise nested mode behaves differently per command. This lands before any nesting logic.

**Discovery (hybrid).** A new `discoverModules(rootHome)` in `src/core/planning-home.ts` globs for `*/.ratchet` directories below the root using fast-glob with bounded depth, skipping `node_modules`, `.git`, and gitignored paths, and not descending past a found module (a module's own nested homes are its business, not the root's — one level of parent/child per resolution). The root `config.yaml` gains an optional `modules: [<path>…]` list parsed in `src/core/project-config.ts`. Discovery is the source of truth; the registry only produces warnings: discovered-but-unregistered (when a registry exists) and registered-but-missing. This avoids the stale-registry failure mode while letting teams pin the expected layout.

**Module identity.** `moduleName` defaults to the POSIX-style relative path from root to module (`packages/api`); a module `config.yaml` `name:` field overrides it. Name collisions across modules are an error at discovery time. `--module` resolves against these names and errors with the known-name list on a miss — no second registry, no guessing.

**Addressing.** `--module` is implemented in one place: a shared option that, when present, resolves the root home from cwd, runs discovery, and substitutes the matched module's home for the rest of the command. Commands keep receiving a `PlanningHome` and stay ignorant of how it was chosen.

**Aggregation.** Root-level `list` composes its existing per-home listing over `[root, ...discoverModules(root)]`, tagging rows with the module name (root rows untagged). Module load failures (unparseable config) are caught per-module and surfaced as warnings so one broken module cannot blind the whole repo. Module-level `list` does not aggregate — scoping down is the point of nesting.

**Standards layering.** `loadStandards(projectRoot)` in `src/core/standards.ts` grows into `loadLayeredStandards(home)`: load the parent chain root-first, then the module, last-writer-wins by `tag`. Root changes therefore see only root standards (no children leak upward). Tag validation for a change's `standards:` list validates against the layered set of the change's home. Shadowing is by whole-document replacement — no merge semantics, which keeps collisions predictable.

**Feature store and archive.** Archive operates entirely on the change's own home: features materialize into `<home>/.ratchet/features/`, the change moves to `<home>/.ratchet/changes/archive/`. The one cross-home write is standard reverse-links: `materializeStandardLinks` resolves each declared tag to the home that *defines* it (module if shadowed, else root) and regenerates that standard's `## Implemented by` block there, qualifying entries from modules as `<module-name>: <capability>/<file>`. Forward sidecars stay module-local next to the features. Trade-off: archiving a module change may touch a root standard file — accepted, because reverse links are already regenerated (never hand-edited), so the write is idempotent and conflict-free.

**Backward compatibility.** Every new behavior is gated on a second `.ratchet` actually existing. Single-home repos hit the existing code paths: no discovery scan from non-root commands, no labels, no warnings.

## Tasks

- [x] 1.1 Route `archive`, `list`, and `view` through `resolveCurrentPlanningHomeSync()` (remove hardcoded `path.join('.', RATCHET_DIR_NAME, …)` in `src/core/archive.ts`, `src/core/list.ts`, `src/core/view.ts`); add regression tests that they resolve from a subdirectory
- [x] 1.2 Extend `PlanningHome` with lazy `parent` resolution (continue walk-up past current root) and `moduleName`; keep single-home repos identical in behavior and output
- [x] 2.1 Implement `discoverModules(rootHome)` with bounded fast-glob scan, ignore rules (`node_modules`, `.git`, gitignore), no descent past a found module, and module-name derivation from relative path
- [x] 2.2 Parse optional `modules:` registry in root `config.yaml` and optional `name:` in module `config.yaml` (`src/core/project-config.ts`); error on duplicate module names
- [x] 2.3 Emit hybrid discover/verify warnings: discovered-but-unregistered and registered-but-missing, both non-fatal
- [x] 3.1 Add shared `--module <name>` option that resolves the named module's home and threads it through `new change`, `status`, `instructions`, `view`, and `archive`; unknown name errors with the discovered-name list
- [x] 3.2 Aggregate root-level `list` across root + discovered modules with module labels; catch per-module load failures as warnings; keep module-level `list` scoped
- [x] 4.1 Implement `loadLayeredStandards(home)` (root-first parent chain, module shadows root by tag) and use it for instructions output and `standards:` tag validation
- [x] 4.2 Make archive fully home-local for features and change relocation (module store, module archive dir)
- [ ] 4.3 Update `materializeStandardLinks` to write reverse `## Implemented by` blocks into the standard's defining home with module-qualified entries; keep forward sidecars module-local
- [ ] 5.1 End-to-end test: monorepo fixture with root + two modules covering every scenario in `features/nested-planning-homes/` (resolution, discovery, addressing, aggregation, standards layering, feature store)
- [ ] 5.2 Backward-compat test: single-home repo produces byte-identical command output to current behavior
