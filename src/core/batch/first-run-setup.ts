/**
 * First-run agent-permissions setup.
 *
 * Fires from a batch-scoped pre-action the FIRST time a `ratchet batch` command
 * runs with no permission policy configured at the user or project scope. Its job
 * is to help an interactive operator choose a posture once — while NEVER blocking
 * a headless/CI run.
 *
 * The load-bearing guarantee (see features/agent-permissions/first-run-setup):
 * when the run is non-interactive (no TTY, `CI`, or `OPEN_SPEC_INTERACTIVE=0`),
 * this does NOT prompt, does NOT write any config, and returns immediately. The
 * effective posture then falls back to the built-in `repo-sandboxed-permissive`
 * via the normal resolution path. Idempotent: once a policy exists at either
 * scope, this is a no-op.
 *
 * Style mirrors `ratchet init` (dynamic `@inquirer/prompts`, `chalk`).
 */

import chalk from 'chalk';
import { isInteractive } from '../../utils/interactive.js';
import {
  hasPermissionConfig,
  setProjectBatchPermissions,
  DEFAULT_PERMISSION_POSTURE,
  PERMISSION_POSTURE_VALUES,
  type PermissionPosture,
  type PermissionsPolicy,
} from './config.js';
import { saveUserBatchPermissions } from '../global-config.js';

/** Where the chosen policy is saved. Project is the default. */
export type FirstRunSaveScope = 'project' | 'user';

/** Outcome of the first-run setup, returned for testability/observability. */
export interface FirstRunResult {
  /** `prompted` only when an interactive setup actually ran to completion. */
  action: 'already-configured' | 'non-interactive-fallback' | 'prompted';
  /** The posture in effect after the setup (the fallback default when skipped). */
  posture: PermissionPosture;
  /** Where the policy was saved, when it was saved. */
  savedTo?: FirstRunSaveScope;
}

/** Human-friendly one-line descriptions for each posture in the prompt. */
export const POSTURE_DESCRIPTIONS: Record<PermissionPosture, string> = {
  'repo-sandboxed-permissive':
    'Sandboxed (recommended): edits & build/test run unprompted, scoped to the repo, dangerous ops denied',
  'curated-allowlist': 'Curated: only an explicit allow-list runs unprompted',
  'full-autonomy': 'Full autonomy: bypass ALL permission checks (use with care)',
};

/**
 * The shared posture-selection prompt. Factored out so both batch first-run
 * setup and `ratchet init`'s sandbox-permission offer present the same
 * agent-agnostic posture choices from a single source of truth. Lazily imports
 * `@inquirer/prompts`, matching `ratchet init`.
 */
export async function selectPosture(): Promise<PermissionPosture> {
  const { select } = await import('@inquirer/prompts');
  return select<PermissionPosture>({
    message: 'Choose an agent permission posture for headless agent runs:',
    default: DEFAULT_PERMISSION_POSTURE,
    choices: PERMISSION_POSTURE_VALUES.map((value) => ({
      value,
      name: value,
      description: POSTURE_DESCRIPTIONS[value],
    })),
  });
}

/**
 * The injectable prompt seam so the interactive flow is unit-testable without a
 * real TTY. The default implementation lazily imports `@inquirer/prompts`,
 * matching `ratchet init`.
 */
export interface FirstRunPrompts {
  selectPosture(): Promise<PermissionPosture>;
  selectScope(): Promise<FirstRunSaveScope>;
}

const defaultPrompts: FirstRunPrompts = {
  selectPosture,
  async selectScope() {
    const { select } = await import('@inquirer/prompts');
    return select<FirstRunSaveScope>({
      message: 'Save this policy to:',
      default: 'project',
      choices: [
        { value: 'project', name: 'This project (.ratchet/config.yaml)' },
        { value: 'user', name: 'My user config (applies to all projects)' },
      ],
    });
  },
};

export interface FirstRunOptions {
  /** Override interactivity detection (tests). Defaults to `isInteractive()`. */
  interactive?: boolean;
  /** Override the prompt seam (tests). */
  prompts?: FirstRunPrompts;
  /** Suppress the human-readable notices (tests / JSON callers). */
  quiet?: boolean;
}

/**
 * Run the first-run permission setup for `projectRoot`. Safe to call before every
 * batch command — it short-circuits when already configured or non-interactive.
 */
export async function maybeRunFirstRunSetup(
  projectRoot: string,
  options: FirstRunOptions = {}
): Promise<FirstRunResult> {
  // Idempotent: a policy at any persisted scope means we never prompt again.
  if (hasPermissionConfig(projectRoot)) {
    return { action: 'already-configured', posture: DEFAULT_PERMISSION_POSTURE };
  }

  // The load-bearing guarantee: headless/CI must NEVER prompt, write, or block.
  const interactive = options.interactive ?? isInteractive();
  if (!interactive) {
    return {
      action: 'non-interactive-fallback',
      posture: DEFAULT_PERMISSION_POSTURE,
    };
  }

  const prompts = options.prompts ?? defaultPrompts;
  const posture = await prompts.selectPosture();
  const scope = await prompts.selectScope();

  const policy: PermissionsPolicy = { posture };
  if (scope === 'user') {
    saveUserBatchPermissions(policy);
    if (!options.quiet) {
      console.log(chalk.green(`Saved agent permission posture '${posture}' to your user config.`));
    }
  } else {
    const filePath = setProjectBatchPermissions(projectRoot, policy);
    if (!options.quiet) {
      console.log(
        chalk.green(`Saved agent permission posture '${posture}' to ${filePath}.`)
      );
    }
  }

  return { action: 'prompted', posture, savedTo: scope };
}
