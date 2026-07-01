/**
 * Hold-out tag resolution.
 *
 * One source marks a case held out: an in-file `@holdout` Gherkin tag on the
 * Scenario. `resolveHoldout` is a pure function mirroring `resolveSkip`'s
 * shape — synchronous, in-memory, no filesystem, no spawn — but returns a
 * plain boolean since there is exactly one source and nothing else to report.
 */

import type { EvalCase } from './set.js';

export const HOLDOUT_TAG = '@holdout';

/** Resolve whether a case is held out: true when `c.tags` includes `@holdout`. */
export function resolveHoldout(c: EvalCase): boolean {
  return c.tags.includes(HOLDOUT_TAG);
}

const SCENARIO_HEADER = /^(Scenario Outline|Scenario Template|Scenario|Example):/i;
const BACKGROUND_HEADER = /^Background:/i;
const FEATURE_HEADER = /^Feature:/i;

/**
 * Strip every `@holdout`-tagged Scenario/Scenario Outline block out of raw
 * `.feature` text, leaving every other line — Feature header/description,
 * Background, non-held-out Scenarios, comments — untouched byte-for-byte.
 *
 * Operates on raw lines rather than round-tripping through
 * {@link parseFeatureFile}, which drops comments/docstrings/Examples rows
 * when building its `Feature` model. Mirrors `GherkinParser`'s own
 * tag-accumulation/reset state machine (tags accumulate across blank lines
 * and comments until a Scenario/Background line consumes and resets them) so
 * a held-out block's line range — tag line(s) through the line before the
 * next tag run, header, or EOF — naturally sweeps in a held-out Outline's
 * `Examples:` table without special-casing it.
 */
export function filterHoldoutContent(content: string): string {
  const lines = content.split('\n');
  const drop = new Array<boolean>(lines.length).fill(false);

  let pendingTags: string[] = [];
  let tagRunStart: number | null = null;
  let dropRunStart: number | null = null;
  let inDocString = false;
  let docStringFence: '"""' | '```' | null = null;

  const closeDropRun = (endExclusive: number) => {
    if (dropRunStart !== null) {
      for (let j = dropRunStart; j < endExclusive; j++) drop[j] = true;
      dropRunStart = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (inDocString) {
      if (docStringFence && trimmed.startsWith(docStringFence)) {
        inDocString = false;
        docStringFence = null;
      }
      continue;
    }
    if (trimmed.startsWith('"""') || trimmed.startsWith('```')) {
      inDocString = true;
      docStringFence = trimmed.startsWith('"""') ? '"""' : '```';
      continue;
    }
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }
    if (trimmed.startsWith('@')) {
      if (tagRunStart === null) tagRunStart = i;
      pendingTags.push(...trimmed.split(/\s+/).filter((t) => t.startsWith('@')));
      continue;
    }
    if (FEATURE_HEADER.test(trimmed)) {
      // Tags preceding `Feature:` are discarded by the parser and attach to
      // nothing; leave them in place (inert) rather than deleting them.
      pendingTags = [];
      tagRunStart = null;
      continue;
    }
    if (BACKGROUND_HEADER.test(trimmed)) {
      closeDropRun(i);
      pendingTags = [];
      tagRunStart = null;
      continue;
    }
    if (SCENARIO_HEADER.test(trimmed)) {
      closeDropRun(i);
      if (pendingTags.includes(HOLDOUT_TAG)) {
        dropRunStart = tagRunStart ?? i;
      }
      pendingTags = [];
      tagRunStart = null;
      continue;
    }
  }
  closeDropRun(lines.length);

  return lines.filter((_, i) => !drop[i]).join('\n');
}
