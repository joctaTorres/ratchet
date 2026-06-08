import { ZodError } from 'zod';
import { readFileSync } from 'fs';
import path from 'path';
import fg from 'fast-glob';
import {
  FeatureSchema,
  Feature,
  FeatureScenario,
} from '../schemas/feature.schema.js';
import { MarkdownParser } from '../parsers/markdown-parser.js';
import { GherkinParser } from '../parsers/gherkin-parser.js';
import { ValidationReport, ValidationIssue, ValidationLevel } from './types.js';
import {
  MIN_WHY_SECTION_LENGTH,
  MAX_WHY_SECTION_LENGTH,
  VALIDATION_MESSAGES
} from './constants.js';
import { loadStandards } from '../standards.js';
import { readDeclaredStandardTags } from '../../utils/change-metadata.js';

export class Validator {
  private strictMode: boolean;

  constructor(strictMode: boolean = false) {
    this.strictMode = strictMode;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Feature (Gherkin) validation
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Validate a single Gherkin feature file on disk.
   */
  async validateFeatureFile(filePath: string): Promise<ValidationReport> {
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return this.createReport([{ level: 'ERROR', path: 'file', message }]);
    }
    return this.validateFeatureContent(content, filePath);
  }

  /**
   * Validate Gherkin feature content from a string. `displayPath` is used as the
   * issue path so aggregated reports can point at the originating file.
   */
  async validateFeatureContent(content: string, displayPath: string = 'feature'): Promise<ValidationReport> {
    const issues: ValidationIssue[] = [];
    try {
      const feature = new GherkinParser(content).parseFeature();
      const result = FeatureSchema.safeParse(feature);
      if (!result.success) {
        issues.push(...this.convertFeatureZodErrors(result.error, displayPath));
      }
      issues.push(...this.applyFeatureRules(feature, displayPath));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      issues.push({ level: 'ERROR', path: displayPath, message });
    }
    return this.createReport(issues);
  }

  /**
   * Validate all `**\/*.feature` files under a directory and aggregate results.
   * Returns a single report whose issues are tagged with each file's relative
   * path. A directory with no feature files yields an ERROR (a change must
   * describe behavior).
   */
  async validateFeatures(dir: string): Promise<ValidationReport> {
    const issues: ValidationIssue[] = [];
    let files: string[] = [];
    try {
      files = await fg('**/*.feature', { cwd: dir, onlyFiles: true });
    } catch {
      files = [];
    }

    if (files.length === 0) {
      issues.push({
        level: 'ERROR',
        path: 'features',
        message: 'No .feature files found. Add at least one features/<capability>/<name>.feature.',
      });
      return this.createReport(issues);
    }

    files.sort();
    for (const rel of files) {
      const abs = path.join(dir, rel);
      let content: string;
      try {
        content = readFileSync(abs, 'utf-8');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        issues.push({ level: 'ERROR', path: `features/${rel}`, message });
        continue;
      }
      const report = await this.validateFeatureContent(content, `features/${rel}`);
      issues.push(...report.issues);
    }

    return this.createReport(issues);
  }

  private applyFeatureRules(feature: Feature, displayPath: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const seenScenarioNames = new Set<string>();

    feature.scenarios.forEach((scenario, index) => {
      const scenarioPath = `${displayPath}#scenario[${index}]`;

      // Duplicate scenario names within a feature (WARNING).
      const nameKey = scenario.name.trim().toLowerCase();
      if (nameKey) {
        if (seenScenarioNames.has(nameKey)) {
          issues.push({
            level: 'WARNING',
            path: scenarioPath,
            message: `Duplicate scenario name "${scenario.name}"`,
          });
        } else {
          seenScenarioNames.add(nameKey);
        }
      }

      const gwt = this.classifyScenarioSteps(scenario);

      // Missing any of Given/When/Then (And/But do not satisfy) (ERROR).
      if (!gwt.hasGiven || !gwt.hasWhen || !gwt.hasThen) {
        issues.push({
          level: 'ERROR',
          path: scenarioPath,
          message: `Scenario "${scenario.name}": ${VALIDATION_MESSAGES.SCENARIO_MISSING_GWT}`,
        });
      }

      // Then-only scenario (no Given and no When primary, only Then) (WARNING).
      // This is also flagged as a missing-GWT ERROR above, but the advisory
      // gives a more actionable hint.
      if (gwt.thenOnlyPrimary) {
        issues.push({
          level: 'WARNING',
          path: scenarioPath,
          message: `Scenario "${scenario.name}" has only Then steps; add Given/When context`,
        });
      }

      // Scenario Outline without Examples (INFO).
      if (scenario.isOutline && !this.scenarioHasOutlineParams(scenario)) {
        issues.push({
          level: 'INFO',
          path: scenarioPath,
          message: `Scenario Outline "${scenario.name}" has no <placeholder> parameters; consider a plain Scenario or add an Examples table`,
        });
      }
    });

    return issues;
  }

  private classifyScenarioSteps(scenario: FeatureScenario): {
    hasGiven: boolean;
    hasWhen: boolean;
    hasThen: boolean;
    thenOnlyPrimary: boolean;
  } {
    let hasGiven = false;
    let hasWhen = false;
    let hasThen = false;
    for (const step of scenario.steps) {
      if (step.keyword === 'Given') hasGiven = true;
      else if (step.keyword === 'When') hasWhen = true;
      else if (step.keyword === 'Then') hasThen = true;
    }
    const thenOnlyPrimary = hasThen && !hasGiven && !hasWhen;
    return { hasGiven, hasWhen, hasThen, thenOnlyPrimary };
  }

  private scenarioHasOutlineParams(scenario: FeatureScenario): boolean {
    return scenario.steps.some(step => /<[^>]+>/.test(step.text));
  }

  private convertFeatureZodErrors(error: ZodError, displayPath: string): ValidationIssue[] {
    return error.issues.map(err => ({
      level: 'ERROR' as ValidationLevel,
      path: err.path.length ? `${displayPath}.${err.path.join('.')}` : displayPath,
      message: err.message,
    }));
  }

  // ───────────────────────────────────────────────────────────────────────
  // Plan validation (composition of proposal + design + tasks rules)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Validate a plan.md file. The plan merges the former proposal + design +
   * tasks artifacts, so the rules are the composition of those checks:
   * - ## Why present and within length bounds
   * - ## What Changes present and non-empty
   * - ## Design present
   * - ## Tasks present with at least one "- [ ]" checkbox
   */
  async validatePlan(filePath: string): Promise<ValidationReport> {
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return this.createReport([{ level: 'ERROR', path: 'file', message }]);
    }
    return this.validatePlanContent(content);
  }

  async validatePlanContent(content: string): Promise<ValidationReport> {
    const issues: ValidationIssue[] = [];
    const parser = new PlanSectionParser(content);

    const why = parser.getSectionContent('Why');
    const whatChanges = parser.getSectionContent('What Changes');
    const design = parser.getSectionContent('Design');
    const tasks = parser.getSectionContent('Tasks');

    const missing: string[] = [];
    if (why === undefined) missing.push('## Why');
    if (whatChanges === undefined) missing.push('## What Changes');
    if (design === undefined) missing.push('## Design');
    if (tasks === undefined) missing.push('## Tasks');

    if (missing.length > 0) {
      issues.push({
        level: 'ERROR',
        path: 'file',
        message: `${VALIDATION_MESSAGES.PLAN_MISSING_SECTIONS}. Missing: ${missing.join(', ')}`,
      });
    }

    // Why length bounds (reuse proposal rules).
    if (why !== undefined) {
      const whyText = why.trim();
      if (whyText.length < MIN_WHY_SECTION_LENGTH) {
        issues.push({
          level: 'WARNING',
          path: 'Why',
          message: VALIDATION_MESSAGES.CHANGE_WHY_TOO_SHORT,
        });
      } else if (whyText.length > MAX_WHY_SECTION_LENGTH) {
        issues.push({
          level: 'WARNING',
          path: 'Why',
          message: VALIDATION_MESSAGES.CHANGE_WHY_TOO_LONG,
        });
      }
    }

    // What Changes non-empty (reuse proposal rule).
    if (whatChanges !== undefined && whatChanges.trim().length === 0) {
      issues.push({
        level: 'ERROR',
        path: 'What Changes',
        message: VALIDATION_MESSAGES.CHANGE_WHAT_EMPTY,
      });
    }

    // Tasks must contain at least one checkbox (reuse tasks rule).
    if (tasks !== undefined) {
      const hasCheckbox = /^[-*]\s*\[[ xX]\]\s*.+$/m.test(tasks);
      if (!hasCheckbox) {
        issues.push({
          level: 'ERROR',
          path: 'Tasks',
          message: VALIDATION_MESSAGES.PLAN_NO_TASKS,
        });
      }
    }

    return this.createReport(issues);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Standards validation
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Validate the standards link for a change. Two ERROR-level checks:
   *
   * 1. Standard `tag` uniqueness across `.ratchet/standards/` — duplicate tags
   *    (after file-name fallback) are reported once per offending tag.
   * 2. Every tag in the change's `standards` list resolves to an existing
   *    standard; unresolved tags are reported.
   *
   * The change's `standards` list is read raw (via `yaml.parse`) so a malformed
   * or unknown-schema `.ratchet.yaml` surfaces as a missing list rather than an
   * exception — validation reports issues, it does not throw.
   *
   * @param changeDir - The change directory (containing `.ratchet.yaml`)
   * @param projectRoot - Project root (defaults to `changeDir/../../..`)
   */
  validateStandards(changeDir: string, projectRoot?: string): ValidationReport {
    const root = projectRoot ?? path.resolve(changeDir, '../../..');
    const issues: ValidationIssue[] = [];

    // Resolve every standard's tag (explicit or file-name fallback).
    const standards = loadStandards(root);
    const seenTags = new Set<string>();
    const reportedDuplicates = new Set<string>();
    for (const standard of standards) {
      if (seenTags.has(standard.tag)) {
        if (!reportedDuplicates.has(standard.tag)) {
          issues.push({
            level: 'ERROR',
            path: 'standards',
            message: VALIDATION_MESSAGES.STANDARD_DUPLICATE_TAG(standard.tag),
          });
          reportedDuplicates.add(standard.tag);
        }
      } else {
        seenTags.add(standard.tag);
      }
    }

    // Check that every tag the change references resolves to a standard.
    for (const tag of readDeclaredStandardTags(changeDir)) {
      if (!seenTags.has(tag)) {
        issues.push({
          level: 'ERROR',
          path: 'standards',
          message: VALIDATION_MESSAGES.STANDARD_UNKNOWN_TAG(tag),
        });
      }
    }

    return this.createReport(issues);
  }

  private createReport(issues: ValidationIssue[]): ValidationReport {
    const errors = issues.filter(i => i.level === 'ERROR').length;
    const warnings = issues.filter(i => i.level === 'WARNING').length;
    const info = issues.filter(i => i.level === 'INFO').length;
    
    const valid = this.strictMode 
      ? errors === 0 && warnings === 0
      : errors === 0;
    
    return {
      valid,
      issues,
      summary: {
        errors,
        warnings,
        info,
      },
    };
  }

  isValid(report: ValidationReport): boolean {
    return report.valid;
  }

}

/**
 * Thin subclass of MarkdownParser exposing top-level `##` section lookup for
 * plan.md validation. Reuses the inherited code-fence-aware section parsing so
 * the plan rules share the existing section-presence logic rather than
 * reinventing it.
 */
class PlanSectionParser extends MarkdownParser {
  /**
   * Returns the trimmed content of the named section, or `undefined` if the
   * section header is absent.
   */
  getSectionContent(title: string): string | undefined {
    const sections = this.parseSections();
    const section = this.findSection(sections, title);
    return section ? section.content : undefined;
  }
}
