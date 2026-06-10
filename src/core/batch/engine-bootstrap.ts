/**
 * Optional engine bootstrap.
 *
 * The licensed engine ships as a separate package (`@ratchet/batch-engine`).
 * When installed, importing it self-registers against the `BatchEngine` contract
 * via `registerBatchEngine`. The CLI never imports the engine statically — it
 * attempts a dynamic import here so that:
 *
 *   - with the engine installed, `loadBatchEngine()` resolves it;
 *   - without it, the import fails harmlessly and engine-absent stays a
 *     first-class state (the open commands keep working).
 *
 * This is the single seam the CLI uses to enable the engine. It is intentionally
 * best-effort and never throws.
 */

let bootstrapped = false;

/**
 * The engine package specifier. Held in a variable (not a literal import) so the
 * open CLI does NOT take a static/type dependency on the licensed package: it is
 * a genuine optional runtime dependency, resolved only if installed.
 */
const ENGINE_PACKAGE = '@ratchet/batch-engine';

/**
 * Attempt to load the licensed engine package once. Returns true if an engine
 * package was successfully imported (it self-registers on import); false when
 * absent. Never throws — engine-absent is a normal state.
 */
export async function bootstrapBatchEngine(): Promise<boolean> {
  if (bootstrapped) return true;
  try {
    // Dynamic, optional dependency: not a hard dependency of the open CLI. The
    // specifier is a string variable, so TS does not statically resolve (or
    // require) the licensed package — resolution happens only at runtime, and
    // engine-absent stays a first-class state when it is not installed.
    await import(ENGINE_PACKAGE);
    bootstrapped = true;
    return true;
  } catch {
    return false;
  }
}
