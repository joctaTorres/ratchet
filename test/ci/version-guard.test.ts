// Covers: core-remainder-tests/version-guard.feature
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  runVersionGuard,
  writeShouldPublishOutput,
  fetchPublishedVersionsFromRegistry,
  type PublishedVersionsResult,
} from '../../src/core/ci/version-guard.js';
import { PUBLISH, SKIP } from '../../src/core/ci/version-decision.js';

// Mock the registry shell-out so the default fetcher is unit-testable offline.
// The runVersionGuard tests below inject their own fetcher and never reach this,
// so the mock is inert for them.
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
const execFileSyncMock = execFileSync as unknown as ReturnType<typeof vi.fn>;

/**
 * The version-guard runner is the thin bridge between the workflow's environment
 * and the pure version-decision module. These tests feed it an environment and
 * assert its decision, the (always-zero) exit code, and the `should_publish`
 * step output — no Actions runner or child process needed. The PUBLISH/SKIP rule
 * itself is proven in version-decision.test.ts; here we prove the runner reads
 * its inputs, reports the verdict, and — crucially — exits 0 on BOTH outcomes so
 * an already-published version is a green, idempotent no-op.
 */

/**
 * Build the runner environment: the local version (via the `PACKAGE_VERSION`
 * override so tests never touch the manifest) and the comma-separated
 * already-published set.
 */
function env(vars: { version?: string; published?: string }): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {};
  if (vars.version !== undefined) e.PACKAGE_VERSION = vars.version;
  if (vars.published !== undefined) e.PUBLISHED_VERSIONS = vars.published;
  return e;
}

describe('runVersionGuard', () => {
  it('PUBLISHes and exits zero for a version absent from the published set', () => {
    const result = runVersionGuard(env({ version: '1.2.0', published: '1.0.0,1.1.0' }));

    expect(result.decision.shouldPublish).toBe(true);
    expect(result.decision.outcome).toBe(PUBLISH);
    expect(result.should_publish).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.lines.join('\n')).toContain(PUBLISH);
  });

  it('SKIPs and STILL exits zero for an already-published version (idempotent no-op)', () => {
    const result = runVersionGuard(env({ version: '1.1.0', published: '1.0.0,1.1.0,1.2.0' }));

    expect(result.decision.shouldPublish).toBe(false);
    expect(result.decision.outcome).toBe(SKIP);
    expect(result.should_publish).toBe(false);
    // The crux of idempotency: a SKIP is success, not failure.
    expect(result.exitCode).toBe(0);
    expect(result.lines.join('\n')).toContain(SKIP);
  });

  it('PUBLISHes against an empty PUBLISHED_VERSIONS override (nothing shipped yet)', () => {
    const result = runVersionGuard(env({ version: '0.1.0', published: '' }));

    expect(result.should_publish).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('falls back to the repo package.json version when PACKAGE_VERSION is unset', () => {
    // No PACKAGE_VERSION override forces resolveLocalVersion to read the real
    // package.json; the PUBLISHED_VERSIONS override keeps the registry untouched.
    // The repo's own version is already published, so this is a SKIP — but the
    // point is the local version was resolved from package.json without error.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      readFileSync(path.resolve(here, '../../package.json'), 'utf8')
    ) as { version: string };

    const result = runVersionGuard({ PUBLISHED_VERSIONS: pkg.version });

    expect(result.should_publish).toBe(false);
    expect(result.decision.outcome).toBe(SKIP);
    expect(result.exitCode).toBe(0);
  });
});

/**
 * The already-published set now comes from a real `npm view ratchet-ai versions`
 * query, behind an injectable seam so no test hits the network. These tests feed
 * `runVersionGuard` a fake fetcher and prove the four contracts the slice
 * promises: the `PUBLISHED_VERSIONS` override still WINS (and the registry is not
 * even queried); a successful query populates the set; an E404 ("package not
 * found") resolves to an empty set so the FIRST version PUBLISHes; and any other
 * query failure fails SAFE toward a SKIP that STILL exits 0 — a flaky registry
 * never republishes and never reddens the pipeline.
 */
describe('runVersionGuard registry source (injectable seam)', () => {
  /** A fetcher that always resolves cleanly to the given version set. */
  function ok(versions: string[]): () => PublishedVersionsResult {
    return () => ({ status: 'ok', versions });
  }

  it('honors the PUBLISHED_VERSIONS override and does NOT query the registry', () => {
    const fetcher = vi.fn(ok(['9.9.9'])); // would say "not published" if consulted
    const result = runVersionGuard(env({ version: '1.1.0', published: '1.0.0,1.1.0' }), fetcher);

    // Override wins: 1.1.0 is in the forced set -> SKIP, registry untouched.
    expect(result.should_publish).toBe(false);
    expect(result.decision.outcome).toBe(SKIP);
    expect(result.exitCode).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('SKIPs when a successful query reports the version already published', () => {
    const fetcher = vi.fn(ok(['1.0.0', '1.1.0', '1.2.0']));
    const result = runVersionGuard(env({ version: '1.1.0' }), fetcher);

    expect(result.should_publish).toBe(false);
    expect(result.decision.outcome).toBe(SKIP);
    expect(result.exitCode).toBe(0);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('PUBLISHes when a successful query does not contain the local version', () => {
    const result = runVersionGuard(env({ version: '2.0.0' }), ok(['1.0.0', '1.1.0']));

    expect(result.should_publish).toBe(true);
    expect(result.decision.outcome).toBe(PUBLISH);
    expect(result.exitCode).toBe(0);
  });

  it('PUBLISHes the FIRST version when the query resolves E404 to an empty set', () => {
    // The default registry fetcher maps a not-found package to an empty set.
    const result = runVersionGuard(env({ version: '0.1.0' }), ok([]));

    expect(result.should_publish).toBe(true);
    expect(result.decision.outcome).toBe(PUBLISH);
    expect(result.exitCode).toBe(0);
  });

  it('fails SAFE toward SKIP (but STILL exits 0) on an ambiguous query failure', () => {
    const fetcher = (): PublishedVersionsResult => ({ status: 'error', message: 'ETIMEDOUT' });
    const result = runVersionGuard(env({ version: '3.0.0' }), fetcher);

    // Ambiguous failure: do NOT publish, but keep the pipeline green.
    expect(result.should_publish).toBe(false);
    expect(result.decision.outcome).toBe(SKIP);
    expect(result.exitCode).toBe(0);
    expect(result.lines.join('\n')).toContain('failing safe');
  });
});

/**
 * The runner's direct-run path lifts the verdict into a GitHub Actions step
 * output by appending `should_publish=true|false` to the file named by
 * `GITHUB_OUTPUT`. Only this impure writer touches the file, so it is exercised
 * directly against a scratch file. This is the signal the publish step is
 * conditioned on (`steps.<guard>.outputs.should_publish == 'true'`).
 */
describe('should_publish step output (GITHUB_OUTPUT)', () => {
  let dir: string;
  let outFile: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'version-guard-output-'));
    outFile = path.join(dir, 'github_output');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes should_publish=true for a new version', () => {
    const result = runVersionGuard(env({ version: '1.2.0', published: '1.0.0,1.1.0' }));
    writeShouldPublishOutput({ GITHUB_OUTPUT: outFile }, result.should_publish);

    expect(readFileSync(outFile, 'utf8')).toContain('should_publish=true');
  });

  it('writes should_publish=false for an already-published version', () => {
    const result = runVersionGuard(env({ version: '1.1.0', published: '1.0.0,1.1.0' }));
    writeShouldPublishOutput({ GITHUB_OUTPUT: outFile }, result.should_publish);

    expect(readFileSync(outFile, 'utf8')).toContain('should_publish=false');
  });

  it('is a no-op when GITHUB_OUTPUT is unset (keeps the local/pure path clean)', () => {
    expect(() => writeShouldPublishOutput({}, true)).not.toThrow();
  });
});

/**
 * The DEFAULT published-set source shells out to `npm view <pkg> versions --json`
 * via `execFileSync`. These tests mock `node:child_process` so the fetcher is
 * exercised offline: an E404 ("package not found") failure resolves to the empty
 * set (so the first release publishes), a bare-string JSON return is normalized
 * to a one-element list, a JSON array is mapped via String, and any other failure
 * is reported as an ambiguous error so the runner can fail SAFE.
 */
describe('fetchPublishedVersionsFromRegistry (default registry source, mocked)', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('resolves an E404 (package-not-found) failure to an empty set', () => {
    execFileSyncMock.mockImplementationOnce(() => {
      throw Object.assign(new Error('npm ERR! 404'), { stderr: 'E404 Not Found' });
    });

    const result = fetchPublishedVersionsFromRegistry('ratchet-ai');

    expect(result).toEqual({ status: 'ok', versions: [] });
  });

  it('normalizes a bare-string JSON return to a single-version list', () => {
    execFileSyncMock.mockReturnValueOnce(JSON.stringify('1.0.0'));

    const result = fetchPublishedVersionsFromRegistry('ratchet-ai');

    expect(result).toEqual({ status: 'ok', versions: ['1.0.0'] });
  });

  it('maps a JSON array return via String', () => {
    execFileSyncMock.mockReturnValueOnce(JSON.stringify(['1.0.0', '1.1.0', '2.0.0']));

    const result = fetchPublishedVersionsFromRegistry('ratchet-ai');

    expect(result).toEqual({ status: 'ok', versions: ['1.0.0', '1.1.0', '2.0.0'] });
  });

  it('treats a non-array, non-string JSON return as an empty set', () => {
    // `npm view` normally returns an array (or a bare string); any other JSON
    // shape (e.g. an object) is defensively normalized to an empty set.
    execFileSyncMock.mockReturnValueOnce(JSON.stringify({ unexpected: true }));

    const result = fetchPublishedVersionsFromRegistry('ratchet-ai');

    expect(result).toEqual({ status: 'ok', versions: [] });
  });

  it('reports a genuine non-404 failure as an ambiguous error', () => {
    execFileSyncMock.mockImplementationOnce(() => {
      throw Object.assign(new Error('ETIMEDOUT'), { stderr: 'network timeout' });
    });

    const result = fetchPublishedVersionsFromRegistry('ratchet-ai');

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toContain('ETIMEDOUT');
    }
  });
});
