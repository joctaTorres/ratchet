import * as fs from 'node:fs';
import * as path from 'node:path';
import fg from 'fast-glob';
import { FileSystemUtils } from '../../utils/file-system.js';
import { filterHoldoutContent } from '../eval/holdout.js';

/**
 * Checks if a path contains glob pattern characters.
 */
export function isGlobPattern(pattern: string): boolean {
  return pattern.includes('*') || pattern.includes('?') || pattern.includes('[');
}

/**
 * Resolves an artifact's output path(s) to concrete files that currently exist.
 * Returns absolute file paths. Glob matches are sorted for deterministic output.
 */
export function resolveArtifactOutputs(changeDir: string, generates: string): string[] {
  if (!isGlobPattern(generates)) {
    const fullPath = path.join(changeDir, generates);
    try {
      return fs.statSync(fullPath).isFile()
        ? [FileSystemUtils.canonicalizeExistingPath(fullPath)]
        : [];
    } catch {
      return [];
    }
  }

  const normalizedPattern = FileSystemUtils.toPosixPath(generates);
  const matches = fg
    .sync(normalizedPattern, { cwd: changeDir, onlyFiles: true, absolute: true })
    .map((match) => FileSystemUtils.canonicalizeExistingPath(path.normalize(match)));

  return Array.from(new Set(matches)).sort();
}

/**
 * Checks if an artifact has at least one resolved output file.
 */
export function artifactOutputExists(changeDir: string, generates: string): boolean {
  return resolveArtifactOutputs(changeDir, generates).length > 0;
}

/**
 * The result of {@link materializeApplyContext}: the resolved context-file
 * paths for the building agent plus the total count of `@holdout`-tagged
 * Scenario blocks stripped across all `.feature` outputs for this artifact.
 */
export interface ApplyContextResult {
  paths: string[];
  heldOutCount: number;
}

/**
 * Materializes a filtered copy of each `.feature` output for the building
 * agent to read during apply: `@holdout`-tagged Scenario content stripped via
 * {@link filterHoldoutContent}, written to
 * `<changeDir>/.apply-context/<artifactId>/...` mirrored by the output's path
 * relative to `changeDir`, and fully regenerated (overwritten) on every call.
 * The source `.feature` file is never modified. Non-`.feature` outputs (e.g.
 * `plan.md`) pass through unchanged — hold-out visibility only applies to
 * Gherkin scenarios.
 *
 * When `evalIntent` is `false` (no `.ratchet/evals/` directory), filtering is
 * skipped entirely: source paths are returned unchanged and no
 * `.apply-context/` directory is written. Filtering only makes sense when
 * `eval run` exists to enforce the held-out scenarios; without it, stripping
 * would hide content with no enforcement gate in place.
 */
export function materializeApplyContext(
  changeDir: string,
  artifactId: string,
  outputs: string[],
  evalIntent: boolean
): ApplyContextResult {
  if (!evalIntent) {
    return { paths: outputs, heldOutCount: 0 };
  }

  const canonicalChangeDir = FileSystemUtils.canonicalizeExistingPath(changeDir);
  let heldOutCount = 0;

  const paths = outputs.map((output) => {
    if (!output.endsWith('.feature')) return output;

    const relative = path.relative(canonicalChangeDir, output);
    const materializedPath = path.join(canonicalChangeDir, '.apply-context', artifactId, relative);

    const content = fs.readFileSync(output, 'utf-8');
    const result = filterHoldoutContent(content);
    heldOutCount += result.heldOutCount;

    fs.mkdirSync(path.dirname(materializedPath), { recursive: true });
    fs.writeFileSync(materializedPath, result.content, 'utf-8');

    return FileSystemUtils.canonicalizeExistingPath(materializedPath);
  });

  return { paths, heldOutCount };
}
