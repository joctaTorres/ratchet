/**
 * Template Command
 *
 * Prints a schema template to stdout, loaded from the canonical
 * `schemas/<schema>/templates/` directory via the same `loadTemplate` used by the
 * `instructions` command. This lets non-change workflows (e.g. propose-standard)
 * follow the canonical template at runtime instead of embedding a copy that can
 * drift from the schema.
 */

import { loadTemplate } from '../core/artifact-graph/index.js';
import { resolveCurrentPlanningHomeSync } from '../core/planning-home.js';
import { DEFAULT_SCHEMA_NAME } from '../core/config.js';

export interface TemplateOptions {
  schema?: string;
}

// Candidate file extensions tried for a bare template name (e.g. "standard").
const TEMPLATE_EXTENSIONS = ['.md', '.feature', '.yaml', '.yml'];

/**
 * Resolves the template file content for a name, trying known extensions when the
 * name has none. Returns the first match; throws the last error when nothing loads.
 */
function loadTemplateByName(
  schema: string,
  name: string,
  projectRoot: string | undefined
): string {
  const candidates =
    name.includes('.') ? [name] : TEMPLATE_EXTENSIONS.map((ext) => `${name}${ext}`);

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return loadTemplate(schema, candidate, projectRoot);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Template '${name}' not found in schema '${schema}'`);
}

export async function templateCommand(name: string, options: TemplateOptions): Promise<void> {
  // Resolve the project root so project-local schema overrides win, falling back
  // to the bundled schema template when the project has none.
  let projectRoot: string | undefined;
  try {
    projectRoot = resolveCurrentPlanningHomeSync().root;
  } catch {
    projectRoot = undefined;
  }

  const schema = options.schema ?? DEFAULT_SCHEMA_NAME;
  const content = loadTemplateByName(schema, name, projectRoot);

  process.stdout.write(content.endsWith('\n') ? content : `${content}\n`);
}
