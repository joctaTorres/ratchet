import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../validation/constants.js';

/**
 * Gherkin step keyword. `And`/`But` continue the previous primary keyword's
 * kind, but are preserved verbatim here so callers can render them.
 */
export const StepKeyword = z.enum(['Given', 'When', 'Then', 'And', 'But']);

export const StepSchema = z.object({
  keyword: StepKeyword,
  text: z.string().min(1),
});

export const ScenarioSchema = z.object({
  name: z.string().min(1),
  steps: z.array(StepSchema).min(1, VALIDATION_MESSAGES.SCENARIO_NO_STEPS),
  isOutline: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
});

export const FeatureSchema = z.object({
  name: z.string().min(1, VALIDATION_MESSAGES.FEATURE_NO_HEADER),
  description: z.string().optional(),
  scenarios: z.array(ScenarioSchema).min(1, VALIDATION_MESSAGES.FEATURE_NO_SCENARIOS),
});

export type StepKeywordType = z.infer<typeof StepKeyword>;
export type Step = z.infer<typeof StepSchema>;
export type FeatureScenario = z.infer<typeof ScenarioSchema>;
export type Feature = z.infer<typeof FeatureSchema>;
