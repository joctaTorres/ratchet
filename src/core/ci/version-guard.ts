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
 * the workflow's world to that proven module. In this slice the published-set
 * source is the env var; `real-npm-publish` swaps it for a real
 * `npm view ratchet-ai versions` query with no change to the decision.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decidePublishVersion,
  type VersionDecision,
} from './version-decision.js';

/**
 * Env var carrying the local version to consider. Absent in normal CI (the
 * runner falls back to `package.json`); set by tests to drive the runner
 * deterministically without rewriting the manifest.
 */
export const VERSION_ENV = 'PACKAGE_VERSION';

/**
 * Env var carrying the already-published versions as a comma-separated list.
 * This slice FORCES the published set this way — the same forcing posture the
 * `GATE_*` signals use — so the idempotency proof stays deterministic and
 * offline. `real-npm-publish` replaces this source with a real registry query.
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
 * Read the local version and the already-published set from `env`, consult the
 * version-decision module, and turn its verdict into printable lines plus the
 * (always-zero) exit code. Pure given its `env` argument apart from the
 * `package.json` read, so it can be exercised directly in tests without spawning
 * a process or standing up an Actions runner.
 */
export function runVersionGuard(env: NodeJS.ProcessEnv): VersionGuardResult {
  const version = resolveLocalVersion(env);
  const publishedVersions = parsePublishedVersions(env);

  const decision = decidePublishVersion({ version, publishedVersions });

  const lines: string[] = [];
  if (decision.shouldPublish) {
    lines.push(`${decision.outcome}: version "${version}" is new — the publish step will run.`);
  } else {
    lines.push(`${decision.outcome}: nothing to publish — this is a green, idempotent no-op.`);
    for (const reason of decision.reasons) {
      lines.push(`  - ${reason}`);
    }
  }

  return {
    decision,
    // Always 0: a SKIP is success, not failure. The publish branch is carried
    // by `should_publish`, never by the exit code.
    exitCode: 0,
    lines,
    should_publish: decision.shouldPublish,
  };
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
