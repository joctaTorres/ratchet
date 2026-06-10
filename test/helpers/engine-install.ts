import { spawnSync } from 'child_process';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { cliProjectRoot, ensureCliBuilt } from './run-cli.js';

/**
 * Build a throwaway "install root" that makes `@ratchet/batch-engine` RESOLVABLE
 * to the open CLI WITHOUT declaring it as a dependency of the root `ratchet`
 * package.
 *
 * The licensed engine is loaded by the CLI through a best-effort dynamic
 * `import('@ratchet/batch-engine')` from inside the CLI's own module tree. ESM
 * resolves that bare specifier relative to the importing module's real location,
 * not the working directory — so simply dropping the engine into the project's
 * `node_modules` is not enough. To mirror a real `npm install -g` co-location we
 * assemble a self-contained tree:
 *
 *   <root>/node_modules/ratchet/                 (real copy of the CLI runtime)
 *   <root>/node_modules/ratchet/node_modules ->  (symlink to the repo's deps)
 *   <root>/node_modules/@ratchet/batch-engine/   (real copy of the built engine)
 *
 * Running the CLI via `<root>/node_modules/ratchet/bin/ratchet.js` makes the
 * bootstrap's dynamic import walk up into `<root>/node_modules` and find the
 * engine, whose own `import 'ratchet'` resolves back to the copied CLI. Nothing
 * in the repo checkout is mutated, so the engine-absent default is preserved and
 * concurrent test files are unaffected.
 */

export interface EngineInstall {
  /** Absolute path to the CLI entry that resolves the engine. */
  cliEntry: string;
  /** Tear the install root down. */
  cleanup: () => Promise<void>;
}

const ENGINE_PKG_DIR = path.join(cliProjectRoot, 'packages', 'batch-engine');

/** Build the engine's dist if it is not already present. */
export async function ensureEngineBuilt(): Promise<void> {
  await ensureCliBuilt();
  if (existsSync(path.join(ENGINE_PKG_DIR, 'dist', 'index.js'))) {
    return;
  }
  const result = spawnSync('pnpm', ['-C', 'packages/batch-engine', 'build'], {
    cwd: cliProjectRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error('Failed to build @ratchet/batch-engine for e2e test');
  }
  if (!existsSync(path.join(ENGINE_PKG_DIR, 'dist', 'index.js'))) {
    throw new Error('Engine dist missing after build (packages/batch-engine/dist/index.js)');
  }
}

export async function createEngineInstall(baseDir: string): Promise<EngineInstall> {
  await ensureEngineBuilt();

  const installRoot = path.join(baseDir, 'inst');
  const cliPkgDir = path.join(installRoot, 'node_modules', 'ratchet');
  const enginePkgDir = path.join(installRoot, 'node_modules', '@ratchet', 'batch-engine');

  await fs.mkdir(cliPkgDir, { recursive: true });
  await fs.mkdir(enginePkgDir, { recursive: true });

  // Copy the CLI runtime the engine will register against.
  await fs.cp(path.join(cliProjectRoot, 'dist'), path.join(cliPkgDir, 'dist'), {
    recursive: true,
  });
  await fs.cp(path.join(cliProjectRoot, 'bin'), path.join(cliPkgDir, 'bin'), {
    recursive: true,
  });
  await fs.cp(path.join(cliProjectRoot, 'schemas'), path.join(cliPkgDir, 'schemas'), {
    recursive: true,
  });
  await fs.cp(
    path.join(cliProjectRoot, 'package.json'),
    path.join(cliPkgDir, 'package.json')
  );
  // The CLI's third-party deps already live in the repo; symlink rather than copy.
  await fs.symlink(
    path.join(cliProjectRoot, 'node_modules'),
    path.join(cliPkgDir, 'node_modules'),
    'dir'
  );

  // Copy the built engine (real dir so its own `import 'ratchet'` resolves up).
  await fs.cp(path.join(ENGINE_PKG_DIR, 'dist'), path.join(enginePkgDir, 'dist'), {
    recursive: true,
  });
  await fs.cp(
    path.join(ENGINE_PKG_DIR, 'package.json'),
    path.join(enginePkgDir, 'package.json')
  );

  return {
    cliEntry: path.join(cliPkgDir, 'bin', 'ratchet.js'),
    cleanup: async () => {
      await fs.rm(installRoot, { recursive: true, force: true });
    },
  };
}
