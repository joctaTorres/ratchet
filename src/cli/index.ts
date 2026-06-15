import { Command } from 'commander';
import { createRequire } from 'module';
import ora from 'ora';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import { AI_TOOLS, RATCHET_DIR_NAME } from '../core/config.js';
import { UpdateCommand } from '../core/update.js';
import { ListCommand } from '../core/list.js';
import { ArchiveCommand } from '../core/archive.js';
import { ViewCommand } from '../core/view.js';
import { ValidateCommand } from '../commands/validate.js';
import { templateCommand, type TemplateOptions } from '../commands/template.js';
import {
  statusCommand,
  instructionsCommand,
  applyInstructionsCommand,
  newChangeCommand,
  DEFAULT_SCHEMA,
  type StatusOptions,
  type InstructionsOptions,
  type NewChangeOptions,
} from '../commands/workflow/index.js';
import {
  batchStatusCommand,
  batchConfigCommand,
  batchViewCommand,
  batchListCommand,
  batchReportCommand,
  batchApplyCommand,
  newBatchCommand,
  type BatchStatusOptions,
  type BatchConfigOptions,
  type BatchViewOptions,
  type BatchReportOptions,
  type BatchApplyOptions,
  type NewBatchOptions,
} from '../commands/batch/index.js';
import {
  evalSetCommand,
  evalRunCommand,
  evalRecordCommand,
  evalReportCommand,
  evalBaselineCommand,
  type EvalSetOptions,
  type EvalRunOptions,
  type EvalRecordOptions,
  type EvalReportOptions,
  type EvalBaselineOptions,
} from '../commands/eval/index.js';
import { maybeShowTelemetryNotice, trackCommand, shutdown } from '../telemetry/index.js';

const program = new Command();
const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

/**
 * Get the full command path for nested commands.
 * For example: 'new change' -> 'new:change'
 */
function getCommandPath(command: Command): string {
  const names: string[] = [];
  let current: Command | null = command;

  while (current) {
    const name = current.name();
    // Skip the root 'ratchet' command
    if (name && name !== 'ratchet') {
      names.unshift(name);
    }
    current = current.parent;
  }

  return names.join(':') || 'ratchet';
}

program
  .name('ratchet')
  .description('AI-native system for BDD-flavored spec-driven development')
  .version(version);

// Global options
program.option('--no-color', 'Disable color output');

// Apply global flags and telemetry before any command runs
// Note: preAction receives (thisCommand, actionCommand) where:
// - thisCommand: the command where hook was added (root program)
// - actionCommand: the command actually being executed (subcommand)
program.hook('preAction', async (thisCommand, actionCommand) => {
  const opts = thisCommand.opts();
  if (opts.color === false) {
    process.env.NO_COLOR = '1';
  }

  // Show first-run telemetry notice (if not seen)
  await maybeShowTelemetryNotice();

  // Track command execution (use actionCommand to get the actual subcommand)
  const commandPath = getCommandPath(actionCommand);
  await trackCommand(commandPath, version);
});

// Shutdown telemetry after command completes
program.hook('postAction', async () => {
  await shutdown();
});

const availableToolIds = AI_TOOLS.filter((tool) => tool.skillsDir).map((tool) => tool.value);
const toolsOptionDescription = `Configure AI tools non-interactively. Use "all", "none", or a comma-separated list of: ${availableToolIds.join(', ')}`;

async function hasRepoLocalRatchetProject(projectPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(path.join(projectPath, RATCHET_DIR_NAME));
    return stats.isDirectory();
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      throw error;
    }
    return false;
  }
}

program
  .command('init [path]')
  .description('Initialize Ratchet in your project')
  .option('--tools <tools>', toolsOptionDescription)
  .option('--force', 'Auto-cleanup legacy files without prompting')
  .option('--profile <profile>', 'Override global config profile (core or custom)')
  .action(async (targetPath = '.', options?: { tools?: string; force?: boolean; profile?: string }) => {
    try {
      // Validate that the path is a valid directory
      const resolvedPath = path.resolve(targetPath);

      try {
        const stats = await fs.stat(resolvedPath);
        if (!stats.isDirectory()) {
          throw new Error(`Path "${targetPath}" is not a directory`);
        }
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          // Directory doesn't exist, but we can create it
          console.log(`Directory "${targetPath}" doesn't exist, it will be created.`);
        } else if (error.message && error.message.includes('not a directory')) {
          throw error;
        } else {
          throw new Error(`Cannot access path "${targetPath}": ${error.message}`);
        }
      }

      const { InitCommand } = await import('../core/init.js');
      const initCommand = new InitCommand({
        tools: options?.tools,
        force: options?.force,
        profile: options?.profile,
      });
      await initCommand.execute(targetPath);
    } catch (error) {
      console.log(); // Empty line for spacing
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// Hidden alias: 'experimental' -> 'init' for backwards compatibility
program
  .command('experimental', { hidden: true })
  .description('Alias for init (deprecated)')
  .option('--tool <tool-id>', 'Target AI tool (maps to --tools)')
  .option('--no-interactive', 'Disable interactive prompts')
  .action(async (options?: { tool?: string; noInteractive?: boolean }) => {
    try {
      console.log('Note: "ratchet experimental" is deprecated. Use "ratchet init" instead.');
      const { InitCommand } = await import('../core/init.js');
      const initCommand = new InitCommand({
        tools: options?.tool,
        interactive: options?.noInteractive === true ? false : undefined,
      });
      await initCommand.execute('.');
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('update [path]')
  .description('Update Ratchet instruction files')
  .option('--force', 'Force update even when tools are up to date')
  .action(async (targetPath = '.', options?: { force?: boolean }) => {
    try {
      const resolvedPath = path.resolve(targetPath);
      const updateCommand = new UpdateCommand({ force: options?.force });
      await updateCommand.execute(resolvedPath);
    } catch (error) {
      console.log(); // Empty line for spacing
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List items (changes by default). Use --specs to list specs.')
  .option('--specs', 'List specs instead of changes')
  .option('--changes', 'List changes explicitly (default)')
  .option('--sort <order>', 'Sort order: "recent" (default) or "name"', 'recent')
  .option('--json', 'Output as JSON (for programmatic use)')
  .action(async (options?: { specs?: boolean; changes?: boolean; sort?: string; json?: boolean }) => {
    try {
      const listCommand = new ListCommand();
      const mode: 'changes' | 'specs' = options?.specs ? 'specs' : 'changes';
      const sort = options?.sort === 'name' ? 'name' : 'recent';
      await listCommand.execute('.', mode, { sort, json: options?.json });
    } catch (error) {
      console.log(); // Empty line for spacing
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('view')
  .description('Display an interactive dashboard of specs and changes')
  .action(async () => {
    try {
      const viewCommand = new ViewCommand();
      await viewCommand.execute('.');
    } catch (error) {
      console.log(); // Empty line for spacing
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('archive [change-name]')
  .description('Archive a completed change and update the feature store')
  .option('-y, --yes', 'Skip confirmation prompts')
  .option('--skip-features', 'Skip feature store updates (useful for infrastructure, tooling, or doc-only changes)')
  .option('--no-validate', 'Skip validation (not recommended, requires confirmation)')
  .action(async (changeName?: string, options?: { yes?: boolean; skipFeatures?: boolean; noValidate?: boolean; validate?: boolean }) => {
    try {
      const archiveCommand = new ArchiveCommand();
      await archiveCommand.execute(changeName, options);
    } catch (error) {
      console.log(); // Empty line for spacing
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// Top-level validate command
program
  .command('validate [item-name]')
  .description('Validate changes and specs')
  .option('--all', 'Validate all changes and specs')
  .option('--changes', 'Validate all changes')
  .option('--specs', 'Validate all specs')
  .option('--type <type>', 'Specify item type when ambiguous: change|spec')
  .option('--strict', 'Enable strict validation mode')
  .option('--json', 'Output validation results as JSON')
  .option('--concurrency <n>', 'Max concurrent validations (defaults to env RATCHET_CONCURRENCY or 6)')
  .option('--no-interactive', 'Disable interactive prompts')
  .action(async (itemName?: string, options?: { all?: boolean; changes?: boolean; specs?: boolean; type?: string; strict?: boolean; json?: boolean; noInteractive?: boolean; concurrency?: string }) => {
    try {
      const validateCommand = new ValidateCommand();
      await validateCommand.execute(itemName, options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════
// Workflow Commands (formerly experimental)
// ═══════════════════════════════════════════════════════════

// Status command
program
  .command('status')
  .description('Display artifact completion status for a change')
  .option('--change <id>', 'Change name to show status for')
  .option('--schema <name>', 'Schema override (auto-detected from config.yaml)')
  .option('--json', 'Output as JSON')
  .action(async (options: StatusOptions) => {
    try {
      await statusCommand(options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// Instructions command
program
  .command('instructions [artifact]')
  .description('Output enriched instructions for creating an artifact or applying tasks')
  .option('--change <id>', 'Change name')
  .option('--schema <name>', 'Schema override (auto-detected from config.yaml)')
  .option('--json', 'Output as JSON')
  .action(async (artifactId: string | undefined, options: InstructionsOptions) => {
    try {
      // Special case: "apply" is not an artifact, but a command to get apply instructions
      if (artifactId === 'apply') {
        await applyInstructionsCommand(options);
      } else {
        await instructionsCommand(artifactId, options);
      }
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('template <name>')
  .description('Print a schema template (e.g. "standard") from the canonical templates dir')
  .option('--schema <name>', `Schema to read the template from (default: ${DEFAULT_SCHEMA})`)
  .action(async (name: string, options: TemplateOptions) => {
    try {
      await templateCommand(name, options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// New command group with change subcommand
const newCmd = program.command('new').description('Create new items');

newCmd
  .command('change <name>')
  .description('Create a new change directory')
  .option('--description <text>', 'Description to add to README.md')
  .option('--schema <name>', `Workflow schema to use (default: ${DEFAULT_SCHEMA})`)
  .option('--json', 'Output as JSON')
  .action(async (name: string, options: NewChangeOptions) => {
    try {
      await newChangeCommand(name, options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

newCmd
  .command('batch <name>')
  .description('Scaffold a new batch manifest from the template')
  .option('--json', 'Output as JSON')
  .action(async (name: string, options: NewBatchOptions) => {
    try {
      await newBatchCommand(name, options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════
// Batch Orchestration Commands
// ═══════════════════════════════════════════════════════════

const batchCmd = program
  .command('batch')
  .description('Coordinate related changes across phases (batch orchestration)');

// First-run agent-permissions setup: fires before any `batch *` subcommand the
// first time none is configured. Interactive operators are guided to choose a
// posture; headless/CI runs are NEVER prompted, written to, or blocked (the
// effective posture falls back to the built-in default). Best-effort: any failure
// here must not break the underlying command.
batchCmd.hook('preAction', async () => {
  try {
    const { resolveCurrentPlanningHomeSync } = await import('../core/planning-home.js');
    const { maybeRunFirstRunSetup } = await import('../core/batch/first-run-setup.js');
    const root = resolveCurrentPlanningHomeSync().root;
    await maybeRunFirstRunSetup(root);
  } catch {
    // No planning home / prompt cancellation / any setup error is non-fatal —
    // the command proceeds with the default posture resolved downstream.
  }
});

batchCmd
  .command('new <name>')
  .description('Scaffold a new batch manifest from the template')
  .option('--json', 'Output as JSON')
  .action(async (name: string, options: NewBatchOptions) => {
    try {
      await newBatchCommand(name, options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

batchCmd
  .command('status [name]')
  .description('Show batch status derived live from change state on disk')
  .option('--json', 'Output as JSON')
  .action(async (name: string | undefined, options: BatchStatusOptions) => {
    try {
      await batchStatusCommand(name, options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

batchCmd
  .command('view [name]')
  .description('Rich terminal dashboard for a single batch')
  .option('--json', 'Output as JSON')
  .action(async (name: string | undefined, options: BatchViewOptions) => {
    try {
      await batchViewCommand(name, options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

batchCmd
  .command('list')
  .description('List all batches with change count and aggregate progress')
  .option('--json', 'Output as JSON')
  .action(async (options: BatchViewOptions) => {
    try {
      await batchListCommand(options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

batchCmd
  .command('config [name]')
  .description('Resolve, get, or set batch settings')
  .option('--set <key=value>', 'Set a project-level batch setting')
  .option('--json', 'Output as JSON')
  .action(async (name: string | undefined, options: BatchConfigOptions) => {
    try {
      await batchConfigCommand(name, options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

batchCmd
  .command('report [name]')
  .description('Report progress, raise a blocker, or request input on a step')
  .option('--change <name>', 'Change the report is about')
  .option('--status <message>', 'Record routine progress')
  .option('--blocker <message>', 'Raise a blocker and park the step')
  .option('--needs-input <message>', 'Request input and park the step')
  .option('--complete <message>', 'Signal the step produced its output')
  .option('--answer <message>', 'Record an answer to a parked blocker')
  .option('--reject <message>', 'Reject an awaiting-approval step with feedback')
  .option('--awaiting-approval', 'Mark a completion as awaiting approval (after-propose gate)')
  .option('--json', 'Output as JSON')
  .action(async (name: string | undefined, options: BatchReportOptions) => {
    try {
      await batchReportCommand(name, options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

batchCmd
  .command('apply [name]')
  .description('Advance the batch by one step via the bundled engine')
  .option('--json', 'Output as JSON')
  .action(async (name: string | undefined, options: BatchApplyOptions) => {
    try {
      await batchApplyCommand(name, options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════
// Eval Commands
// ═══════════════════════════════════════════════════════════

const evalCmd = program
  .command('eval')
  .description('Turn .feature files into a scored, baseline-diffed eval suite');

const withScopeFlags = (cmd: Command): Command =>
  cmd
    .option('--changes', 'Include active changes alongside the feature store')
    .option('--change <name>', 'Scope to a single active change')
    .option('--path <dir-or-file>', 'Narrow to a capability directory or file');

withScopeFlags(
  evalCmd
    .command('set')
    .description('Enumerate eval cases (one per Scenario) from .feature files')
    .option('--json', 'Output as JSON')
).action(async (options: EvalSetOptions) => {
  try {
    await evalSetCommand(options);
  } catch (error) {
    console.log();
    ora().fail(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
});

withScopeFlags(
  evalCmd
    .command('run')
    .description('Judge every bound in-scope case through the engine and persist a run')
    .option('--judge <mode>', 'Judge mode: auto | check | agent')
    .option('--json', 'Output as JSON')
).action(async (options: EvalRunOptions) => {
  try {
    await evalRunCommand(options);
  } catch (error) {
    console.log();
    ora().fail(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
});

evalCmd
  .command('record')
  .description('Manually override a case verdict in a persisted run')
  .option('--run <id>', 'Run id to amend')
  .option('--case <id>', 'Case id to override')
  .option('--verdict <verdict>', 'pass | fail | unjudged')
  .option('--evidence <text>', 'Evidence (required for a fail verdict)')
  .option('--json', 'Output as JSON')
  .action(async (options: EvalRecordOptions) => {
    try {
      await evalRecordCommand(options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

evalCmd
  .command('report')
  .description('Scorecard and baseline regression diff for a run')
  .option('--run <id>', 'Run id to report')
  .option('--json', 'Output as JSON')
  .action(async (options: EvalReportOptions) => {
    try {
      await evalReportCommand(options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

evalCmd
  .command('baseline <run-id>')
  .description('Promote a run to the baseline')
  .option('--json', 'Output as JSON')
  .action(async (runId: string, options: EvalBaselineOptions) => {
    try {
      await evalBaselineCommand(runId, options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

export { program };

export function runCli(argv = process.argv): void {
  program.parse(argv);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
