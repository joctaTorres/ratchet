// Mirrors .ratchet/changes/scenario-loss-guard/features/feature-store/scenario-loss-guard.feature
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  applyFeatures,
  diffScenarioNames,
} from '../../src/core/features-apply.js';
import { ArchiveCommand } from '../../src/core/archive.js';
import { RATCHET_DIR_NAME } from '../../src/core/config.js';

async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf-8');
}

const STORE_FEATURE = `Feature: Login
  Scenario: Successful login
    Given a registered user
    When they submit valid credentials
    Then they are logged in

  Scenario: Locked account
    Given a locked account
    When they submit valid credentials
    Then they are told the account is locked
`;

const VALID_PLAN = `# add-login

## Why
We need authenticated access so that only registered users can reach the app.

## What Changes
Add a login form and a session-backed auth check.

## Design
Session cookie issued on successful credential check.

## Tasks
- [x] 1.1 Implement login form
`;

describe('scenario-loss guard (features-apply)', () => {
  let root: string;
  let changeDir: string;
  let storeDir: string;
  const changeName = 'add-login';

  const storePath = (rel: string) => path.join(storeDir, ...rel.split('/'));
  const changePath = (rel: string) =>
    path.join(changeDir, 'features', ...rel.split('/'));

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-scenario-guard-'));
    changeDir = path.join(root, RATCHET_DIR_NAME, 'changes', changeName);
    storeDir = path.join(root, RATCHET_DIR_NAME, 'features');
    await fs.mkdir(changeDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('diffScenarioNames', () => {
    it('returns store names missing from the change version, in store order', () => {
      const store = `Feature: F
  Scenario: Alpha
  Scenario: Beta
  Scenario: Gamma
`;
      const change = `Feature: F
  Scenario: Beta
`;
      expect(diffScenarioNames(store, change)).toEqual(['Alpha', 'Gamma']);
    });

    it('compares Scenario Outline names too', () => {
      const store = `Feature: Billing
  Scenario Outline: Totals with tax
    Given a cart totaling <amount>
    Then the tax is <tax>

    Examples:
      | amount | tax |
      | 10     | 1   |
`;
      const change = `Feature: Billing
  Scenario: Plain total
`;
      expect(diffScenarioNames(store, change)).toEqual(['Totals with tax']);
    });

    it('compares Scenario Template names too', () => {
      const store = `Feature: Billing
  Scenario Template: Totals with tax
    Given a cart totaling <amount>
    Then the tax is <tax>
`;
      const change = `Feature: Billing
  Scenario: Plain total
`;
      expect(diffScenarioNames(store, change)).toEqual(['Totals with tax']);
    });

    it('ignores commented-out Scenario lines', () => {
      const store = `Feature: F
  # Scenario: Ghost
  Scenario: Real one
`;
      const change = `Feature: F
  Scenario: Real one
`;
      expect(diffScenarioNames(store, change)).toEqual([]);
    });

    it('does not treat tag lines above a scenario as part of its name', () => {
      const store = `Feature: F
  @smoke @wip
  Scenario: Real name
`;
      const change = `Feature: F
  Scenario: Real name
`;
      expect(diffScenarioNames(store, change)).toEqual([]);
    });

    it('reports a repeated store name once (duplicate-free lost list)', () => {
      const store = `Feature: F
  Scenario: Duplicate name
  Scenario: Duplicate name
  Scenario: Kept
`;
      const change = `Feature: F
  Scenario: Kept
`;
      expect(diffScenarioNames(store, change)).toEqual(['Duplicate name']);
    });

    it('reports a rename as a loss of the old name', () => {
      const store = `Feature: F
  Scenario: Successful login
`;
      const change = `Feature: F
  Scenario: Login works
`;
      expect(diffScenarioNames(store, change)).toEqual(['Successful login']);
    });
  });

  describe('applyFeatures', () => {
    it('refuses an overwrite that drops a store scenario, listing the file and lost name, and leaves the store untouched', async () => {
      await writeFile(storePath('user-auth/login.feature'), STORE_FEATURE);
      const changeFeature = STORE_FEATURE.replace(
        /  Scenario: Locked account[\s\S]*$/,
        ''
      );
      await writeFile(changePath('user-auth/login.feature'), changeFeature);

      await expect(applyFeatures(root, changeName, {})).rejects.toThrow(
        /user-auth\/login\.feature[\s\S]*Locked account/
      );

      // Store is byte-for-byte untouched.
      expect(await fs.readFile(storePath('user-auth/login.feature'), 'utf-8')).toBe(
        STORE_FEATURE
      );
    });

    it('names --accept-removed-scenarios and the features/.deleted tombstone in the refusal', async () => {
      await writeFile(storePath('user-auth/login.feature'), STORE_FEATURE);
      await writeFile(
        changePath('user-auth/login.feature'),
        STORE_FEATURE.replace(/  Scenario: Locked account[\s\S]*$/, '')
      );

      await expect(applyFeatures(root, changeName, {})).rejects.toThrow(
        /--accept-removed-scenarios/
      );
      await expect(applyFeatures(root, changeName, {})).rejects.toThrow(
        /features\/\.deleted/
      );
    });

    it('refuses when the change drops a Scenario Outline', async () => {
      const storeOutline = `Feature: Billing
  Scenario Outline: Totals with tax
    Given a cart totaling <amount>
    Then the tax is <tax>

    Examples:
      | amount | tax |
      | 10     | 1   |
`;
      await writeFile(storePath('billing/invoice.feature'), storeOutline);
      await writeFile(
        changePath('billing/invoice.feature'),
        'Feature: Billing\n  Scenario: Plain total\n'
      );

      await expect(applyFeatures(root, changeName, {})).rejects.toThrow(
        /Totals with tax/
      );
    });

    it('reports a renamed scenario as a loss of the old name', async () => {
      await writeFile(
        storePath('user-auth/login.feature'),
        'Feature: Login\n  Scenario: Successful login\n'
      );
      await writeFile(
        changePath('user-auth/login.feature'),
        'Feature: Login\n  Scenario: Login works\n'
      );

      await expect(applyFeatures(root, changeName, {})).rejects.toThrow(
        /Successful login/
      );
    });

    it('lists every lost scenario across every overwritten file, grouped by file, and leaves the store untouched', async () => {
      const storeBilling = `Feature: Billing
  Scenario: Issue invoice
  Scenario: Void invoice
`;
      await writeFile(storePath('user-auth/login.feature'), STORE_FEATURE);
      await writeFile(storePath('billing/invoice.feature'), storeBilling);
      // Change drops "Locked account" from login and "Void invoice" from billing.
      await writeFile(
        changePath('user-auth/login.feature'),
        STORE_FEATURE.replace(/  Scenario: Locked account[\s\S]*$/, '')
      );
      await writeFile(
        changePath('billing/invoice.feature'),
        'Feature: Billing\n  Scenario: Issue invoice\n'
      );

      const error = await applyFeatures(root, changeName, {}).catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain('user-auth/login.feature');
      expect(message).toContain('Locked account');
      expect(message).toContain('billing/invoice.feature');
      expect(message).toContain('Void invoice');

      // No file in the store is modified.
      expect(await fs.readFile(storePath('user-auth/login.feature'), 'utf-8')).toBe(
        STORE_FEATURE
      );
      expect(await fs.readFile(storePath('billing/invoice.feature'), 'utf-8')).toBe(
        storeBilling
      );
    });

    it('applies a superset overwrite that keeps every store scenario, classified as overwritten', async () => {
      const storeOnly = `Feature: Login
  Scenario: Successful login
    Given a registered user
    When they submit valid credentials
    Then they are logged in
`;
      const superset = `${storeOnly}
  Scenario: Password reset
    Given a registered user
    When they request a password reset
    Then a reset email is sent
`;
      await writeFile(storePath('user-auth/login.feature'), storeOnly);
      await writeFile(changePath('user-auth/login.feature'), superset);

      const result = await applyFeatures(root, changeName, {});

      expect(result.overwritten).toBe(1);
      expect(result.lostScenarios).toEqual([]);
      expect(await fs.readFile(storePath('user-auth/login.feature'), 'utf-8')).toBe(
        superset
      );
    });

    it('adds a file for a fresh capability without any guard check', async () => {
      const fresh = `Feature: Reports
  Scenario: Monthly report
    Given a month with activity
    When the report runs
    Then it summarizes the month
`;
      await writeFile(changePath('reports/monthly.feature'), fresh);

      const result = await applyFeatures(root, changeName, {});

      expect(result.added).toBe(1);
      expect(result.lostScenarios).toEqual([]);
      expect(
        await fs.readFile(storePath('reports/monthly.feature'), 'utf-8')
      ).toBe(fresh);
    });

    it('removes a tombstoned store file without a scenario check', async () => {
      await writeFile(storePath('user-auth/legacy.feature'), STORE_FEATURE);
      await writeFile(
        path.join(changeDir, 'features', '.deleted'),
        'user-auth/legacy.feature\n'
      );

      const result = await applyFeatures(root, changeName, {});

      expect(result.deleted).toBe(1);
      expect(result.lostScenarios).toEqual([]);
      await expect(
        fs.access(storePath('user-auth/legacy.feature'))
      ).rejects.toThrow();
    });

    it('applies the overwrite when removed scenarios are accepted', async () => {
      await writeFile(storePath('user-auth/login.feature'), STORE_FEATURE);
      const changeFeature = STORE_FEATURE.replace(
        /  Scenario: Locked account[\s\S]*$/,
        ''
      );
      await writeFile(changePath('user-auth/login.feature'), changeFeature);

      const result = await applyFeatures(root, changeName, {
        acceptRemovedScenarios: true,
      });

      expect(result.overwritten).toBe(1);
      expect(result.lostScenarios).toEqual([]);
      expect(await fs.readFile(storePath('user-auth/login.feature'), 'utf-8')).toBe(
        changeFeature
      );
    });

    it('dryRun reports losses on lostScenarios without throwing and leaves the store untouched, while a non-dryRun call over the same inputs throws', async () => {
      await writeFile(storePath('user-auth/login.feature'), STORE_FEATURE);
      const changeFeature = STORE_FEATURE.replace(
        /  Scenario: Locked account[\s\S]*$/,
        ''
      );
      await writeFile(changePath('user-auth/login.feature'), changeFeature);

      const result = await applyFeatures(root, changeName, { dryRun: true });

      expect(result.lostScenarios).toEqual([
        { file: 'user-auth/login.feature', names: ['Locked account'] },
      ]);
      // Nothing is written under dryRun.
      expect(await fs.readFile(storePath('user-auth/login.feature'), 'utf-8')).toBe(
        STORE_FEATURE
      );

      // The same inputs without dryRun throw.
      await expect(applyFeatures(root, changeName, {})).rejects.toThrow(
        /Locked account/
      );
      expect(await fs.readFile(storePath('user-auth/login.feature'), 'utf-8')).toBe(
        STORE_FEATURE
      );
    });

    it('does not guard a byte-identical overwrite candidate (unchanged)', async () => {
      await writeFile(storePath('user-auth/login.feature'), STORE_FEATURE);
      await writeFile(changePath('user-auth/login.feature'), STORE_FEATURE);

      const result = await applyFeatures(root, changeName, {});

      expect(result.unchanged).toBe(1);
      expect(result.lostScenarios).toEqual([]);
    });
  });

  describe('ArchiveCommand', () => {
    let cwd: string;
    let logSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      cwd = process.cwd();
      process.chdir(root);
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      process.chdir(cwd);
      logSpy.mockRestore();
    });

    it('still refuses under { yes: true } when scenarios would be lost', async () => {
      await writeFile(storePath('user-auth/login.feature'), STORE_FEATURE);
      const changeFeature = STORE_FEATURE.replace(
        /  Scenario: Locked account[\s\S]*$/,
        ''
      );
      await writeFile(changePath('user-auth/login.feature'), changeFeature);
      await writeFile(path.join(changeDir, 'plan.md'), VALID_PLAN);
      await writeFile(path.join(changeDir, '.ratchet.yaml'), 'schema: ratchet\n');

      await expect(
        new ArchiveCommand().execute(changeName, { yes: true })
      ).rejects.toThrow(/Locked account/);

      // Store untouched and change not moved.
      expect(await fs.readFile(storePath('user-auth/login.feature'), 'utf-8')).toBe(
        STORE_FEATURE
      );
      await expect(fs.access(changeDir)).resolves.toBeUndefined();
    });
  });
});
