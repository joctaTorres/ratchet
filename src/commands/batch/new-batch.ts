/**
 * `ratchet new batch <name>` / `ratchet batch new <name>`
 *
 * Scaffold a batch manifest under `.ratchet/batches/<name>/batch.yaml` from the
 * canonical batch template, mirroring `ratchet new change`. Validates the name
 * as kebab-case and refuses to overwrite an existing batch.
 */

import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import ora from 'ora';
import { validateChangeName } from '../../utils/change-utils.js';
import { resolveCurrentPlanningHomeSync } from '../../core/planning-home.js';
import {
  batchExists,
  getBatchDir,
  getBatchManifestPath,
} from '../../core/batch/manifest.js';
import { loadTemplate } from '../../core/artifact-graph/index.js';
import { DEFAULT_SCHEMA_NAME } from '../../core/config.js';

export interface NewBatchOptions {
  json?: boolean;
}

/** Stamp the template with the real batch name and today's created date. */
function renderTemplate(template: string, name: string): string {
  const today = new Date().toISOString().split('T')[0];
  return template
    .replace(/^name:.*$/m, `name: ${name}`)
    .replace(/^created:.*$/m, `created: ${today}`);
}

export async function newBatchCommand(
  name: string | undefined,
  options: NewBatchOptions = {}
): Promise<void> {
  const spinner = options.json ? undefined : ora();

  if (!name) {
    throw new Error('Missing required argument <name>');
  }

  const validation = validateChangeName(name);
  if (!validation.valid) {
    throw new Error(`${validation.error} (batch names use kebab-case)`);
  }

  const planningHome = resolveCurrentPlanningHomeSync();
  const projectRoot = planningHome.root;

  if (batchExists(projectRoot, name)) {
    throw new Error(
      `Batch '${name}' already exists at ${getBatchManifestPath(projectRoot, name)}`
    );
  }

  const template = loadTemplate(DEFAULT_SCHEMA_NAME, 'batch.yaml', projectRoot);
  const content = renderTemplate(template, name);

  const batchDir = getBatchDir(projectRoot, name);
  const manifestPath = getBatchManifestPath(projectRoot, name);
  mkdirSync(batchDir, { recursive: true });
  writeFileSync(manifestPath, content, 'utf-8');

  if (options.json) {
    console.log(
      JSON.stringify({ batch: { name, path: manifestPath } }, null, 2)
    );
    return;
  }

  spinner?.stop();
  const relative = path.relative(projectRoot, manifestPath);
  console.log(`Created batch '${name}' at ${relative}`);
}
