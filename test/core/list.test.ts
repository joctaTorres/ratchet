// Integration tests for the list command remainder.
// Mirrors: .ratchet/changes/core-remainder-tests/features/core-remainder-tests/list.feature
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { ListCommand } from '../../src/core/list.js';

describe('ListCommand', () => {
  let tempDir: string;
  let originalLog: typeof console.log;
  let logOutput: string[] = [];

  beforeEach(async () => {
    // Create temp directory
    tempDir = path.join(os.tmpdir(), `ratchet-list-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    // Mock console.log to capture output
    originalLog = console.log;
    console.log = (...args: any[]) => {
      logOutput.push(args.join(' '));
    };
    logOutput = [];
  });

  afterEach(async () => {
    // Restore console.log
    console.log = originalLog;

    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('execute', () => {
    it('should handle missing .ratchet/changes directory', async () => {
      const listCommand = new ListCommand();
      
      await expect(listCommand.execute(tempDir, 'changes')).rejects.toThrow(
        "No Ratchet changes directory found. Run 'ratchet init' first."
      );
    });

    it('should handle empty changes directory', async () => {
      const changesDir = path.join(tempDir, '.ratchet', 'changes');
      await fs.mkdir(changesDir, { recursive: true });

      const listCommand = new ListCommand();
      await listCommand.execute(tempDir, 'changes');

      expect(logOutput).toEqual(['No active changes found.']);
    });

    it('should exclude archive directory', async () => {
      const changesDir = path.join(tempDir, '.ratchet', 'changes');
      await fs.mkdir(path.join(changesDir, 'archive'), { recursive: true });
      await fs.mkdir(path.join(changesDir, 'my-change'), { recursive: true });
      
      // Create plan.md with some tasks
      await fs.writeFile(
        path.join(changesDir, 'my-change', 'plan.md'),
        '- [x] Task 1\n- [ ] Task 2\n'
      );

      const listCommand = new ListCommand();
      await listCommand.execute(tempDir, 'changes');

      expect(logOutput).toContain('Changes:');
      expect(logOutput.some(line => line.includes('my-change'))).toBe(true);
      expect(logOutput.some(line => line.includes('archive'))).toBe(false);
    });

    it('should count tasks correctly', async () => {
      const changesDir = path.join(tempDir, '.ratchet', 'changes');
      await fs.mkdir(path.join(changesDir, 'test-change'), { recursive: true });
      
      await fs.writeFile(
        path.join(changesDir, 'test-change', 'plan.md'),
        `# Tasks
- [x] Completed task 1
- [x] Completed task 2
- [ ] Incomplete task 1
- [ ] Incomplete task 2
- [ ] Incomplete task 3
Regular text that should be ignored
`
      );

      const listCommand = new ListCommand();
      await listCommand.execute(tempDir, 'changes');

      expect(logOutput.some(line => line.includes('2/5 tasks'))).toBe(true);
    });

    it('should show complete status for fully completed changes', async () => {
      const changesDir = path.join(tempDir, '.ratchet', 'changes');
      await fs.mkdir(path.join(changesDir, 'completed-change'), { recursive: true });
      
      await fs.writeFile(
        path.join(changesDir, 'completed-change', 'plan.md'),
        '- [x] Task 1\n- [x] Task 2\n- [x] Task 3\n'
      );

      const listCommand = new ListCommand();
      await listCommand.execute(tempDir, 'changes');

      expect(logOutput.some(line => line.includes('✓ Complete'))).toBe(true);
    });

    it('should handle changes without plan.md', async () => {
      const changesDir = path.join(tempDir, '.ratchet', 'changes');
      await fs.mkdir(path.join(changesDir, 'no-tasks'), { recursive: true });

      const listCommand = new ListCommand();
      await listCommand.execute(tempDir, 'changes');

      expect(logOutput.some(line => line.includes('no-tasks') && line.includes('No tasks'))).toBe(true);
    });

    it('should sort changes alphabetically when sort=name', async () => {
      const changesDir = path.join(tempDir, '.ratchet', 'changes');
      await fs.mkdir(path.join(changesDir, 'zebra'), { recursive: true });
      await fs.mkdir(path.join(changesDir, 'alpha'), { recursive: true });
      await fs.mkdir(path.join(changesDir, 'middle'), { recursive: true });

      const listCommand = new ListCommand();
      await listCommand.execute(tempDir, 'changes', { sort: 'name' });

      const changeLines = logOutput.filter(line =>
        line.includes('alpha') || line.includes('middle') || line.includes('zebra')
      );

      expect(changeLines[0]).toContain('alpha');
      expect(changeLines[1]).toContain('middle');
      expect(changeLines[2]).toContain('zebra');
    });

    it('should handle multiple changes with various states', async () => {
      const changesDir = path.join(tempDir, '.ratchet', 'changes');
      
      // Complete change
      await fs.mkdir(path.join(changesDir, 'completed'), { recursive: true });
      await fs.writeFile(
        path.join(changesDir, 'completed', 'plan.md'),
        '- [x] Task 1\n- [x] Task 2\n'
      );

      // Partial change
      await fs.mkdir(path.join(changesDir, 'partial'), { recursive: true });
      await fs.writeFile(
        path.join(changesDir, 'partial', 'plan.md'),
        '- [x] Done\n- [ ] Not done\n- [ ] Also not done\n'
      );

      // No tasks
      await fs.mkdir(path.join(changesDir, 'no-tasks'), { recursive: true });

      const listCommand = new ListCommand();
      await listCommand.execute(tempDir);

      expect(logOutput).toContain('Changes:');
      expect(logOutput.some(line => line.includes('completed') && line.includes('✓ Complete'))).toBe(true);
      expect(logOutput.some(line => line.includes('partial') && line.includes('1/3 tasks'))).toBe(true);
      expect(logOutput.some(line => line.includes('no-tasks') && line.includes('No tasks'))).toBe(true);
    });
  });

  describe('specs mode (feature store)', () => {
    it('reports no features when the store is missing', async () => {
      const listCommand = new ListCommand();
      await listCommand.execute(tempDir, 'specs');
      expect(logOutput).toContain('No features found.');
    });

    it('lists feature counts grouped by capability', async () => {
      const featuresDir = path.join(tempDir, '.ratchet', 'features');
      await fs.mkdir(path.join(featuresDir, 'user-auth'), { recursive: true });
      await fs.mkdir(path.join(featuresDir, 'billing'), { recursive: true });
      await fs.writeFile(path.join(featuresDir, 'user-auth', 'login.feature'), 'Feature: Login\n');
      await fs.writeFile(path.join(featuresDir, 'user-auth', 'logout.feature'), 'Feature: Logout\n');
      await fs.writeFile(path.join(featuresDir, 'billing', 'invoice.feature'), 'Feature: Invoice\n');

      const listCommand = new ListCommand();
      await listCommand.execute(tempDir, 'specs');

      expect(logOutput).toContain('Features:');
      expect(logOutput.some(l => l.includes('user-auth') && l.includes('features 2'))).toBe(true);
      expect(logOutput.some(l => l.includes('billing') && l.includes('features 1'))).toBe(true);
    });

    // Scenario: specs mode lists features grouped by capability
    it('lists each capability once with its feature count across several folders', async () => {
      const featuresDir = path.join(tempDir, '.ratchet', 'features');
      await fs.mkdir(path.join(featuresDir, 'core'), { recursive: true });
      await fs.mkdir(path.join(featuresDir, 'commands'), { recursive: true });
      await fs.mkdir(path.join(featuresDir, 'ui'), { recursive: true });
      await fs.writeFile(path.join(featuresDir, 'core', 'list.feature'), 'Feature: List\n');
      await fs.writeFile(path.join(featuresDir, 'core', 'init.feature'), 'Feature: Init\n');
      await fs.writeFile(path.join(featuresDir, 'core', 'apply.feature'), 'Feature: Apply\n');
      await fs.writeFile(path.join(featuresDir, 'commands', 'validate.feature'), 'Feature: Validate\n');
      await fs.writeFile(path.join(featuresDir, 'commands', 'archive.feature'), 'Feature: Archive\n');
      await fs.writeFile(path.join(featuresDir, 'ui', 'welcome.feature'), 'Feature: Welcome\n');

      const listCommand = new ListCommand();
      await listCommand.execute(tempDir, 'specs');

      expect(logOutput).toContain('Features:');
      // Each capability listed exactly once with its feature count.
      const coreLines = logOutput.filter(l => l.includes('core') && l.includes('features'));
      const commandsLines = logOutput.filter(l => l.includes('commands') && l.includes('features'));
      const uiLines = logOutput.filter(l => l.includes('ui') && l.includes('features'));
      expect(coreLines).toHaveLength(1);
      expect(commandsLines).toHaveLength(1);
      expect(uiLines).toHaveLength(1);
      expect(coreLines[0]).toContain('features 3');
      expect(commandsLines[0]).toContain('features 2');
      expect(uiLines[0]).toContain('features 1');
    });

    // Scenario: specs mode reports nothing to show when the feature store is empty
    it('reports no features when the dir exists but holds no .feature files', async () => {
      const featuresDir = path.join(tempDir, '.ratchet', 'features');
      await fs.mkdir(path.join(featuresDir, 'core'), { recursive: true });
      // Non-feature files must not be counted.
      await fs.writeFile(path.join(featuresDir, 'README.md'), '# nothing here\n');
      await fs.writeFile(path.join(featuresDir, 'core', 'notes.txt'), 'not a feature\n');

      const listCommand = new ListCommand();
      await listCommand.execute(tempDir, 'specs');

      expect(logOutput).toContain('No features found.');
      expect(logOutput).not.toContain('Features:');
    });
  });

  describe('changes mode JSON output', () => {
    // Scenario: changes mode emits machine-readable JSON when asked
    it('prints a JSON document carrying name, task counts, and status for an in-progress change', async () => {
      const changesDir = path.join(tempDir, '.ratchet', 'changes');
      await fs.mkdir(path.join(changesDir, 'in-progress-change'), { recursive: true });
      await fs.writeFile(
        path.join(changesDir, 'in-progress-change', 'plan.md'),
        '- [x] Task 1\n- [x] Task 2\n- [ ] Task 3\n- [ ] Task 4\n'
      );

      const listCommand = new ListCommand();
      await listCommand.execute(tempDir, 'changes', { json: true });

      // Output is a single JSON document.
      expect(logOutput).toHaveLength(1);
      const parsed = JSON.parse(logOutput[0]);
      expect(parsed.changes).toHaveLength(1);
      const change = parsed.changes[0];
      expect(change.name).toBe('in-progress-change');
      expect(change.completedTasks).toBe(2);
      expect(change.totalTasks).toBe(4);
      expect(change.status).toBe('in-progress');
      expect(typeof change.lastModified).toBe('string');
    });

    it('marks a fully completed change as complete and a task-less change as no-tasks', async () => {
      const changesDir = path.join(tempDir, '.ratchet', 'changes');
      await fs.mkdir(path.join(changesDir, 'done'), { recursive: true });
      await fs.writeFile(
        path.join(changesDir, 'done', 'plan.md'),
        '- [x] Task 1\n- [x] Task 2\n'
      );
      await fs.mkdir(path.join(changesDir, 'empty'), { recursive: true });

      const listCommand = new ListCommand();
      await listCommand.execute(tempDir, 'changes', { json: true });

      const parsed = JSON.parse(logOutput[0]);
      const byName = Object.fromEntries(parsed.changes.map((c: any) => [c.name, c]));
      expect(byName['done'].status).toBe('complete');
      expect(byName['done'].completedTasks).toBe(2);
      expect(byName['done'].totalTasks).toBe(2);
      expect(byName['empty'].status).toBe('no-tasks');
      expect(byName['empty'].totalTasks).toBe(0);
    });

    // Scenario: changes mode reports an empty changes set
    it('emits an empty changes array as JSON when there are no active changes', async () => {
      const changesDir = path.join(tempDir, '.ratchet', 'changes');
      await fs.mkdir(changesDir, { recursive: true });

      const listCommand = new ListCommand();
      await listCommand.execute(tempDir, 'changes', { json: true });

      expect(logOutput).toHaveLength(1);
      expect(JSON.parse(logOutput[0])).toEqual({ changes: [] });
    });

    // Scenario: changes mode can sort alphabetically by name (JSON ordering)
    it('orders changes alphabetically by name when the name sort option is given', async () => {
      const changesDir = path.join(tempDir, '.ratchet', 'changes');
      await fs.mkdir(path.join(changesDir, 'gamma'), { recursive: true });
      await fs.mkdir(path.join(changesDir, 'alpha'), { recursive: true });
      await fs.mkdir(path.join(changesDir, 'beta'), { recursive: true });

      const listCommand = new ListCommand();
      await listCommand.execute(tempDir, 'changes', { sort: 'name', json: true });

      const parsed = JSON.parse(logOutput[0]);
      expect(parsed.changes.map((c: any) => c.name)).toEqual(['alpha', 'beta', 'gamma']);
    });
  });
});