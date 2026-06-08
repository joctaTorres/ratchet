/**
 * Validation threshold constants
 */

// Minimum character lengths
export const MIN_WHY_SECTION_LENGTH = 50;

// Maximum character/item limits
export const MAX_WHY_SECTION_LENGTH = 1000;

// Validation messages
export const VALIDATION_MESSAGES = {
  // Plan rules (composition of the former proposal + design + tasks checks)
  CHANGE_WHY_TOO_SHORT: `Why section must be at least ${MIN_WHY_SECTION_LENGTH} characters`,
  CHANGE_WHY_TOO_LONG: `Why section should not exceed ${MAX_WHY_SECTION_LENGTH} characters`,
  CHANGE_WHAT_EMPTY: 'What Changes section cannot be empty',
  PLAN_MISSING_SECTIONS: 'Plan is missing required sections (## Why, ## What Changes, ## Design, ## Tasks)',
  PLAN_NO_TASKS: 'Plan ## Tasks section must contain at least one "- [ ]" checkbox',

  // Feature (Gherkin) rules
  FEATURE_NO_HEADER: 'Feature file must start with a "Feature:" line',
  FEATURE_NO_SCENARIOS: 'Feature must have at least one scenario',
  SCENARIO_NO_STEPS: 'Scenario must have at least one step',
  SCENARIO_MISSING_GWT: 'Scenario must include at least one Given, one When, and one Then step',

  // Standards rules
  STANDARD_DUPLICATE_TAG: (tag: string): string =>
    `Duplicate standard tag "${tag}". Each standard in .ratchet/standards/ must have a unique tag.`,
  STANDARD_UNKNOWN_TAG: (tag: string): string =>
    `Unknown standard tag "${tag}". No standard in .ratchet/standards/ declares this tag.`,
} as const;
