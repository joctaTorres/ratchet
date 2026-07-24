import {
  Feature,
  FeatureScenario,
  Step,
  StepKeywordType,
} from '../schemas/feature.schema.js';

const PRIMARY_STEP_KEYWORDS: StepKeywordType[] = ['Given', 'When', 'Then'];
const CONTINUATION_STEP_KEYWORDS: StepKeywordType[] = ['And', 'But'];
const STEP_KEYWORDS: StepKeywordType[] = [
  ...PRIMARY_STEP_KEYWORDS,
  ...CONTINUATION_STEP_KEYWORDS,
];

/**
 * Hand-rolled, line-oriented Gherkin parser.
 *
 * Mirrors the style of {@link MarkdownParser}: lenient at parse time
 * (tolerates Background, Scenario Outline + Examples tables, docstrings and
 * comments) and leaves strictness to the validator. The parsed model captures
 * Features, Scenarios and their Given/When/Then steps; structural extras such
 * as Background steps, Examples tables and docstrings are recognized so they do
 * not corrupt the scenario step lists.
 */
export class GherkinParser {
  private lines: string[];

  constructor(content: string) {
    const normalized = GherkinParser.normalizeContent(content);
    this.lines = normalized.split('\n');
  }

  private static normalizeContent(content: string): string {
    return content.replace(/\r\n?/g, '\n');
  }

  parseFeature(): Feature {
    let name = '';
    const descriptionLines: string[] = [];
    let sawFeature = false;
    const scenarios: FeatureScenario[] = [];

    let current: { name: string; steps: Step[]; isOutline: boolean; tags: string[] } | null = null;
    let inBackground = false;
    let inExamples = false;
    let inDocString = false;
    let docStringFence: '"""' | '```' | null = null;
    let pendingTags: string[] = [];

    const flush = () => {
      if (current) {
        scenarios.push({
          name: current.name,
          steps: current.steps,
          isOutline: current.isOutline,
          tags: current.tags,
        });
        current = null;
      }
    };

    for (const rawLine of this.lines) {
      const line = rawLine;
      const trimmed = line.trim();

      // Docstring handling: everything inside a """ or ``` fence is opaque.
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

      // Skip blanks and comments.
      if (trimmed.length === 0 || trimmed.startsWith('#')) {
        continue;
      }

      // Tags (e.g. @smoke @wip) annotate the next Scenario/Scenario Outline
      // block; accumulate them until that block is reached.
      if (trimmed.startsWith('@')) {
        pendingTags.push(...trimmed.split(/\s+/).filter((t) => t.startsWith('@')));
        continue;
      }

      const featureMatch = trimmed.match(/^Feature:\s*(.*)$/i);
      if (featureMatch) {
        sawFeature = true;
        name = featureMatch[1].trim();
        inBackground = false;
        inExamples = false;
        pendingTags = [];
        continue;
      }

      const backgroundMatch = trimmed.match(/^Background:/i);
      if (backgroundMatch) {
        flush();
        inBackground = true;
        inExamples = false;
        pendingTags = [];
        continue;
      }

      const scenarioMatch = trimmed.match(/^(Scenario Outline|Scenario Template|Scenario|Example):\s*(.*)$/i);
      if (scenarioMatch) {
        flush();
        const isOutline = /^Scenario Outline$/i.test(scenarioMatch[1]) ||
          /^Scenario Template$/i.test(scenarioMatch[1]);
        current = {
          name: scenarioMatch[2].trim(),
          steps: [],
          isOutline,
          tags: pendingTags,
        };
        pendingTags = [];
        inBackground = false;
        inExamples = false;
        continue;
      }

      const examplesMatch = trimmed.match(/^(Examples|Scenarios):/i);
      if (examplesMatch) {
        inExamples = true;
        // Tags accumulated before an Examples block belong to that block's
        // parent Scenario Outline, not to the next Scenario. Clear them so they
        // do not leak onto a following block (mirrors other block starts).
        pendingTags = [];
        continue;
      }

      // Examples / data-table rows are opaque to the step model.
      if (inExamples || trimmed.startsWith('|')) {
        continue;
      }

      const step = GherkinParser.matchStep(trimmed);
      if (step) {
        if (inBackground) {
          // Background steps are not attached to any scenario.
          continue;
        }
        if (current) {
          current.steps.push(step);
        }
        continue;
      }

      // Otherwise this is free-form description text. Only the lines that appear
      // before the first scenario/background contribute to the feature
      // description.
      if (sawFeature && !current && !inBackground) {
        descriptionLines.push(trimmed);
      }
    }

    flush();

    const description = descriptionLines.join('\n').trim();

    return {
      name,
      ...(description ? { description } : {}),
      scenarios,
    };
  }

  private static matchStep(trimmed: string): Step | null {
    for (const keyword of STEP_KEYWORDS) {
      const re = new RegExp(`^${keyword}\\b\\s*(.*)$`, 'i');
      const m = trimmed.match(re);
      if (m) {
        const text = m[1].trim();
        return { keyword, text };
      }
    }
    return null;
  }
}

/**
 * Convenience wrapper mirroring markdown-parser's free-function style.
 */
export function parseFeatureFile(content: string): Feature {
  return new GherkinParser(content).parseFeature();
}
