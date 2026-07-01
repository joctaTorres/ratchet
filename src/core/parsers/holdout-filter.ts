/**
 * Parser-adjacent hold-out content filter.
 *
 * A domain-neutral text transform over raw `.feature` source: strip every
 * `@holdout`-tagged Scenario block out of the text, leaving everything else
 * byte-for-byte. It re-implements the tag accumulate/reset state machine of
 * the `GherkinParser` in `./gherkin-parser.js` on raw lines, so it lives
 * beside that parser rather than in any consuming domain (eval,
 * artifact-graph) — keeping the artifact-graph apply path off the eval domain.
 * Nothing at the type level keeps the filter and the parser in lockstep, so
 * `test/core/parsers/holdout-filter.test.ts` feeds one fixture through both and
 * asserts they agree on which Scenarios are `@holdout`. The eval domain re-uses
 * {@link HOLDOUT_TAG} from here for its `EvalCase`-level resolution.
 */

/** The Gherkin tag that marks a Scenario as held out from evaluation. */
export const HOLDOUT_TAG = '@holdout';

const SCENARIO_HEADER = /^(Scenario Outline|Scenario Template|Scenario|Example):/i;
const BACKGROUND_HEADER = /^Background:/i;
const FEATURE_HEADER = /^Feature:/i;
const EXAMPLES_HEADER = /^(Examples|Scenarios):/i;

/**
 * Build a stateful predicate that tracks `"""` / ``` ``` ``` docstring fences.
 * Given a trimmed line it returns `true` when the line is inside, opening, or
 * closing a fence (and should be treated as opaque), `false` otherwise —
 * factored out of {@link filterHoldoutContent} to keep its cyclomatic
 * complexity under the project gate.
 */
function makeDocStringSkipper(): (trimmed: string) => boolean {
  let inDocString = false;
  let fence: '"""' | '```' | null = null;
  return (trimmed: string): boolean => {
    if (inDocString) {
      if (fence && trimmed.startsWith(fence)) {
        inDocString = false;
        fence = null;
      }
      return true;
    }
    if (trimmed.startsWith('"""') || trimmed.startsWith('```')) {
      inDocString = true;
      fence = trimmed.startsWith('"""') ? '"""' : '```';
      return true;
    }
    return false;
  };
}

/**
 * Strip every `@holdout`-tagged Scenario/Scenario Outline block out of raw
 * `.feature` text, leaving every other line — Feature header/description,
 * Background, non-held-out Scenarios, comments — untouched byte-for-byte.
 *
 * Operates on raw lines rather than round-tripping through
 * {@link parseFeatureFile}, which drops comments/docstrings/Examples rows
 * when building its `Feature` model. Mirrors `GherkinParser`'s own
 * tag-accumulation/reset state machine (tags accumulate across blank lines and
 * comments until a Scenario/Background/Examples line consumes and resets them,
 * keeping the two in lockstep) so a held-out block's line range — tag line(s)
 * through the line before the next tag run, header, or EOF — sweeps in a
 * held-out Outline's `Examples:` table while a tag on that `Examples:` line
 * cannot leak onto the following Scenario.
 */
export function filterHoldoutContent(content: string): string {
  const lines = content.split('\n');
  const drop = new Array<boolean>(lines.length).fill(false);

  let pendingTags: string[] = [];
  let tagRunStart: number | null = null;
  let dropRunStart: number | null = null;
  const inDocString = makeDocStringSkipper();

  const closeDropRun = (endExclusive: number) => {
    if (dropRunStart !== null) {
      for (let j = dropRunStart; j < endExclusive; j++) drop[j] = true;
      dropRunStart = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Everything inside a """ or ``` fence is opaque; the skipper tracks the
    // fence state and reports whether this line was consumed by it.
    if (inDocString(trimmed)) {
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
    if (EXAMPLES_HEADER.test(trimmed)) {
      // Tags accumulated before an `Examples:` block belong to the enclosing
      // Scenario Outline, not to the next Scenario — mirror the parser and
      // clear them so they cannot leak forward. The drop run (if any) is left
      // open so a held-out Outline's Examples table is still swept in.
      pendingTags = [];
      tagRunStart = null;
      continue;
    }
  }
  closeDropRun(lines.length);

  return lines.filter((_, i) => !drop[i]).join('\n');
}
