import { promises as fs } from 'fs';
import { RATCHET_DIR_NAME } from '../core/config.js';
import path from 'path';

// A change directory is identified by its metadata file (written by `new change`).
const CHANGE_METADATA_FILENAME = '.ratchet.yaml';

export async function getActiveChangeIds(root: string = process.cwd()): Promise<string[]> {
  const changesPath = path.join(root, RATCHET_DIR_NAME, 'changes');
  try {
    const entries = await fs.readdir(changesPath, { withFileTypes: true });
    const result: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'archive') continue;
      const metaPath = path.join(changesPath, entry.name, CHANGE_METADATA_FILENAME);
      try {
        await fs.access(metaPath);
        result.push(entry.name);
      } catch {
        // skip directories without change metadata
      }
    }
    return result.sort();
  } catch {
    return [];
  }
}

/**
 * Top-level feature-store capability ids (.ratchet/features/<capability>).
 * A capability is the first path segment under features/. The store is only
 * populated by archive (Wave 3); before then this returns [].
 */
export async function getSpecIds(root: string = process.cwd()): Promise<string[]> {
  const featuresPath = path.join(root, RATCHET_DIR_NAME, 'features');
  const result: string[] = [];
  try {
    const entries = await fs.readdir(featuresPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      result.push(entry.name);
    }
  } catch {
    // ignore
  }
  return result.sort();
}

export async function getArchivedChangeIds(root: string = process.cwd()): Promise<string[]> {
  const archivePath = path.join(root, RATCHET_DIR_NAME, 'changes', 'archive');
  try {
    const entries = await fs.readdir(archivePath, { withFileTypes: true });
    const result: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const metaPath = path.join(archivePath, entry.name, CHANGE_METADATA_FILENAME);
      try {
        await fs.access(metaPath);
        result.push(entry.name);
      } catch {
        // skip directories without change metadata
      }
    }
    return result.sort();
  } catch {
    return [];
  }
}

