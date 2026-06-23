# `src/core/ci` — the gated npm-release pipeline

This module is the brain of the `ci-npx-release` pipeline: the logic that decides
**whether `ratchet-ai` gets published to npm** on a push to `main`, and **under
what tag / version**. The guarantee it exists to make real is _"publish only when
every quality gate is green, on `main`"_ — and to make that a **unit-tested
property of pure functions**, not YAML wiring that is merely hoped to be correct.

The design splits cleanly into three layers:

1. **Pure decision modules** — inputs in, decision out. No I/O, no git, no clock,
   no registry. Every branch is exhaustively unit-testable.
2. **Gate evaluators** — pure functions that turn one tool's report (coverage
   summary, e2e result, audit report, secret-scan report) into a `green | red`
   `GateSignal`.
3. **Thin runners** — the only impure glue. They read `GATE_*` / config from the
   environment, call a pure function, print the verdict, write `GITHUB_OUTPUT`,
   and translate the verdict into a process exit code. They add **no** decision
   logic.

Everything is **fail-closed**: anything other than an explicit green — a missing
signal, an unreadable report, a non-`main` branch, an empty gate set — denies.

---

## The shared signal shape

The spine type is `GateSignal = 'green' | 'red'` (`release-decision.ts`). Every
gate evaluator returns a `signal` of exactly that shape, so wiring a new gate into
the release decision is a **data** change (add a key to the gates record), never a
logic change.

---

## Pure decision modules

### `release-decision.ts` — the "only when green" spine

`decideRelease({ branch, gates })` returns `{ allowed, outcome: ALLOW | DENY,
reasons }`.

- **ALLOW iff** `branch === 'main'` **AND** every entry in `gates` is the literal
  `'green'`.
- A non-`main` branch, any `red` / missing / unknown gate signal, **or an empty
  `gates` record** all DENY, each with a precise human-readable reason.
- The empty-gates case fails closed deliberately: with no wired gates the
  "every gate green" clause is vacuously true, so an empty set is treated as
  _"nothing proves the build is green"_ and denies. (See also the runner's
  `WIRED_GATES` non-empty guard below — defense in depth.)

The gate set is **data** (the keys of `gates`), not hardcoded branches, which is
what lets later phases add `coverage`, `e2e`, and `security` against the same loop
with no core-logic change.

### `version-decision.ts` — the idempotency spine

`decidePublishVersion({ version, publishedVersions })` returns
`{ shouldPublish, outcome: PUBLISH | SKIP }`.

- **PUBLISH** when the local version is **not** already on the registry.
- **SKIP** (a deliberate, **green** no-op) when it already shipped — re-running an
  already-published version must never error the pipeline. SKIP is carried as
  `shouldPublish: false`, never as a failing outcome.

### `dist-tag.ts` — npm dist-tag resolver

`resolveDistTag(version)` returns the tag a version should publish under:

- a prerelease (`0.1.0-beta.0`) resolves to its leading prerelease identifier
  (`beta`), keeping it **off** the `latest` tag so a plain `npm install ratchet-ai`
  never resolves to a beta;
- a stable version resolves to `latest`.

Pure: a semver string in, a tag string out.

---

## Gate evaluators (signal producers)

Each is a pure evaluator plus a `read*` reader that returns `null` (→ fail-closed
`red`) on a missing/malformed report, and never throws.

| File | Question it answers | Key env |
|---|---|---|
| `coverage-gate.ts` | Is `total.lines.pct` ≥ the threshold? | `COVERAGE_SUMMARY`, `COVERAGE_THRESHOLD` |
| `e2e-gate.ts` | Did every check in the built-CLI smoke pass? | `E2E_RESULT` |
| `dependency-audit-gate.ts` | Any vulnerability at/above the fail-on severity? | `AUDIT_REPORT`, `AUDIT_FAIL_ON` (default `high`) |
| `secret-scan-gate.ts` | Any non-allowlisted leaked secret in the tree? | `SECRET_SCAN_REPORT`, `SECRET_SCAN_ALLOWLIST` |

- **`coverage-gate`** reads the v8 `json-summary` `total.lines.pct`. Threshold
  defaults to `68` (just under the measured line coverage); a non-finite/missing
  total is `red`.
- **`e2e-gate`** reads the machine-readable result `test/e2e/cli-smoke.sh` writes;
  a single failed check (or a missing/malformed result) is `red`.
- **`dependency-audit-gate`** parses per-severity counts from `pnpm audit --json`;
  green only when nothing is at or above `failOn` (severity order
  `info < low < moderate < high < critical`).
- **`secret-scan-gate`** parses a gitleaks-style report. A finding is exempted
  only by its **fingerprint** (`file:rule`) or its bare **`file`** — a bare `rule`
  is **not** matched, since allowlisting a whole rule across the tree is too broad
  for a security gate. A present-but-malformed entry fails the **whole** report
  closed (never "fewer secrets than there are").

---

## Thin runners (impure glue)

Each runner reads its inputs from `env`, calls the pure code, prints the verdict,
and exits `0` (green/permitted) or non-zero (red/denied) — the exit code is what
the CI step acts on. They are exercised directly in tests with fixture
environments, so no Actions runner is needed.

### `release-gate.ts`

- `WIRED_GATES = ['lint', 'test', 'coverage', 'e2e', 'security']`. Each name maps
  to `GATE_<NAME>` (uppercased) in the environment; a missing var is `undefined`
  → not-green.
- `runReleaseGate(env)` first **asserts `WIRED_GATES` is non-empty** (a defensive
  guard so a future refactor that drains it fails loudly rather than silently
  opening the gate), reads `GITHUB_REF_NAME` as the branch and each `GATE_*` as a
  signal, then calls `decideRelease`.
- On the direct-run path it writes `release_allowed=true|false` to the file named
  by `GITHUB_OUTPUT`, lifting the proven verdict into a job-level output the
  downstream `publish` job depends on. Exits `0` on ALLOW, `1` on DENY.

### `version-guard.ts`

- Resolves the local version (`package.json`, overridable via env for tests) and
  the already-published set. The set comes from a real
  `npm view ratchet-ai versions --json` query behind an injectable seam, with a
  `PUBLISHED_VERSIONS` env override that takes precedence (keeps tests/proofs
  offline and deterministic). E404 → empty set (first publish); any other registry
  failure fails **safe toward SKIP**.
- Calls `decidePublishVersion`, writes `should_publish=true|false` to
  `GITHUB_OUTPUT`, and **always exits 0** — SKIP is success. Whether anything ships
  is carried entirely by `should_publish`, never by an exit code. Fail-closed
  toward publishing: only the literal `true` publishes.

`dist-tag.ts` also has a direct-run footer that prints the resolved tag on stdout
for the workflow to capture into `GITHUB_OUTPUT`.

---

## How it wires into `.github/workflows/ci.yml`

The workflow has two jobs.

**`ci` job** (runs on every push + PR): checkout → setup Node/pnpm → install →
`lint` → `test`, then the gate steps each build `dist/` and run their runner:

- `coverage` → `node dist/core/ci/coverage-gate.js`
- `e2e` → `bash test/e2e/cli-smoke.sh` then `node dist/core/ci/e2e-gate.js`
- `audit` → `pnpm audit --json` then `node dist/core/ci/dependency-audit-gate.js`
- `secret-scan` → `gitleaks detect …` then `node dist/core/ci/secret-scan-gate.js`

A red lint/test/coverage/e2e/audit/secret step fails the job (Actions' default
`success()` step condition) and short-circuits everything after it.

The **release-gate step** (main-only via `if: github.ref == 'refs/heads/main'`)
maps each step's `outcome` into a `GATE_*` env var
(`steps.X.outcome == 'success' && 'green' || 'red'`), folds the audit **and**
secret-scan outcomes into a single `GATE_SECURITY`, and runs
`node dist/core/ci/release-gate.js`. That writes `release_allowed` to
`GITHUB_OUTPUT`, which the `ci` job exposes as a **job output**.

**`publish` job** (main-only, real provenance publish): `needs: [ci]` **and**
`if: needs.ci.outputs.release_allowed == 'true'` — two belt-and-braces gates, so
publish is a property of the workflow **graph**, not just in-job ordering. It runs
the version guard (`should_publish`), resolves the dist-tag, then
`npm publish --provenance --access public --tag <resolved>` gated on
`should_publish == 'true'`, authenticated by the `NPM_TOKEN` secret with the job
holding `id-token: write` for provenance.

### Fail-closed, end to end

Every layer denies on the unknown: missing gate signal → not-green; unreadable
report → `red`; empty gate set → DENY; non-`main` → DENY; absent
`release_allowed` output → publish job skipped; ambiguous registry error → SKIP.
There is no path where a silent default opens the gate.
