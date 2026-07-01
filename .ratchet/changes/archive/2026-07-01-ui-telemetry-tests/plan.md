# ui-telemetry-tests

## Why

Three files named in this phase's definition of done sit below the 95% line-coverage
floor the `testing` standard requires:

- `src/ui/welcome-screen.ts` has **no test at all** — its static-fallback render,
  the `canAnimate` capability gate, `renderFrame` padding, `getWelcomeText`
  content, and the `waitForEnter` non-TTY path are entirely unmeasured.
- `src/telemetry/index.ts` is only exercised through its **neutralized** surface
  (`test/telemetry/index.test.ts` proves `isTelemetryEnabled` is always false and
  no client is built). The exported `getOrCreateAnonymousId` — generate-and-persist,
  load-from-config, and the module-level cache — is reachable but uncovered.
- `src/prompts/searchable-multi-select.ts` has a test
  (`test/prompts/searchable-multi-select.test.ts`) that covers Space/Enter/Tab and
  the hint text, but leaves the search-filter, backspace, pagination, status-suffix,
  selected-chips, and done-state render branches uncovered.

This change closes those three gaps with unit tests at the correct pyramid layer,
lifting each file's line coverage substantially per the `testing` standard. It is a
thin vertical slice toward the phase goal (95% total coverage): it is **tests-only**,
changes no production behavior, and does **not** touch the coverage-gate floor —
ratcheting the enforced `COVERAGE_THRESHOLD` to 95 is the separate floor change that
this and its sibling test-writing changes feed.

## What Changes

- Add `test/ui/welcome-screen.test.ts` implementing
  `features/ui-telemetry/welcome-screen.feature` (name the `.feature` in the header):
  drive `getWelcomeText` content, `renderFrame` art-column padding + clear-line
  prefix, every `canAnimate` branch (non-TTY, `NO_COLOR`, sub-minimum width, wide
  colour TTY), the `showWelcomeScreen` static-fallback branch writing exactly one
  frame, and the non-TTY `waitForEnter` resolve — all with `process.stdout`,
  `process.stdin`, and `process.env` stubbed and restored per test (no spawn, no
  real terminal). Export internal helpers from `welcome-screen.ts` only if needed to
  test them at the unit level without going through the animation loop.
- Extend `test/telemetry/index.test.ts` implementing
  `features/ui-telemetry/telemetry-anonymous-id.feature`: with `XDG_CONFIG_HOME`
  pointed at a tmpdir under `os.tmpdir()` and `vi.resetModules` resetting the
  module-level cache, cover `getOrCreateAnonymousId` generating + persisting a new
  UUID, loading a pre-existing id from config, returning the cached value on the
  second call, and `shutdown` resolving safely with no client — fixture-isolated and
  removed in `afterEach`.
- Extend `test/prompts/searchable-multi-select.test.ts` implementing
  `features/ui-telemetry/searchable-multi-select-search.feature`: cover typed-search
  filtering, the no-matches notice, backspace (delete search char vs remove last
  selection), cursor clamping at both bounds, the pagination window + page
  indicator, the configured/detected/selected/refresh status suffixes, the
  selected-chips row, and the done-state render (joined names and `(none)`), reusing
  the existing `@inquirer/core` mock harness.
- No production behavior changes; the coverage gate floor is **not** changed here.

## Design

All three suites stay at the **unit** layer the `testing` standard prescribes for
pure logic and thin process I/O — no command wiring, no CLI spawn:

- **welcome-screen** — `canAnimate`, `getWelcomeText`, and `renderFrame` are
  deterministic over `process.stdout`/`process.env`; stub those globals with
  `vi.spyOn`/assignment and restore in `afterEach`. `showWelcomeScreen` is tested
  only on its static-fallback branch (non-TTY) so the `setInterval` animation loop
  is never entered, keeping the test fast and deterministic. The Braille animation
  geometry itself is already covered by `test/ui/ascii-patterns.test.ts`.
- **telemetry** — isolate the config via `XDG_CONFIG_HOME` (honoured by
  `getGlobalConfigDir`) under `os.tmpdir()`; because `anonymousId` is a
  module-scoped cache, use `vi.resetModules()` + a fresh dynamic import to
  distinguish the generate, load-from-config, and cache-hit cases.
- **searchable-multi-select** — reuse the existing hand-rolled `@inquirer/core` mock
  (state store + `rerender`) and assert on `renderOutput` / the captured state for
  the render and reducer branches; add larger/flagged choice sets to reach the
  pagination and status-suffix code.

Tests follow the standard's fixture-isolation, right-layer, and `.feature`-in-header
conventions and must leave no artifacts behind.

## Tasks

- [x] 1.1 Add `test/ui/welcome-screen.test.ts` implementing
  `features/ui-telemetry/welcome-screen.feature` (name the `.feature` in the
  header): `getWelcomeText` content, `renderFrame` padding + clear-line prefix,
  every `canAnimate` branch, the `showWelcomeScreen` static-fallback writing exactly
  one frame, and the non-TTY `waitForEnter` resolve — `process.stdout`/`stdin`/`env`
  stubbed and restored per test.
- [x] 2.1 Extend `test/telemetry/index.test.ts` implementing
  `features/ui-telemetry/telemetry-anonymous-id.feature`: `getOrCreateAnonymousId`
  generate-and-persist, load-from-config, and cache-hit (via `vi.resetModules` +
  `XDG_CONFIG_HOME` tmpdir isolation), and `shutdown` no-op — cleaned up in
  `afterEach`.
- [x] 3.1 Extend `test/prompts/searchable-multi-select.test.ts` implementing
  `features/ui-telemetry/searchable-multi-select-search.feature`: typed-search
  filtering, no-matches notice, backspace (delete char vs remove selection), cursor
  clamping, pagination indicator, status suffixes, selected-chips row, and the
  done-state `(none)` render.
- [x] 4.1 Run `pnpm build && pnpm vitest run --coverage`; confirm the full suite is
  green and that the `text` report rows for `src/ui/welcome-screen.ts`,
  `src/telemetry/index.ts`, and `src/prompts/searchable-multi-select.ts` have each
  risen substantially. Do **not** change the coverage-gate floor in this change.
