/**
 * Dist-tag resolver — picks the npm dist-tag a version should publish under.
 *
 * A prerelease must NEVER land on the `latest` tag: `npm install <pkg>` (no tag)
 * resolves `latest`, so publishing `0.1.0-beta.0` to `latest` would hand every
 * plain install a beta. The npm convention is to publish a prerelease under a
 * channel named by its leading prerelease identifier (`0.1.0-beta.0` -> `beta`,
 * `1.2.3-rc.2` -> `rc`), leaving `latest` for stable releases only.
 *
 * The `resolveDistTag` decision is pure: a semver string in, a dist-tag string
 * out. No I/O, no clock, no registry — that keeps the rule exhaustively
 * unit-testable. A thin direct-run footer (only when this module is the process
 * entrypoint) reads the local `package.json` version and prints the resolved tag
 * on stdout, so the workflow can `node dist/core/ci/dist-tag.js` and capture it
 * into `GITHUB_OUTPUT`. Importing the module (e.g. from tests) does not trigger
 * that path.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The default dist-tag for a stable (no-prerelease) version. */
export const LATEST = 'latest';

/**
 * Extract the prerelease segment of a semver string: everything after the first
 * `-` and before any build-metadata `+`. Returns an empty string when the
 * version has no prerelease component.
 *
 * Build metadata (`+...`) is stripped first because it can legally precede or
 * coexist with a prerelease only after it, and it never names a channel.
 */
function prereleaseSegment(version: string): string {
  const trimmed = version.trim();
  // Drop build metadata first — it is never part of the prerelease channel.
  const withoutBuild = trimmed.split('+', 1)[0];
  const dashIndex = withoutBuild.indexOf('-');
  if (dashIndex === -1) return '';
  return withoutBuild.slice(dashIndex + 1);
}

/**
 * Resolve the npm dist-tag for `version`.
 *
 * - A version with a prerelease component publishes under its LEADING prerelease
 *   identifier: `0.1.0-beta.0` -> `beta`, `1.2.3-rc.2` -> `rc`,
 *   `2.0.0-alpha` -> `alpha`. The leading identifier is the segment before the
 *   first `.` of the prerelease, so the numeric counter (`.0`, `.2`) is dropped.
 * - A stable version (no prerelease) publishes under `latest`.
 *
 * Pure: no I/O. Falls back to `latest` for any version whose prerelease segment
 * is absent or empty (e.g. a trailing `-`), so a malformed input never yields an
 * empty tag.
 */
export function resolveDistTag(version: string): string {
  const prerelease = prereleaseSegment(version);
  if (prerelease === '') return LATEST;

  // The leading identifier names the channel; the trailing counter is dropped.
  const leading = prerelease.split('.', 1)[0].trim();
  return leading === '' ? LATEST : leading;
}

/**
 * Read the `version` field from the repository's `package.json` — the single
 * source of truth the real publish reads too. Lives behind the direct-run guard
 * so the pure `resolveDistTag` stays I/O-free.
 */
function readLocalVersion(): string {
  // dist/core/ci/dist-tag.js -> repo root is four levels up.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.resolve(here, '..', '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
  return pkg.version ?? '';
}

/** True when this module is the process entrypoint (`node dist-tag.js`). */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === path.resolve(entry);
}

// When invoked directly by the workflow, print the dist-tag for the local
// version so the step can capture it into GITHUB_OUTPUT. Importing the module
// (e.g. from tests) does not trigger this.
if (isDirectRun()) {
  process.stdout.write(`${resolveDistTag(readLocalVersion())}\n`);
}
