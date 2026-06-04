import * as fs from 'fs';
import { RATCHET_DIR_NAME } from './config.js';
import * as path from 'path';
import chalk from 'chalk';
import { getTaskProgressForChange, formatTaskStatus } from '../utils/task-progress.js';
import fg from 'fast-glob';

export class ViewCommand {
  async execute(targetPath: string = '.'): Promise<void> {
    const ratchetDir = path.join(targetPath, RATCHET_DIR_NAME);
    
    if (!fs.existsSync(ratchetDir)) {
      console.error(chalk.red('No ratchet directory found'));
      process.exit(1);
    }

    console.log(chalk.bold('\nRatchet Dashboard\n'));
    console.log('═'.repeat(60));

    // Get changes and feature-store data
    const changesData = await this.getChangesData(ratchetDir);
    const specsData = await this.getFeaturesData(ratchetDir);

    // Display summary metrics
    this.displaySummary(changesData, specsData);

    // Display draft changes
    if (changesData.draft.length > 0) {
      console.log(chalk.bold.gray('\nDraft Changes'));
      console.log('─'.repeat(60));
      changesData.draft.forEach((change) => {
        console.log(`  ${chalk.gray('○')} ${change.name}`);
      });
    }

    // Display active changes
    if (changesData.active.length > 0) {
      console.log(chalk.bold.cyan('\nActive Changes'));
      console.log('─'.repeat(60));
      changesData.active.forEach((change) => {
        const progressBar = this.createProgressBar(change.progress.completed, change.progress.total);
        const percentage =
          change.progress.total > 0
            ? Math.round((change.progress.completed / change.progress.total) * 100)
            : 0;

        console.log(
          `  ${chalk.yellow('◉')} ${chalk.bold(change.name.padEnd(30))} ${progressBar} ${chalk.dim(`${percentage}%`)}`
        );
      });
    }

    // Display completed changes
    if (changesData.completed.length > 0) {
      console.log(chalk.bold.green('\nCompleted Changes'));
      console.log('─'.repeat(60));
      changesData.completed.forEach((change) => {
        console.log(`  ${chalk.green('✓')} ${change.name}`);
      });
    }

    // Display feature store (grouped by capability)
    if (specsData.length > 0) {
      console.log(chalk.bold.blue('\nFeatures'));
      console.log('─'.repeat(60));

      // Sort capabilities by feature count (descending)
      specsData.sort((a, b) => b.requirementCount - a.requirementCount);

      specsData.forEach(spec => {
        const label = spec.requirementCount === 1 ? 'feature' : 'features';
        console.log(
          `  ${chalk.blue('▪')} ${chalk.bold(spec.name.padEnd(30))} ${chalk.dim(`${spec.requirementCount} ${label}`)}`
        );
      });
    }

    console.log('\n' + '═'.repeat(60));
    console.log(chalk.dim(`\nUse ${chalk.white('ratchet list --changes')} or ${chalk.white('ratchet list --specs')} for detailed views`));
  }

  private async getChangesData(ratchetDir: string): Promise<{
    draft: Array<{ name: string }>;
    active: Array<{ name: string; progress: { total: number; completed: number } }>;
    completed: Array<{ name: string }>;
  }> {
    const changesDir = path.join(ratchetDir, 'changes');

    if (!fs.existsSync(changesDir)) {
      return { draft: [], active: [], completed: [] };
    }

    const draft: Array<{ name: string }> = [];
    const active: Array<{ name: string; progress: { total: number; completed: number } }> = [];
    const completed: Array<{ name: string }> = [];

    const entries = fs.readdirSync(changesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== 'archive') {
        const progress = await getTaskProgressForChange(changesDir, entry.name);

        if (progress.total === 0) {
          // No tasks defined yet - still in planning/draft phase
          draft.push({ name: entry.name });
        } else if (progress.completed === progress.total) {
          // All tasks complete
          completed.push({ name: entry.name });
        } else {
          // Has tasks but not all complete
          active.push({ name: entry.name, progress });
        }
      }
    }

    // Sort all categories by name for deterministic ordering
    draft.sort((a, b) => a.name.localeCompare(b.name));

    // Sort active changes by completion percentage (ascending) and then by name
    active.sort((a, b) => {
      const percentageA = a.progress.total > 0 ? a.progress.completed / a.progress.total : 0;
      const percentageB = b.progress.total > 0 ? b.progress.completed / b.progress.total : 0;

      if (percentageA < percentageB) return -1;
      if (percentageA > percentageB) return 1;
      return a.name.localeCompare(b.name);
    });
    completed.sort((a, b) => a.name.localeCompare(b.name));

    return { draft, active, completed };
  }

  private async getFeaturesData(ratchetDir: string): Promise<Array<{ name: string; requirementCount: number }>> {
    const featuresDir = path.join(ratchetDir, 'features');

    if (!fs.existsSync(featuresDir)) {
      return [];
    }

    // Count `.feature` files grouped by capability (first path segment).
    let rels: string[] = [];
    try {
      rels = await fg('**/*.feature', { cwd: featuresDir, onlyFiles: true });
    } catch {
      rels = [];
    }

    const counts = new Map<string, number>();
    for (const rel of rels) {
      const capability = rel.split('/')[0] || '(root)';
      counts.set(capability, (counts.get(capability) ?? 0) + 1);
    }

    return [...counts.entries()].map(([name, requirementCount]) => ({ name, requirementCount }));
  }

  private displaySummary(
    changesData: { draft: any[]; active: any[]; completed: any[] },
    specsData: any[]
  ): void {
    const totalChanges =
      changesData.draft.length + changesData.active.length + changesData.completed.length;
    const totalSpecs = specsData.length;
    const totalRequirements = specsData.reduce((sum, spec) => sum + spec.requirementCount, 0);

    // Calculate total task progress
    let totalTasks = 0;
    let completedTasks = 0;

    changesData.active.forEach((change) => {
      totalTasks += change.progress.total;
      completedTasks += change.progress.completed;
    });

    changesData.completed.forEach(() => {
      // Completed changes count as 100% done (we don't know exact task count)
      // This is a simplification
    });

    console.log(chalk.bold('Summary:'));
    console.log(
      `  ${chalk.cyan('●')} Features: ${chalk.bold(totalSpecs)} capabilities, ${chalk.bold(totalRequirements)} features`
    );
    if (changesData.draft.length > 0) {
      console.log(`  ${chalk.gray('●')} Draft Changes: ${chalk.bold(changesData.draft.length)}`);
    }
    console.log(
      `  ${chalk.yellow('●')} Active Changes: ${chalk.bold(changesData.active.length)} in progress`
    );
    console.log(`  ${chalk.green('●')} Completed Changes: ${chalk.bold(changesData.completed.length)}`);

    if (totalTasks > 0) {
      const overallProgress = Math.round((completedTasks / totalTasks) * 100);
      console.log(
        `  ${chalk.magenta('●')} Task Progress: ${chalk.bold(`${completedTasks}/${totalTasks}`)} (${overallProgress}% complete)`
      );
    }
  }

  private createProgressBar(completed: number, total: number, width: number = 20): string {
    if (total === 0) return chalk.dim('─'.repeat(width));
    
    const percentage = completed / total;
    const filled = Math.round(percentage * width);
    const empty = width - filled;
    
    const filledBar = chalk.green('█'.repeat(filled));
    const emptyBar = chalk.dim('░'.repeat(empty));
    
    return `[${filledBar}${emptyBar}]`;
  }
}