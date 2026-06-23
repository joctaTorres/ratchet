/**
 * Version-guard runner — the workflow's bridge to the version-decision module.
 *
 * The version-decision module is pure: inputs in, decision out. Something has to
 * gather the inputs the workflow actually has — the local package version and
 * the set of versions already on the registry — and surface the verdict as a
 * step output the publish step can gate on. This runner is that thin, impure
 * bridge and NOTHING more: it reads the local version (from `package.json`,
 * overridable via env for tests) and the already-published set (FORCED via the
 * `PUBLISHED_VERSIONS` env var in this slice), calls `decidePublishVersion`,
 * prints the outcome, writes `should_publish=true|false` to the file named by
 * `GITHUB_OUTPUT`, and ALWAYS exits 0.
 *
 * SKIP is success, not failure. Unlike `release-gate.ts` (where DENY is a
 * non-zero exit), an already-published version is a deliberate, healthy no-op:
 * re-running it must keep the pipeline GREEN. So the runner exits 0 for BOTH
 * outcomes; whether anything actually ships is carried entirely by the
 * `should_publish` step output that gates the publish step — never by an exit
 * code. It is still fail-CLOSED toward publishing: only the literal `true`
 * publishes; a missing/unknown signal does not publish (and does not error).
 *
 * It adds NO new decision logic. The PUBLISH/SKIP rule lives — and is
 * exhaustively unit-tested — in `version-decision.ts`; the runner just adapts
 * the workflow's world to that proven module. The already-published set comes
 * from a real `npm view ratchet-ai versions --json` query against the registry,
 * behind an injectable seam so it stays unit-testable offline; the
 * `PUBLISHED_VERSIONS` env override is PRESERVED and takes precedence when set
 * (so tests and the staged-registry proof remain deterministic). A
 * "package not found" (E404) resolves to an empty set so the FIRST release
 * publishes; any OTHER registry failure fails SAFE toward SKIP (no publish)
 * while STILL exiting 0, so an ambiguous registry error never republishes and
 * never errors the pipeline.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decidePublishVersion,
  SKIP,
  type VersionDecision,
} from './version-decision.js';

/**
 * The npm package name whose published versions gate the idempotent publish.
 * The package was renamed to `ratchet-ai` (keeping the `ratchet` bin), so this
 * is what the registry query targets.
 */
export const PACKAGE_NAME = 'ratchet-ai';

/**
 * Env var carrying the local version to consider. Absent in normal CI (the
 * runner falls back to `package.json`); set by tests to drive the runner
 * deterministically without rewriting the manifest.
 */
export const VERSION_ENV = 'PACKAGE_VERSION';

/**
 * Env var carrying the already-published versions as a comma-separated list.
 * When PRESENT (even empty) it OVERRIDES the real registry query, forcing the
 * published set deterministically — the same forcing posture the `GATE_*`
 * signals use — so unit tests and the staged-registry proof stay deterministic
 * and offline. When ABSENT, the runner queries the real registry instead.
 */
export const PUBLISHED_VERSIONS_ENV = 'PUBLISHED_VERSIONS';

/** GitHub Actions step-output mechanism: the file a step appends `key=value` to. */
export const GITHUB_OUTPUT_ENV = 'GITHUB_OUTPUT';

/** Outcome of running the guard: the underlying decision plus an exit code. */
export interface VersionGuardResult {
  decision: VersionDecision;
  /**
   * ALWAYS `0`. Both PUBLISH and SKIP are healthy outcomes — a SKIP must never
   * error the pipeline. Present for symmetry with `ReleaseGateResult` and so the
   * direct-run path has a single value to exit with.
   */
  exitCode: number;
  /** Lines to print, describing the outcome and any skip reasons. */
  lines: string[];
  /**
   * The verdict surfaced as a machine-readable signal, mirroring
   * `decision.shouldPublish`. The direct-run path writes this as a
   * `should_publish=true|false` line to `GITHUB_OUTPUT`; the publish step is
   * conditioned on it being the literal `true`.
   */
  should_publish: boolean;
}

/**
 * Resolve the local package version. Prefers the `PACKAGE_VERSION` env override
 * (used by tests); otherwise reads `version` from the repository's
 * `package.json` — the single source of truth the real publish uses too.
 */
export function resolveLocalVersion(env: NodeJS.ProcessEnv): string {
  const override = env[VERSION_ENV];
  if (override !== undefined && override !== '') return override;

  // dist/core/ci/version-guard.js -> repo root is four levels up.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.resolve(here, '..', '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
  return pkg.version ?? '';
}

/**
 * Parse the comma-separated `PUBLISHED_VERSIONS` env value into a trimmed,
 * non-empty list. An absent or empty var yields `[]` — meaning nothing has
 * shipped, so any version PUBLISHes.
 */
export function parsePublishedVersions(env: NodeJS.ProcessEnv): string[] {
  return (env[PUBLISHED_VERSIONS_ENV] ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * Outcome of querying the registry for a package's published versions. A clean
 * resolution (`status: 'ok'`) carries the version set — EMPTY for a package that
 * does not exist yet (E404), so the first release publishes. An ambiguous
 * failure (`status: 'error'`) carries a message; the runner fails SAFE toward
 * SKIP on it (never republishing) while still exiting 0.
 */
export type PublishedVersionsResult =
  | { status: 'ok'; versions: string[] }
  | { status: 'error'; message: string };

/**
 * The injectable seam for sourcing the already-published set: takes a package
 * name, returns the registry's verdict. The default queries the real registry
 * (`fetchPublishedVersionsFromRegistry`); tests inject a fake so no test hits
 * the network.
 */
export type PublishedVersionsFetcher = (packageName: string) => PublishedVersionsResult;

/**
 * True when an `npm view` failure means "package not found" (E404) rather than a
 * genuine registry error. A brand-new package has no entry, so npm exits
 * non-zero with `E404` / `404` on stdout or stderr; that is NOT an error here —
 * it means nothing has shipped, so the first version PUBLISHes.
 */
function isPackageNotFound(err: unknown): boolean {
  const e = err as { stdout?: unknown; stderr?: unknown; message?: unknown };
  const haystack = [e?.stdout, e?.stderr, e?.message]
    .map((v) => (v == null ? '' : String(v)))
    .join('\n');
  return /\bE?404\b/.test(haystack) || /code\s+E404/i.test(haystack);
}

/**
 * Default published-set source: query the real registry with
 * `npm view <pkg> versions --json`. Inherits the process environment so
 * `npm_config_registry` (or a configured `.npmrc`) is honored — that is how the
 * staged-registry proof points the query at verdaccio. `npm view` returns a JSON
 * array of versions (or a bare string for a single version); both are
 * normalized. E404 resolves to an empty set (first publish); any other failure
 * is reported as an ambiguous error so the runner can fail SAFE.
 */
export function fetchPublishedVersionsFromRegistry(packageName: string): PublishedVersionsResult {
  try {
    const out = execFileSync('npm', ['view', packageName, 'versions', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const trimmed = out.trim();
    if (trimmed === '') return { status: 'ok', versions: [] };
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return { status: 'ok', versions: parsed.map(String) };
    // A single published version comes back as a bare string, not an array.
    if (typeof parsed === 'string') return { status: 'ok', versions: [parsed] };
    return { status: 'ok', versions: [] };
  } catch (err) {
    // A missing package (E404) is not an error — it means the first release.
    if (isPackageNotFound(err)) return { status: 'ok', versions: [] };
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'error', message };
  }
}

/** Turn a version decision into the human-readable lines the runner prints. */
function decisionLines(decision: VersionDecision, version: string): string[] {
  const lines: string[] = [];
  if (decision.shouldPublish) {
    lines.push(`${decision.outcome}: version "${version}" is new — the publish step will run.`);
  } else {
    lines.push(`${decision.outcome}: nothing to publish — this is a green, idempotent no-op.`);
    for (const reason of decision.reasons) {
      lines.push(`  - ${reason}`);
    }
  }
  return lines;
}

/** Wrap a decision in the always-zero-exit result shape the runner returns. */
function guardResult(decision: VersionDecision, version: string): VersionGuardResult {
  return {
    decision,
    // Always 0: a SKIP is success, not failure. The publish branch is carried
    // by `should_publish`, never by the exit code.
    exitCode: 0,
    lines: decisionLines(decision, version),
    should_publish: decision.shouldPublish,
  };
}

/**
 * Read the local version and resolve the already-published set, consult the
 * version-decision module, and turn its verdict into printable lines plus the
 * (always-zero) exit code.
 *
 * The published set comes from the `PUBLISHED_VERSIONS` env override when it is
 * PRESENT (even empty) — the deterministic, offline source tests and the staged
 * proof rely on — otherwise from `fetchPublished` (the real registry query by
 * default, injectable in tests). A clean query feeds the pure decision as
 * before; an ambiguous query failure fails SAFE toward a SKIP (no publish)
 * while still exiting 0, so a flaky registry never republishes and never reddens
 * the pipeline. The PUBLISH/SKIP classification itself stays entirely in the
 * pure module.
 */
export function runVersionGuard(
  env: NodeJS.ProcessEnv,
  fetchPublished: PublishedVersionsFetcher = fetchPublishedVersionsFromRegistry,
): VersionGuardResult {
  const version = resolveLocalVersion(env);

  // Override present (even empty) wins: a deterministic, offline published set.
  if (env[PUBLISHED_VERSIONS_ENV] !== undefined) {
    const publishedVersions = parsePublishedVersions(env);
    return guardResult(decidePublishVersion({ version, publishedVersions }), version);
  }

  // Otherwise source the published set from the real registry.
  const fetched = fetchPublished(PACKAGE_NAME);
  if (fetched.status === 'error') {
    // Ambiguous failure: the version MIGHT already be published, so fail SAFE
    // toward SKIP (do not publish) — but STILL exit 0, preserving idempotency
    // and never reddening the pipeline on a flaky registry.
    const decision: VersionDecision = {
      shouldPublish: false,
      outcome: SKIP,
      reasons: [
        `registry query failed (${fetched.message}) — failing safe toward SKIP; no publish, pipeline stays green`,
      ],
    };
    return guardResult(decision, version);
  }

  return guardResult(decidePublishVersion({ version, publishedVersions: fetched.versions }), version);
}

/**
 * Append the `should_publish` verdict to the file named by `GITHUB_OUTPUT`
 * (GitHub Actions' step-output mechanism), exposing it as a step output the
 * publish step gates on. A no-op when `GITHUB_OUTPUT` is unset (e.g. local
 * runs), so the pure decision path stays mechanism-free — only this impure
 * helper, called solely from the direct-run path, touches the file. Exported so
 * tests can drive it against a scratch `GITHUB_OUTPUT` without spawning a
 * process or standing up an Actions runner.
 */
export function writeShouldPublishOutput(env: NodeJS.ProcessEnv, shouldPublish: boolean): void {
  const outputFile = env[GITHUB_OUTPUT_ENV];
  if (!outputFile) return;
  appendFileSync(outputFile, `should_publish=${shouldPublish}\n`);
}

/** True when this module is the process entrypoint (`node version-guard.js`). */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === path.resolve(entry);
}

// When invoked directly by the workflow's version-guard step, decide and exit.
// Importing the module (e.g. from tests) does not trigger this.
if (isDirectRun()) {
  const result = runVersionGuard(process.env);
  for (const line of result.lines) {
    console.log(line);
  }
  // Surface the verdict as a step output the publish step gates on, then exit 0
  // unconditionally — a SKIP is a healthy no-op, never a pipeline error.
  writeShouldPublishOutput(process.env, result.should_publish);
  process.exit(result.exitCode);
}
