import { promises as fs } from 'fs';
import { RATCHET_DIR_NAME } from './config.js';
import path from 'path';
import { getTaskProgressForChange, formatTaskStatus } from '../utils/task-progress.js';
import { Validator } from './validation/validator.js';
import chalk from 'chalk';
import { applyFeatures, materializeStandardLinks } from './features-apply.js';
import { readChangeMetadata } from '../utils/change-metadata.js';

/**
 * Recursively copy a directory. Used when fs.rename fails (e.g. EPERM on Windows).
 */
async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Move a directory from src to dest. On Windows, fs.rename() often fails with
 * EPERM when the directory is non-empty or another process has it open (IDE,
 * file watcher, antivirus). Fall back to copy-then-remove when rename fails
 * with EPERM or EXDEV.
 */
async function moveDirectory(src: string, dest: string): Promise<void> {
  try {
    await fs.rename(src, dest);
  } catch (err: any) {
    const code = err?.code;
    if (code === 'EPERM' || code === 'EXDEV') {
      await copyDirRecursive(src, dest);
      await fs.rm(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

export class ArchiveCommand {
  async execute(
    changeName?: string,
    options: { yes?: boolean; skipFeatures?: boolean; noValidate?: boolean; validate?: boolean } = {}
  ): Promise<void> {
    const targetPath = '.';
    const changesDir = path.join(targetPath, RATCHET_DIR_NAME, 'changes');
    const archiveDir = path.join(changesDir, 'archive');

    // Check if changes directory exists
    try {
      await fs.access(changesDir);
    } catch {
      throw new Error("No Ratchet changes directory found. Run 'ratchet init' first.");
    }

    // Get change name interactively if not provided
    if (!changeName) {
      const selectedChange = await this.selectChange(changesDir);
      if (!selectedChange) {
        console.log('No change selected. Aborting.');
        return;
      }
      changeName = selectedChange;
    }

    const changeDir = path.join(changesDir, changeName);

    // Verify change exists
    try {
      const stat = await fs.stat(changeDir);
      if (!stat.isDirectory()) {
        throw new Error(`Change '${changeName}' not found.`);
      }
    } catch {
      throw new Error(`Change '${changeName}' not found.`);
    }

    const skipValidation = options.validate === false || options.noValidate === true;

    // Validate plan and features before archiving
    if (!skipValidation) {
      const validator = new Validator();
      let hasValidationErrors = false;

      // Validate plan.md (informative only; does not block archive)
      const planFile = path.join(changeDir, 'plan.md');
      try {
        await fs.access(planFile);
        const planReport = await validator.validatePlan(planFile);
        if (!planReport.valid || planReport.issues.length > 0) {
          if (planReport.issues.length > 0) {
            console.log(chalk.yellow(`\nPlan warnings in plan.md (non-blocking):`));
            for (const issue of planReport.issues) {
              const symbol = issue.level === 'ERROR' ? '⚠' : issue.level === 'WARNING' ? '⚠' : 'ℹ';
              console.log(chalk.yellow(`  ${symbol} ${issue.message}`));
            }
          }
        }
      } catch {
        // plan.md doesn't exist, skip plan validation
      }

      // Validate feature files under the change directory if present (blocking on ERROR)
      const changeFeaturesDir = path.join(changeDir, 'features');
      let hasFeatureDir = false;
      try {
        const stat = await fs.stat(changeFeaturesDir);
        hasFeatureDir = stat.isDirectory();
      } catch {
        hasFeatureDir = false;
      }
      if (hasFeatureDir) {
        const featureReport = await validator.validateFeatures(changeFeaturesDir);
        if (!featureReport.valid) {
          hasValidationErrors = true;
          console.log(chalk.red(`\nValidation errors in change features:`));
          for (const issue of featureReport.issues) {
            if (issue.level === 'ERROR') {
              console.log(chalk.red(`  ✗ ${issue.message}`));
            } else if (issue.level === 'WARNING') {
              console.log(chalk.yellow(`  ⚠ ${issue.message}`));
            }
          }
        }
      }

      // Validate the standards link (duplicate tags, unknown references) — blocking on ERROR.
      const standardsReport = validator.validateStandards(changeDir);
      if (!standardsReport.valid) {
        hasValidationErrors = true;
        console.log(chalk.red(`\nValidation errors in standards links:`));
        for (const issue of standardsReport.issues) {
          if (issue.level === 'ERROR') {
            console.log(chalk.red(`  ✗ ${issue.message}`));
          } else if (issue.level === 'WARNING') {
            console.log(chalk.yellow(`  ⚠ ${issue.message}`));
          }
        }
      }

      if (hasValidationErrors) {
        console.log(chalk.red('\nValidation failed. Please fix the errors before archiving.'));
        console.log(chalk.yellow('To skip validation (not recommended), use --no-validate flag.'));
        return;
      }
    } else {
      // Log warning when validation is skipped
      const timestamp = new Date().toISOString();
      
      if (!options.yes) {
        const { confirm } = await import('@inquirer/prompts');
        const proceed = await confirm({
          message: chalk.yellow('⚠️  WARNING: Skipping validation may archive invalid features. Continue? (y/N)'),
          default: false
        });
        if (!proceed) {
          console.log('Archive cancelled.');
          return;
        }
      } else {
        console.log(chalk.yellow(`\n⚠️  WARNING: Skipping validation may archive invalid features.`));
      }
      
      console.log(chalk.yellow(`[${timestamp}] Validation skipped for change: ${changeName}`));
      console.log(chalk.yellow(`Affected files: ${changeDir}`));
    }

    // Show progress and check for incomplete tasks
    const progress = await getTaskProgressForChange(changesDir, changeName);
    const status = formatTaskStatus(progress);
    console.log(`Task status: ${status}`);

    const incompleteTasks = Math.max(progress.total - progress.completed, 0);
    if (incompleteTasks > 0) {
      if (!options.yes) {
        const { confirm } = await import('@inquirer/prompts');
        const proceed = await confirm({
          message: `Warning: ${incompleteTasks} incomplete task(s) found. Continue?`,
          default: false
        });
        if (!proceed) {
          console.log('Archive cancelled.');
          return;
        }
      } else {
        console.log(`Warning: ${incompleteTasks} incomplete task(s) found. Continuing due to --yes flag.`);
      }
    }

    // Apply feature files to the permanent store unless skipFeatures flag is set
    if (options.skipFeatures) {
      console.log('Skipping feature store update (--skip-features flag provided).');
    } else {
      let shouldUpdateFeatures = true;
      if (!options.yes) {
        const { confirm } = await import('@inquirer/prompts');
        shouldUpdateFeatures = await confirm({
          message: 'Proceed with feature store update?',
          default: true
        });
        if (!shouldUpdateFeatures) {
          console.log('Skipping feature store update. Proceeding with archive.');
        }
      }

      if (shouldUpdateFeatures) {
        const result = await applyFeatures(targetPath, changeName, {});
        if (result.noChanges) {
          console.log('\nNo feature changes to apply.');
        } else {
          console.log('\nFeature store updates:');
          for (const cap of result.byCapability) {
            const parts: string[] = [];
            if (cap.added) parts.push(`+${cap.added} added`);
            if (cap.overwritten) parts.push(`~${cap.overwritten} overwritten`);
            if (cap.deleted) parts.push(`-${cap.deleted} deleted`);
            if (cap.unchanged) parts.push(`${cap.unchanged} unchanged`);
            console.log(`  ${cap.capability}: ${parts.join(', ')}`);
          }
          console.log(
            `Totals: +${result.added} added, ~${result.overwritten} overwritten, -${result.deleted} deleted`
          );
          console.log('Feature store updated successfully.');
        }

        // Materialize the change's standard links into the store: forward links
        // into the per-capability sidecars and the regenerated reverse blocks on
        // the standards. A change that declares no standards is a no-op here.
        const tags = this.readDeclaredStandards(changeDir);
        if (tags.length > 0) {
          await materializeStandardLinks(targetPath, changeName, tags);
          console.log(`Standard links materialized for: ${tags.join(', ')}`);
        }
      }
    }

    // Create archive directory with date prefix
    const archiveName = `${this.getArchiveDate()}-${changeName}`;
    const archivePath = path.join(archiveDir, archiveName);

    // Check if archive already exists
    try {
      await fs.access(archivePath);
      throw new Error(`Archive '${archiveName}' already exists.`);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    // Create archive directory if needed
    await fs.mkdir(archiveDir, { recursive: true });

    // Move change to archive (uses copy+remove on EPERM/EXDEV, e.g. Windows)
    await moveDirectory(changeDir, archivePath);

    console.log(`Change '${changeName}' archived as '${archiveName}'.`);
  }

  private async selectChange(changesDir: string): Promise<string | null> {
    const { select } = await import('@inquirer/prompts');
    // Get all directories in changes (excluding archive)
    const entries = await fs.readdir(changesDir, { withFileTypes: true });
    const changeDirs = entries
      .filter(entry => entry.isDirectory() && entry.name !== 'archive')
      .map(entry => entry.name)
      .sort();

    if (changeDirs.length === 0) {
      console.log('No active changes found.');
      return null;
    }

    // Build choices with progress inline to avoid duplicate lists
    let choices: Array<{ name: string; value: string }> = changeDirs.map(name => ({ name, value: name }));
    try {
      const progressList: Array<{ id: string; status: string }> = [];
      for (const id of changeDirs) {
        const progress = await getTaskProgressForChange(changesDir, id);
        const status = formatTaskStatus(progress);
        progressList.push({ id, status });
      }
      const nameWidth = Math.max(...progressList.map(p => p.id.length));
      choices = progressList.map(p => ({
        name: `${p.id.padEnd(nameWidth)}     ${p.status}`,
        value: p.id
      }));
    } catch {
      // If anything fails, fall back to simple names
      choices = changeDirs.map(name => ({ name, value: name }));
    }

    try {
      const answer = await select({
        message: 'Select a change to archive',
        choices
      });
      return answer;
    } catch (error) {
      // User cancelled (Ctrl+C)
      return null;
    }
  }

  private getArchiveDate(): string {
    // Returns date in YYYY-MM-DD format
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Read the change's declared standard tags from its `.ratchet.yaml`. Returns
   * an empty list when none are declared or the metadata cannot be read, so a
   * standards-less change cleanly materializes nothing.
   */
  private readDeclaredStandards(changeDir: string): string[] {
    try {
      const metadata = readChangeMetadata(changeDir);
      return metadata?.standards ?? [];
    } catch {
      return [];
    }
  }
}
