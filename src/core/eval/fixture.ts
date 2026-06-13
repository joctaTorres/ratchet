/**
 * Fixture lifecycle for eval judging.
 *
 * A fixture is a checked-in, pre-determined codebase under
 * `.ratchet/evals/fixtures/<name>/`. Before a case is judged, the fixture is
 * materialized into a throwaway temp working copy that becomes the judging cwd,
 * so a check or agent may freely build/run/mutate without dirtying the
 * checked-in fixture or the host repository.
 *
 * When a fixture needs bootstrapping (`pnpm install`, a build), its binding
 * declares an optional one-time `setup` command. The setup runs ONCE into a
 * working copy cached by fixture+setup; every case bound to that fixture reuses
 * the cached copy instead of re-bootstrapping. This keeps serial runs from being
 * dominated by repeated install cost.
 */

import { cpSync, existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fixturePath } from './spec.js';
import type { BashRunner } from '../batch/engine/index.js';
import { realBashRunner } from '../batch/engine/index.js';

export interface MaterializeResult {
  /** Absolute path to the working copy used as the judging cwd. */
  cwd: string;
  /** True when the working copy came from the setup cache (reused). */
  fromCache: boolean;
}

export interface FixtureManagerDeps {
  bash?: BashRunner;
  /** Base directory for temp working copies (overridable for tests). */
  tmpRoot?: string;
}

/** Stable key for a fixture+setup pair so the cache is reused across cases. */
function cacheKey(fixture: string, setup: string | undefined): string {
  return createHash('sha1').update(JSON.stringify([fixture, setup ?? ""])).digest('hex').slice(0, 16);
}

/**
 * Manages fixture working copies for a single eval run. The cache lives for the
 * lifetime of the manager (one run), so setup runs at most once per
 * fixture+setup within that run.
 */
export class FixtureManager {
  private readonly bash: BashRunner;
  private readonly base: string;
  /** fixture+setup key -> prepared (post-setup) cached working copy. */
  private readonly setupCache = new Map<string, string>();

  constructor(
    private readonly projectRoot: string,
    deps: FixtureManagerDeps = {}
  ) {
    this.bash = deps.bash ?? realBashRunner;
    this.base = deps.tmpRoot ?? mkdtempSync(path.join(tmpdir(), 'ratchet-eval-'));
    mkdirSync(this.base, { recursive: true });
  }

  private copyDir(from: string, to: string): void {
    cpSync(from, to, { recursive: true });
  }

  private freshCopyPath(fixture: string): string {
    return mkdtempSync(path.join(this.base, `${fixture}-`));
  }

  /** Run the one-time setup into a cached copy and return its path. */
  private async prepareCached(fixture: string, src: string, setup: string): Promise<string> {
    const key = cacheKey(fixture, setup);
    const existing = this.setupCache.get(key);
    if (existing) return existing;

    const cacheCopy = path.join(this.base, `cache-${key}`);
    if (!existsSync(cacheCopy)) {
      this.copyDir(src, cacheCopy);
      const result = await this.bash(setup, cacheCopy);
      if (result.exitCode !== 0) {
        throw new Error(
          `Fixture setup failed for '${fixture}' (exit ${result.exitCode}): ${result.stderr || result.stdout}`
        );
      }
    }
    this.setupCache.set(key, cacheCopy);
    return cacheCopy;
  }

  /**
   * Materialize the fixture into a throwaway working copy to judge in. When a
   * `setup` is declared, the bootstrapped cache copy is the source so each case
   * still gets an isolated working copy without re-running setup.
   */
  async materialize(fixture: string, setup?: string): Promise<MaterializeResult> {
    const src = fixturePath(this.projectRoot, fixture);
    if (!existsSync(src)) {
      throw new Error(`Fixture '${fixture}' not found under .ratchet/evals/fixtures.`);
    }
    if (setup) {
      const cached = await this.prepareCached(fixture, src, setup);
      const copy = this.freshCopyPath(fixture);
      this.copyDir(cached, copy);
      return { cwd: copy, fromCache: true };
    }
    const copy = this.freshCopyPath(fixture);
    this.copyDir(src, copy);
    return { cwd: copy, fromCache: false };
  }

  /** Number of times setup has been bootstrapped (for assertions/tests). */
  setupRunCount(): number {
    return this.setupCache.size;
  }
}
