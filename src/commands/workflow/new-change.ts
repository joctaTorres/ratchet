/**
 * New Change Command
 *
 * Creates a new change directory with optional description and schema.
 */

import ora from 'ora';
import path from 'path';
import { createChange, validateChangeName } from '../../utils/change-utils.js';
import {
  formatChangeLocation,
  resolveCurrentPlanningHomeSync,
  type PlanningHome,
} from '../../core/planning-home.js';
import { validateSchemaExists } from './shared.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface NewChangeOptions {
  description?: string;
  schema?: string;
  json?: boolean;
}

interface NewChangeOutput {
  change: {
    id: string;
    path: string;
    metadataPath: string;
    schema: string;
  };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function statusFromError(error: unknown): { code: string; message: string } {
  return {
    code: 'error',
    message: error instanceof Error ? error.message : String(error),
  };
}

function outputForCreatedChange(
  id: string,
  changeDir: string,
  schema: string
): NewChangeOutput {
  return {
    change: {
      id,
      path: changeDir,
      metadataPath: path.join(changeDir, '.ratchet.yaml'),
      schema,
    },
  };
}

function printCreatedChangeHuman(payload: NewChangeOutput, planningHome: PlanningHome): void {
  if (!payload.change) {
    return;
  }

  const location = formatChangeLocation(planningHome, payload.change.id);
  console.log(`Created change '${payload.change.id}' at ${location}/`);
  console.log(`Schema: ${payload.change.schema}`);
}

// -----------------------------------------------------------------------------
// Command Implementation
// -----------------------------------------------------------------------------

export async function newChangeCommand(name: string | undefined, options: NewChangeOptions): Promise<void> {
  const spinner = options.json ? undefined : ora();

  try {
    if (!name) {
      throw new Error('Missing required argument <name>');
    }

    const validation = validateChangeName(name);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const planningHome = resolveCurrentPlanningHomeSync();
    const projectRoot = planningHome.root;

    // Validate schema if provided
    if (options.schema) {
      validateSchemaExists(options.schema, projectRoot);
    }

    const resolvedSchema = options.schema ?? planningHome.defaultSchema;
    if (spinner) {
      spinner.start(`Creating change '${name}' with schema '${resolvedSchema}'...`);
    }

    const result = await createChange(projectRoot, name, {
      schema: options.schema,
      defaultSchema: planningHome.defaultSchema,
      changesDir: planningHome.changesDir,
    });

    // If description provided, create README.md with description
    if (options.description) {
      const { promises: fs } = await import('fs');
      const readmePath = path.join(result.changeDir, 'README.md');
      await fs.writeFile(readmePath, `# ${name}\n\n${options.description}\n`, 'utf-8');
    }

    const payload = outputForCreatedChange(name, result.changeDir, result.schema);

    if (options.json) {
      printJson(payload);
      return;
    }

    spinner?.stop();
    printCreatedChangeHuman(payload, planningHome);
  } catch (error) {
    spinner?.stop();
    if (options.json) {
      printJson({
        change: null,
        status: [statusFromError(error)],
      });
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}
