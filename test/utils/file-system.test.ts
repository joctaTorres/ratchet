// Mirrors .ratchet/changes/core-remainder-tests/features/core-remainder-tests/file-system.feature
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as nodeFs from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { FileSystemUtils, removeMarkerBlock } from '../../src/utils/file-system.js';

describe('FileSystemUtils', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `ratchet-test-${randomUUID()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('createDirectory', () => {
    it('should create a directory', async () => {
      const dirPath = path.join(testDir, 'new-dir');
      await FileSystemUtils.createDirectory(dirPath);
      
      const stats = await fs.stat(dirPath);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should create nested directories', async () => {
      const dirPath = path.join(testDir, 'nested', 'deep', 'dir');
      await FileSystemUtils.createDirectory(dirPath);
      
      const stats = await fs.stat(dirPath);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should not throw if directory already exists', async () => {
      const dirPath = path.join(testDir, 'existing-dir');
      await fs.mkdir(dirPath);
      
      await expect(FileSystemUtils.createDirectory(dirPath)).resolves.not.toThrow();
    });
  });

  describe('fileExists', () => {
    it('should return true for existing file', async () => {
      const filePath = path.join(testDir, 'test.txt');
      await fs.writeFile(filePath, 'test content');
      
      const exists = await FileSystemUtils.fileExists(filePath);
      expect(exists).toBe(true);
    });

    it('should return false for non-existing file', async () => {
      const filePath = path.join(testDir, 'non-existent.txt');
      
      const exists = await FileSystemUtils.fileExists(filePath);
      expect(exists).toBe(false);
    });

    it('should return false for directory path', async () => {
      const dirPath = path.join(testDir, 'dir');
      await fs.mkdir(dirPath);
      
      const exists = await FileSystemUtils.fileExists(dirPath);
      expect(exists).toBe(true); // fs.access doesn't distinguish between files and directories
    });
  });

  describe('directoryExists', () => {
    it('should return true for existing directory', async () => {
      const dirPath = path.join(testDir, 'test-dir');
      await fs.mkdir(dirPath);
      
      const exists = await FileSystemUtils.directoryExists(dirPath);
      expect(exists).toBe(true);
    });

    it('should return false for non-existing directory', async () => {
      const dirPath = path.join(testDir, 'non-existent-dir');
      
      const exists = await FileSystemUtils.directoryExists(dirPath);
      expect(exists).toBe(false);
    });

    it('should return false for file path', async () => {
      const filePath = path.join(testDir, 'file.txt');
      await fs.writeFile(filePath, 'content');
      
      const exists = await FileSystemUtils.directoryExists(filePath);
      expect(exists).toBe(false);
    });
  });

  describe('canonicalizeExistingPath', () => {
    it('should prefer the native realpath resolver when available', async () => {
      const filePath = path.join(testDir, 'canonical.txt');
      await fs.writeFile(filePath, 'content');

      const nativeSpy = vi.spyOn(nodeFs.realpathSync, 'native');

      const resolved = FileSystemUtils.canonicalizeExistingPath(filePath);

      expect(nativeSpy).toHaveBeenCalledWith(filePath);
      expect(resolved).toBe(nodeFs.realpathSync.native(filePath));

      nativeSpy.mockRestore();
    });
  });

  describe('writeFile', () => {
    it('should write content to file', async () => {
      const filePath = path.join(testDir, 'output.txt');
      const content = 'Hello, World!';
      
      await FileSystemUtils.writeFile(filePath, content);
      
      const readContent = await fs.readFile(filePath, 'utf-8');
      expect(readContent).toBe(content);
    });

    it('should create directory if it does not exist', async () => {
      const filePath = path.join(testDir, 'nested', 'dir', 'output.txt');
      const content = 'Nested content';
      
      await FileSystemUtils.writeFile(filePath, content);
      
      const readContent = await fs.readFile(filePath, 'utf-8');
      expect(readContent).toBe(content);
    });

    it('should overwrite existing file', async () => {
      const filePath = path.join(testDir, 'existing.txt');
      await fs.writeFile(filePath, 'old content');
      
      const newContent = 'new content';
      await FileSystemUtils.writeFile(filePath, newContent);
      
      const readContent = await fs.readFile(filePath, 'utf-8');
      expect(readContent).toBe(newContent);
    });
  });

  describe('readFile', () => {
    it('should read file content', async () => {
      const filePath = path.join(testDir, 'input.txt');
      const content = 'Test content';
      await fs.writeFile(filePath, content);
      
      const readContent = await FileSystemUtils.readFile(filePath);
      expect(readContent).toBe(content);
    });

    it('should throw for non-existing file', async () => {
      const filePath = path.join(testDir, 'non-existent.txt');
      
      await expect(FileSystemUtils.readFile(filePath)).rejects.toThrow();
    });
  });

  describe('ensureWritePermissions', () => {
    it('should return true for writable directory', async () => {
      const hasPermission = await FileSystemUtils.ensureWritePermissions(testDir);
      expect(hasPermission).toBe(true);
    });

    it('should return true for non-existing directory with writable parent', async () => {
      const dirPath = path.join(testDir, 'new-dir');
      const hasPermission = await FileSystemUtils.ensureWritePermissions(dirPath);
      expect(hasPermission).toBe(true);
    });

    it('should handle deeply nested non-existing directories', async () => {
      const dirPath = path.join(testDir, 'a', 'b', 'c', 'd');
      const hasPermission = await FileSystemUtils.ensureWritePermissions(dirPath);
      expect(hasPermission).toBe(true);
    });

    // Source lines 273-282: the test-file write succeeds but every unlink attempt
    // fails. After exhausting retries the method still returns true (the write
    // proved permissions) and logs that cleanup failed.
    it('returns true even when cleanup of the probe file repeatedly fails', async () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const unlinkSpy = vi
        .spyOn(fs, 'unlink')
        .mockRejectedValue(Object.assign(new Error('locked'), { code: 'EBUSY' }));

      const hasPermission = await FileSystemUtils.ensureWritePermissions(testDir);

      expect(hasPermission).toBe(true);
      // All retries attempted (maxRetries === 3) and the final failure was logged.
      expect(unlinkSpy).toHaveBeenCalledTimes(3);
      expect(debugSpy).toHaveBeenCalled();

      unlinkSpy.mockRestore();
      debugSpy.mockRestore();

      // Clean up any leftover probe files so afterEach succeeds.
      const leftovers = (await fs.readdir(testDir)).filter((n) =>
        n.startsWith('.ratchet-test-')
      );
      await Promise.all(leftovers.map((n) => fs.unlink(path.join(testDir, n))));
    });
  });

  describe('canWriteFile', () => {
    it('should return true for existing writable file', async () => {
      const filePath = path.join(testDir, 'writable.txt');
      await fs.writeFile(filePath, 'content');

      const canWrite = await FileSystemUtils.canWriteFile(filePath);
      expect(canWrite).toBe(true);
    });

    it('should return false for existing read-only file', async () => {
      const filePath = path.join(testDir, 'readonly.txt');
      await fs.writeFile(filePath, 'content');
      await fs.chmod(filePath, 0o444); // Read-only

      const canWrite = await FileSystemUtils.canWriteFile(filePath);
      expect(canWrite).toBe(false);

      // Cleanup: restore permissions so afterEach can delete
      await fs.chmod(filePath, 0o644);
    });

    it('should return true for non-existent file in writable directory', async () => {
      const filePath = path.join(testDir, 'new-file.txt');

      const canWrite = await FileSystemUtils.canWriteFile(filePath);
      expect(canWrite).toBe(true);
    });

    it('should return true for non-existent file in non-existent nested directories', async () => {
      const filePath = path.join(testDir, 'deep', 'nested', 'path', 'file.txt');

      const canWrite = await FileSystemUtils.canWriteFile(filePath);
      expect(canWrite).toBe(true);
    });

    // Skip on Windows: fs.chmod() on directories doesn't restrict write access on Windows
    // Windows uses ACLs which Node.js chmod doesn't control
    it.skipIf(process.platform === 'win32')('should return false for non-existent file in read-only directory', async () => {
      const readOnlyDir = path.join(testDir, 'readonly-dir');
      await fs.mkdir(readOnlyDir);
      await fs.chmod(readOnlyDir, 0o555); // Read-only + execute

      const filePath = path.join(readOnlyDir, 'file.txt');
      const canWrite = await FileSystemUtils.canWriteFile(filePath);
      expect(canWrite).toBe(false);

      // Cleanup
      await fs.chmod(readOnlyDir, 0o755);
    });

    it('should return true when path points to existing directory', async () => {
      const dirPath = path.join(testDir, 'some-dir');
      await fs.mkdir(dirPath);

      const canWrite = await FileSystemUtils.canWriteFile(dirPath);
      expect(canWrite).toBe(true);
    });

    it('should traverse multiple non-existent parent directories', async () => {
      const filePath = path.join(testDir, 'a', 'b', 'c', 'd', 'e', 'file.txt');

      const canWrite = await FileSystemUtils.canWriteFile(filePath);
      expect(canWrite).toBe(true);
    });

    it('should return false when intermediate path component is a file', async () => {
      // Create a file where a directory should be
      const fileInPath = path.join(testDir, 'blocking-file.txt');
      await fs.writeFile(fileInPath, 'content');

      // Try to check a path that goes "through" this file
      const filePath = path.join(fileInPath, 'nested', 'file.txt');
      const canWrite = await FileSystemUtils.canWriteFile(filePath);
      expect(canWrite).toBe(false);
    });

    // Skip on Windows: creating symlinks requires elevated privileges or Developer Mode
    it.skipIf(process.platform === 'win32')('should follow symbolic links to files', async () => {
      const realFile = path.join(testDir, 'real-file.txt');
      const linkFile = path.join(testDir, 'link-file.txt');
      await fs.writeFile(realFile, 'content');
      await fs.symlink(realFile, linkFile);

      const canWrite = await FileSystemUtils.canWriteFile(linkFile);
      expect(canWrite).toBe(true);
    });

    it('should handle platform-specific path separators', async () => {
      const filePath = FileSystemUtils.joinPath(testDir, 'subdir', 'file.txt');
      const canWrite = await FileSystemUtils.canWriteFile(filePath);
      expect(canWrite).toBe(true);
    });

    // Scenario: a write to a non-writable path is reported as not writable.
    // Make the first existing ancestor non-writable (chmod 0o555) and target a
    // not-yet-existing file beneath it, exercising the ENOENT -> parent W_OK
    // branch. canWriteFile must report false rather than throwing.
    it.skipIf(process.platform === 'win32')(
      'reports a non-writable target as not writable rather than throwing',
      async () => {
        const lockedDir = path.join(testDir, 'locked-dir');
        await fs.mkdir(lockedDir);
        await fs.chmod(lockedDir, 0o555); // read + execute, no write

        const target = path.join(lockedDir, 'cannot-create.txt');

        let canWrite: boolean;
        try {
          canWrite = await FileSystemUtils.canWriteFile(target);
        } finally {
          // Restore perms so afterEach can clean up regardless of assertion.
          await fs.chmod(lockedDir, 0o755);
        }

        expect(canWrite).toBe(false);
      }
    );
  });

  describe('joinPath', () => {
    it('should join POSIX-style paths', () => {
      const result = FileSystemUtils.joinPath(
        '/tmp/project',
        '.claude/commands/.ratchet/proposal.md'
      );
      expect(result).toBe('/tmp/project/.claude/commands/.ratchet/proposal.md');
    });

    it('should join Linux home directory paths', () => {
      const result = FileSystemUtils.joinPath(
        '/home/dev/workspace/ratchet',
        '.cursor/commands/install.md'
      );
      expect(result).toBe('/home/dev/workspace/ratchet/.cursor/commands/install.md');
    });

    it('should join Windows drive-letter paths with backslashes', () => {
      const result = FileSystemUtils.joinPath(
        'C:\\Users\\dev\\project',
        '.claude/commands/ratchet/proposal.md'
      );
      expect(result).toBe(
        'C:\\Users\\dev\\project\\.claude\\commands\\ratchet\\proposal.md'
      );
    });

    it('should join Windows paths that use forward slashes', () => {
      const result = FileSystemUtils.joinPath(
        'D:/workspace/app',
        '.cursor/commands/ratchet-apply.md'
      );
      expect(result).toBe(
        'D:\\workspace\\app\\.cursor\\commands\\ratchet-apply.md'
      );
    });

    it('should join UNC-style Windows paths', () => {
      const result = FileSystemUtils.joinPath(
        '\\server\\share\\repo',
        '.windsurf/workflows/ratchet-archive.md'
      );
      expect(result).toBe(
        '\\server\\share\\repo\\.windsurf\\workflows\\ratchet-archive.md'
      );
    });

    // Source line 97: a POSIX base with no extra segments → normalized base only.
    it('normalizes a POSIX base path when no segments are supplied', () => {
      const result = FileSystemUtils.joinPath('/tmp/project/./sub/../sub');
      expect(result).toBe('/tmp/project/sub');
    });

    // Source line 90: a Windows base with no extra segments → normalized base only.
    it('normalizes a Windows base path when no segments are supplied', () => {
      const result = FileSystemUtils.joinPath('C:\\Users\\dev\\project\\');
      expect(result).toBe('C:\\Users\\dev\\project\\');
    });
  });

  // Source lines 110-111: fileExists logs (console.debug) and returns false when
  // fs.access fails with a non-ENOENT error (e.g. EACCES via stat throwing).
  describe('fileExists / directoryExists non-ENOENT branches', () => {
    it('returns false and logs when fs.access fails with a non-ENOENT error (fileExists)', async () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const accessSpy = vi.spyOn(fs, 'access').mockRejectedValueOnce(
        Object.assign(new Error('permission denied'), { code: 'EACCES' })
      );

      const exists = await FileSystemUtils.fileExists(path.join(testDir, 'whatever.txt'));

      expect(exists).toBe(false);
      expect(debugSpy).toHaveBeenCalled();

      accessSpy.mockRestore();
      debugSpy.mockRestore();
    });

    // Source lines 198-199: directoryExists logs and returns false when stat
    // fails with a non-ENOENT error.
    it('returns false and logs when fs.stat fails with a non-ENOENT error (directoryExists)', async () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const statSpy = vi.spyOn(fs, 'stat').mockRejectedValueOnce(
        Object.assign(new Error('I/O error'), { code: 'EIO' })
      );

      const exists = await FileSystemUtils.directoryExists(path.join(testDir, 'whatever'));

      expect(exists).toBe(false);
      expect(debugSpy).toHaveBeenCalled();

      statSpy.mockRestore();
      debugSpy.mockRestore();
    });
  });

  // Source lines 131-132, 139-140, 144-146, 175-176: canWriteFile's ENOENT path
  // walks up via findFirstExistingDirectory; cover its non-directory, root, and
  // unexpected-error branches plus the "no existing parent" return.
  describe('canWriteFile findFirstExistingDirectory branches', () => {
    // Source lines 175-176: ENOENT on the target and no existing parent directory
    // found → returns false. We make every stat in the walk-up report ENOENT.
    it('returns false when no existing parent directory can be found', async () => {
      const target = path.join(testDir, 'a', 'b', 'c.txt');
      const statSpy = vi.spyOn(fs, 'stat').mockRejectedValue(
        Object.assign(new Error('not found'), { code: 'ENOENT' })
      );

      const canWrite = await FileSystemUtils.canWriteFile(target);

      expect(canWrite).toBe(false);
      statSpy.mockRestore();
    });

    // Source lines 144-146: an unexpected (non-ENOENT) error while walking up the
    // tree → findFirstExistingDirectory returns null → canWriteFile false.
    it('returns false when walking up the tree hits an unexpected error', async () => {
      const target = path.join(testDir, 'x', 'y', 'z.txt');
      const statSpy = vi.spyOn(fs, 'stat').mockImplementation((p: any) => {
        // The target itself is ENOENT (drives into the ENOENT branch);
        // the first parent lookup throws an unexpected error.
        if (String(p).endsWith('z.txt')) {
          return Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }));
        }
        return Promise.reject(Object.assign(new Error('I/O error'), { code: 'EIO' }));
      });

      const canWrite = await FileSystemUtils.canWriteFile(target);

      expect(canWrite).toBe(false);
      statSpy.mockRestore();
    });

    // Source lines 131-132: findFirstExistingDirectory stats a parent that exists
    // but is NOT a directory → returns null → canWriteFile false. The target stat
    // reports ENOENT (driving the walk-up); the parent stat resolves to a file.
    it('returns false when the first existing ancestor is a file, not a directory', async () => {
      const blockingFile = path.join(testDir, 'blocker');
      await fs.writeFile(blockingFile, 'content');
      const target = path.join(blockingFile, 'child.txt');
      const realStat = fs.stat.bind(fs);

      const statSpy = vi.spyOn(fs, 'stat').mockImplementation((p: any, ...rest: any[]) => {
        if (String(p).endsWith('child.txt')) {
          // Force the ENOENT branch so findFirstExistingDirectory runs on the parent.
          return Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }));
        }
        // The parent (blocker) is a real file → stats fine but isDirectory() is false.
        return realStat(p, ...rest);
      });

      const canWrite = await FileSystemUtils.canWriteFile(target);

      expect(canWrite).toBe(false);
      statSpy.mockRestore();
    });
  });

  // Source lines 232-235: updateFileWithMarkers replaces an existing block and
  // throws on inverted / half-present markers.
  describe('updateFileWithMarkers', () => {
    const START = '<!-- ratchet:start -->';
    const END = '<!-- ratchet:end -->';

    it('replaces the content between existing well-ordered markers', async () => {
      const filePath = path.join(testDir, 'markers.md');
      await fs.writeFile(
        filePath,
        ['before', START, 'old body', END, 'after', ''].join('\n')
      );

      await FileSystemUtils.updateFileWithMarkers(filePath, 'new body', START, END);

      const updated = await fs.readFile(filePath, 'utf-8');
      expect(updated).toContain('new body');
      expect(updated).not.toContain('old body');
      expect(updated).toContain('before');
      expect(updated).toContain('after');
    });

    it('prepends a fresh marker block when no markers exist yet', async () => {
      const filePath = path.join(testDir, 'fresh.md');
      await fs.writeFile(filePath, 'existing content\n');

      await FileSystemUtils.updateFileWithMarkers(filePath, 'inserted', START, END);

      const updated = await fs.readFile(filePath, 'utf-8');
      expect(updated.startsWith(START)).toBe(true);
      expect(updated).toContain('inserted');
      expect(updated).toContain('existing content');
    });

    it('creates the file with a marker block when it does not exist', async () => {
      const filePath = path.join(testDir, 'created.md');

      await FileSystemUtils.updateFileWithMarkers(filePath, 'body', START, END);

      const created = await fs.readFile(filePath, 'utf-8');
      expect(created).toBe(`${START}\nbody\n${END}`);
    });

    // Source line 243: an inverted layout (end marker before start marker) means
    // the post-start end lookup misses, leaving exactly one marker found → throws
    // the "Invalid marker state" half-present error.
    it('throws on an inverted layout where only one marker is resolvable', async () => {
      const filePath = path.join(testDir, 'inverted.md');
      await fs.writeFile(
        filePath,
        ['intro', END, 'middle', START, 'outro', ''].join('\n')
      );

      await expect(
        FileSystemUtils.updateFileWithMarkers(filePath, 'x', START, END)
      ).rejects.toThrow(/Invalid marker state/);
    });

    // Source line 243: exactly one marker is present → throws.
    it('throws when only the start marker is present (half-open block)', async () => {
      const filePath = path.join(testDir, 'half.md');
      await fs.writeFile(filePath, ['intro', START, 'body with no end', ''].join('\n'));

      await expect(
        FileSystemUtils.updateFileWithMarkers(filePath, 'x', START, END)
      ).rejects.toThrow(/Invalid marker state/);
    });
  });
});

describe('removeMarkerBlock', () => {
  const START = '<!-- ratchet:start -->';
  const END = '<!-- ratchet:end -->';

  // Scenario: removeMarkerBlock removes a block that stands on its own lines.
  it('removes a marker block on its own lines and collapses triple blank lines', () => {
    const content = [
      'keep before',
      '',
      START,
      'generated line one',
      'generated line two',
      END,
      '',
      '',
      '',
      'keep after',
      '',
    ].join('\n');

    const result = removeMarkerBlock(content, START, END);

    expect(result).not.toContain(START);
    expect(result).not.toContain(END);
    expect(result).not.toContain('generated line one');
    // Triple+ blank lines collapse to a single double blank.
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toContain('keep before');
    expect(result).toContain('keep after');
    expect(result).toBe('keep before\n\nkeep after\n');
  });

  // Scenario: removeMarkerBlock leaves content untouched when markers are
  // missing or inverted (end before start).
  it('returns content unchanged when the end marker appears before the start marker', () => {
    const content = [
      'intro',
      END,
      'middle',
      START,
      'outro',
    ].join('\n');

    const result = removeMarkerBlock(content, START, END);
    expect(result).toBe(content);
  });

  it('returns content unchanged when a marker is missing entirely', () => {
    const content = ['intro', START, 'body', 'outro with no end marker'].join('\n');
    const result = removeMarkerBlock(content, START, END);
    expect(result).toBe(content);
  });

  // Scenario: removeMarkerBlock ignores an inline marker mention.
  it('ignores an inline marker mention with other characters after it on the line', () => {
    const content = [
      'prose that mentions ' + START + ' inline and keeps going',
      'and ' + END + ' is also inline here, not a marker line',
      'final line',
    ].join('\n');

    // No marker stands alone on its own line, so nothing is removed.
    const result = removeMarkerBlock(content, START, END);
    expect(result).toBe(content);
  });

  // Scenario: removeMarkerBlock preserves the original newline style (CRLF).
  it('preserves CRLF newline style when the content uses \\r\\n', () => {
    const content = [
      'keep before',
      '',
      START,
      'generated',
      END,
      '',
      'keep after',
      '',
    ].join('\r\n');

    const result = removeMarkerBlock(content, START, END);

    expect(result).not.toContain(START);
    expect(result).not.toContain(END);
    // Source line 343 derives the trailing newline style from whether the input
    // contains '\r\n'; CRLF input yields a CRLF-terminated result.
    expect(result).toContain('\r\n');
    expect(result.endsWith('\r\n')).toBe(true);
    expect(result.endsWith('\n\n')).toBe(false);
    expect(result).toContain('keep before');
    expect(result).toContain('keep after');
  });

  // Source lines 21-22: a marker is clean on its LEFT (line start) but has
  // trailing non-whitespace on the same line → isMarkerOnOwnLine's right-side
  // scan returns false, so the marker is not treated as standing alone.
  it('ignores a marker that starts the line but has trailing text after it', () => {
    const content = [
      START + ' trailing comment on the same line',
      'generated body',
      END,
      'after',
    ].join('\n');

    // The START is not "on its own line" (right side has text), so the pair is
    // never matched and the content is returned unchanged.
    const result = removeMarkerBlock(content, START, END);
    expect(result).toBe(content);
  });

  // Scenario: removeMarkerBlock returns empty when removal leaves only whitespace.
  it('returns an empty string when the content is nothing but the marker block', () => {
    const content = [START, 'only generated content', END].join('\n');

    const result = removeMarkerBlock(content, START, END);
    expect(result).toBe('');
  });
});
