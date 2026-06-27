/**
 * Stable eval case identifiers.
 *
 * A case id is `<relative-feature-path-sans-ext>#<scenario-slug>` using posix
 * separators so the id is stable across platforms and runs. When two scenarios
 * in the same file slug to the same value, the second and later get an ordinal
 * suffix (`-2`, `-3`, ...) in document order, so every case in a file is unique.
 *
 * The id is what baseline diffing keys on: a renamed scenario surfaces as a
 * retired id plus a new id (an accepted trade-off), never a silent mismatch.
 */

/**
 * Kebab-case a free-text value into a stable, url-ish slug, or `''` when nothing
 * sluggable remains. The shared transform behind {@link slugifyScenario} (which
 * adds a non-empty fallback) and the propose verb's change-name derivation
 * (which treats `''` as "no derivable name").
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Slugify a scenario name into a stable, url-ish token. */
export function slugifyScenario(name: string): string {
  const slug = slugify(name);
  return slug.length > 0 ? slug : 'scenario';
}

/** Normalise a feature file path (relative to the scope root) into a posix
 * path without its `.feature` extension. */
export function featurePathToken(relativeFeaturePath: string): string {
  return relativeFeaturePath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\.feature$/i, '');
}

/** Build a single case id from a feature path token and a scenario slug. */
export function buildCaseId(relativeFeaturePath: string, scenarioName: string): string {
  return `${featurePathToken(relativeFeaturePath)}#${slugifyScenario(scenarioName)}`;
}

/**
 * Assign stable ids to the scenarios of a single feature file, applying ordinal
 * suffixes (`-2`, `-3`, ...) to duplicate scenario slugs in document order.
 */
export function assignCaseIds(
  relativeFeaturePath: string,
  scenarioNames: string[]
): string[] {
  const token = featurePathToken(relativeFeaturePath);
  const seen = new Map<string, number>();
  return scenarioNames.map((name) => {
    const slug = slugifyScenario(name);
    const count = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, count);
    const suffix = count > 1 ? `-${count}` : '';
    return `${token}#${slug}${suffix}`;
  });
}
