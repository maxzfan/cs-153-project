import { join, dirname, basename, extname } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { readFile, writeFile, mkdir } from 'fs/promises';

/**
 * Service for managing 0studio commit storage folders
 * Creates a 0studio_{project-name}_{ext} folder next to the primary file to
 * store commit versions and tree.json. The _{ext} suffix prevents collision
 * when two files share a basename (e.g. building.3dm + building.rvt).
 */
const VALID_COMMIT_ID = /^[a-zA-Z0-9_-]+$/;

/**
 * Formats the renderer may claim as an original artifact. The allowlist is enforced
 * at file-write time so a hostile tree.json can't inject '.3dm/../../etc/passwd' or
 * similar into the path passed to join(). Order matters for listCommitFiles() — the
 * service probes these extensions in sequence when reconstructing the commit ID from
 * a filename, so a commit's actual extension wins over anything ambiguous.
 */
export type OriginalFormat = '.3dm' | '.rvt' | '.ifc';
const VALID_ORIGINAL_FORMATS: readonly OriginalFormat[] = ['.3dm', '.rvt', '.ifc'] as const;

function validateCommitId(commitId: string): void {
  if (!commitId || !VALID_COMMIT_ID.test(commitId)) {
    throw new Error(`Invalid commitId: ${commitId}`);
  }
}

function validateOriginalFormat(format: string | undefined): OriginalFormat {
  if (format === undefined) return '.3dm';
  // Strict equality against the literal allowlist. No normalization, no path separators.
  if (format === '.3dm' || format === '.rvt' || format === '.ifc') return format;
  throw new Error(`Invalid originalFormat: ${format}`);
}

export class FileStorageService {
  /**
   * Get the 0studio folder path for a given file.
   *
   * Naming: `0studio_{basename}_{ext-without-dot}` — the extension suffix prevents
   * `building.3dm` and `building.rvt` from colliding on the same `0studio_building/`.
   * Legacy projects created before Phase 3 use the old `0studio_{basename}/` naming;
   * {@link migrateLegacyStorageFolder} renames those on first open.
   */
  getStorageFolderPath(filePath: string): string {
    const dir = dirname(filePath);
    const ext = extname(filePath); // includes leading dot, e.g. '.3dm'
    const fileName = basename(filePath, ext);
    const extSuffix = ext ? `_${ext.slice(1).toLowerCase()}` : '';
    return join(dir, `0studio_${fileName}${extSuffix}`);
  }

  /**
   * Legacy (pre-Phase-3) folder name — `0studio_{basename}` with no extension suffix.
   * Exposed separately so project open can detect the old layout and migrate.
   */
  getLegacyStorageFolderPath(filePath: string): string {
    const dir = dirname(filePath);
    const fileName = basename(filePath, extname(filePath));
    return join(dir, `0studio_${fileName}`);
  }

  /**
   * If an old-style storage folder exists for this file and a new-style one does not,
   * rename the old folder to the new naming scheme. Idempotent: safe to call on every
   * project open. Returns true if a migration occurred.
   *
   * No-op if:
   *   - the new folder already exists (respects whatever the user has)
   *   - the legacy folder doesn't exist (fresh project or already migrated)
   *   - both exist (conflicting state — caller decides; we don't merge)
   */
  async migrateLegacyStorageFolder(filePath: string): Promise<boolean> {
    const newPath = this.getStorageFolderPath(filePath);
    const legacyPath = this.getLegacyStorageFolderPath(filePath);
    if (newPath === legacyPath) return false; // file had no extension; nothing to suffix
    if (existsSync(newPath)) return false;
    if (!existsSync(legacyPath)) return false;
    const { rename } = await import('fs/promises');
    await rename(legacyPath, newPath);
    return true;
  }

  /**
   * Ensure the 0studio folder exists, create it if it doesn't
   * @param filePath Path to the primary project file
   */
  async ensureStorageFolder(filePath: string): Promise<void> {
    const folderPath = this.getStorageFolderPath(filePath);
    if (!existsSync(folderPath)) {
      await mkdir(folderPath, { recursive: true });
    }
  }

  /**
   * Get the commit file path for a given commit ID.
   * @param originalFormat extension to use — defaults to '.3dm' for backward compatibility
   *   with pre-Phase-3 callers. Validated against an allowlist so a malicious tree.json
   *   value (e.g. '../other') cannot influence the joined path.
   */
  getCommitFilePath(filePath: string, commitId: string, originalFormat?: OriginalFormat | string): string {
    validateCommitId(commitId);
    const format = validateOriginalFormat(originalFormat);
    const folderPath = this.getStorageFolderPath(filePath);
    return join(folderPath, `commit-${commitId}${format}`);
  }

  /**
   * Save a commit original artifact to the 0studio folder.
   */
  async saveCommitFile(filePath: string, commitId: string, fileBuffer: ArrayBuffer, originalFormat?: OriginalFormat | string): Promise<void> {
    await this.ensureStorageFolder(filePath);
    const commitFilePath = this.getCommitFilePath(filePath, commitId, originalFormat);
    const nodeBuffer = Buffer.from(fileBuffer);
    await writeFile(commitFilePath, nodeBuffer);
  }

  /**
   * Read a commit original artifact from the 0studio folder.
   *
   * If originalFormat is supplied, reads exactly that extension. If omitted (legacy
   * callers), probes the allowed extensions in order so a commit whose format is
   * unknown to the caller can still be located.
   */
  async readCommitFile(filePath: string, commitId: string, originalFormat?: OriginalFormat | string): Promise<ArrayBuffer | null> {
    const candidates = originalFormat !== undefined
      ? [validateOriginalFormat(originalFormat)]
      : VALID_ORIGINAL_FORMATS;

    for (const fmt of candidates) {
      const commitFilePath = this.getCommitFilePath(filePath, commitId, fmt);
      if (!existsSync(commitFilePath)) continue;
      const buffer = await readFile(commitFilePath);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
    return null;
  }

  /**
   * List all commit files in the 0studio folder
   * @param filePath Path to the .3dm file
   * @returns Array of commit IDs found in the folder
   */
  async listCommitFiles(filePath: string): Promise<string[]> {
    const folderPath = this.getStorageFolderPath(filePath);
    
    if (!existsSync(folderPath)) {
      return [];
    }

    const files = readdirSync(folderPath);
    const commitIds: string[] = [];

    // A "commit" is defined by the presence of an original artifact (.3dm / .rvt /
    // .ifc / .delta). Derivative-only (.glb) files without a matching original are
    // orphans and intentionally not reported here — this keeps `listCommitFiles`
    // consistent with `commitFileExists`, so any caller doing set-diff against
    // tree.json won't treat orphan derivatives as commits.
    const originalExts = ['.3dm', '.rvt', '.ifc', '.delta'];
    const seen = new Set<string>();
    for (const file of files) {
      if (!file.startsWith('commit-')) continue;
      const ext = originalExts.find((e) => file.endsWith(e));
      if (!ext) continue;
      const commitId = file.slice('commit-'.length, -ext.length);
      if (!seen.has(commitId)) {
        seen.add(commitId);
        commitIds.push(commitId);
      }
    }

    return commitIds;
  }

  /**
   * List commit IDs that have derivative (.glb) files. Used for orphan cleanup
   * and derivative-sync reconciliation.
   */
  async listDerivativeFiles(filePath: string): Promise<string[]> {
    const folderPath = this.getStorageFolderPath(filePath);
    if (!existsSync(folderPath)) return [];
    const files = readdirSync(folderPath);
    const out: string[] = [];
    for (const file of files) {
      if (file.startsWith('commit-') && file.endsWith('.glb')) {
        out.push(file.slice('commit-'.length, -'.glb'.length));
      }
    }
    return out;
  }

  /**
   * Get the delta file path for a given commit ID
   * @param filePath Path to the .3dm file
   * @param commitId Commit ID
   * @returns Path to the delta file (e.g., /path/to/0studio_filename/commit-1234567890.delta)
   */
  getDeltaFilePath(filePath: string, commitId: string): string {
    validateCommitId(commitId);
    const folderPath = this.getStorageFolderPath(filePath);
    return join(folderPath, `commit-${commitId}.delta`);
  }

  /**
   * Save a delta file to the 0studio folder
   * @param filePath Path to the .3dm file
   * @param commitId Commit ID
   * @param deltaBuffer Delta buffer to save
   */
  async saveDeltaFile(filePath: string, commitId: string, deltaBuffer: ArrayBuffer): Promise<void> {
    await this.ensureStorageFolder(filePath);
    const deltaFilePath = this.getDeltaFilePath(filePath, commitId);
    const nodeBuffer = Buffer.from(deltaBuffer);
    await writeFile(deltaFilePath, nodeBuffer);
  }

  /**
   * Read a delta file from the 0studio folder
   * @param filePath Path to the .3dm file
   * @param commitId Commit ID
   * @returns Delta buffer or null if not found
   */
  async readDeltaFile(filePath: string, commitId: string): Promise<ArrayBuffer | null> {
    const deltaFilePath = this.getDeltaFilePath(filePath, commitId);

    if (!existsSync(deltaFilePath)) {
      return null;
    }

    const buffer = await readFile(deltaFilePath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    return arrayBuffer;
  }

  /**
   * Check if a commit file exists in any original format (.3dm/.rvt/.ifc) or as a delta.
   */
  commitFileExists(filePath: string, commitId: string): boolean {
    for (const fmt of VALID_ORIGINAL_FORMATS) {
      if (existsSync(this.getCommitFilePath(filePath, commitId, fmt))) return true;
    }
    return existsSync(this.getDeltaFilePath(filePath, commitId));
  }

  /**
   * Get the derivative (glTF) file path for a given commit ID
   * @param filePath Path to the .3dm file
   * @param commitId Commit ID
   * @returns Path to the derivative file (e.g., /path/to/0studio_filename/commit-1234567890.glb)
   */
  getDerivativeFilePath(filePath: string, commitId: string): string {
    validateCommitId(commitId);
    const folderPath = this.getStorageFolderPath(filePath);
    return join(folderPath, `commit-${commitId}.glb`);
  }

  /**
   * Save a derivative (glTF binary) file to the 0studio folder.
   * @param filePath Path to the .3dm file
   * @param commitId Commit ID
   * @param derivativeBuffer Derivative buffer to save
   */
  async saveDerivativeFile(filePath: string, commitId: string, derivativeBuffer: ArrayBuffer): Promise<void> {
    await this.ensureStorageFolder(filePath);
    const derivativePath = this.getDerivativeFilePath(filePath, commitId);
    const nodeBuffer = Buffer.from(derivativeBuffer);
    await writeFile(derivativePath, nodeBuffer);
  }

  /**
   * Read a derivative file from the 0studio folder.
   * @returns Derivative buffer or null if not found
   */
  async readDerivativeFile(filePath: string, commitId: string): Promise<ArrayBuffer | null> {
    const derivativePath = this.getDerivativeFilePath(filePath, commitId);
    if (!existsSync(derivativePath)) return null;
    const buffer = await readFile(derivativePath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }

  /**
   * Check whether a derivative file exists for a commit.
   */
  derivativeFileExists(filePath: string, commitId: string): boolean {
    return existsSync(this.getDerivativeFilePath(filePath, commitId));
  }

  /**
   * Return the derivative file size in bytes, or null if the file does not exist.
   * Used by the renderer to verify tree.json's derivativeSize matches on-disk reality.
   */
  derivativeFileSize(filePath: string, commitId: string): number | null {
    const derivativePath = this.getDerivativeFilePath(filePath, commitId);
    if (!existsSync(derivativePath)) return null;
    return statSync(derivativePath).size;
  }

  /**
   * Get the tree.json file path
   * @param filePath Path to the .3dm file
   * @returns Path to the tree.json file
   */
  getTreeFilePath(filePath: string): string {
    const folderPath = this.getStorageFolderPath(filePath);
    return join(folderPath, 'tree.json');
  }

  /**
   * Save the commit tree structure to tree.json
   * @param filePath Path to the .3dm file
   * @param treeData Tree data structure with branches and commits
   */
  async saveTreeFile(filePath: string, treeData: {
    version: string;
    activeBranchId: string | null;
    currentCommitId: string | null;
    branches: Array<{
      id: string;
      name: string;
      headCommitId: string;
      color: string;
      isMain: boolean;
      parentBranchId?: string;
      originCommitId?: string;
    }>;
    commits: Array<{
      id: string;
      message: string;
      timestamp: number;
      parentCommitId: string | null;
      branchId: string;
      starred?: boolean;
      storageType?: 'snapshot' | 'delta';
      baseCommitId?: string;
      fullHash?: string;
      deltaChainLength?: number;
      // Dual-artifact fields (tree.json v1.1). Absence = legacy '.3dm' original, no derivative.
      originalFormat?: '.3dm' | '.rvt' | '.ifc';
      derivativeStatus?: 'present' | 'missing';
      derivativeSize?: number;
    }>;
  }): Promise<void> {
    // Ensure the storage folder exists (same folder as commit files)
    await this.ensureStorageFolder(filePath);
    const treeFilePath = this.getTreeFilePath(filePath);
    const jsonContent = JSON.stringify(treeData, null, 2); // Pretty print for debugging
    await writeFile(treeFilePath, jsonContent, 'utf-8');
  }

  /**
   * Load the commit tree structure from tree.json
   * @param filePath Path to the .3dm file
   * @returns Tree data or null if file doesn't exist
   */
  async loadTreeFile(filePath: string): Promise<{
    version: string;
    activeBranchId: string | null;
    currentCommitId: string | null;
    branches: Array<{
      id: string;
      name: string;
      headCommitId: string;
      color: string;
      isMain: boolean;
      parentBranchId?: string;
      originCommitId?: string;
    }>;
    commits: Array<{
      id: string;
      message: string;
      timestamp: number;
      parentCommitId: string | null;
      branchId: string;
      starred?: boolean;
      storageType?: 'snapshot' | 'delta';
      baseCommitId?: string;
      fullHash?: string;
      deltaChainLength?: number;
      originalFormat?: '.3dm' | '.rvt' | '.ifc';
      derivativeStatus?: 'present' | 'missing';
      derivativeSize?: number;
    }>;
  } | null> {
    const treeFilePath = this.getTreeFilePath(filePath);
    
    if (!existsSync(treeFilePath)) {
      return null;
    }

    try {
      const content = await readFile(treeFilePath, 'utf-8');
      const treeData = JSON.parse(content);
      return treeData;
    } catch {
      return null;
    }
  }

  /**
   * Validate that all commit files referenced in tree.json exist
   * @param filePath Path to the .3dm file
   * @param commitIds Array of commit IDs to validate
   * @returns Array of missing commit IDs
   */
  validateCommitFiles(filePath: string, commitIds: string[]): string[] {
    const missing: string[] = [];
    for (const commitId of commitIds) {
      if (!this.commitFileExists(filePath, commitId)) {
        missing.push(commitId);
      }
    }
    return missing;
  }
}
