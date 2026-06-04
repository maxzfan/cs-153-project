import { FileStorageService } from './file-storage-service';

/**
 * Interface for the delta worker pool.
 * The actual implementation will be provided via constructor injection
 * (created by another agent in electron/workers/delta-worker-pool.ts).
 */
export interface DeltaWorkerPoolInterface {
  applyDelta(baseBuffer: ArrayBuffer, deltaBuffer: ArrayBuffer, expectedHash: string): Promise<ArrayBuffer>;
}

/**
 * Commit data as stored in tree.json, including delta compression fields.
 */
export interface TreeCommitData {
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
  // Dual-artifact (Phase 3) — determines which extension to read from disk. Absent = '.3dm'.
  originalFormat?: '.3dm' | '.rvt' | '.ifc';
}

/**
 * Tree data structure matching what's stored in tree.json.
 */
export interface TreeData {
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
  commits: TreeCommitData[];
}

/**
 * Service that reconstructs full .3dm files from delta chains.
 *
 * When a commit is stored as a delta, this service walks the parent chain
 * back to the nearest keyframe (snapshot), then applies deltas forward
 * to produce the full file content.
 */
export class CommitReconstructionService {
  constructor(
    private fileStorage: FileStorageService,
    private workerPool: DeltaWorkerPoolInterface
  ) {}

  /**
   * Check if a commit is a snapshot (not a delta) and can be read directly.
   * Commits without a storageType field are treated as snapshots for
   * backward compatibility with pre-delta tree.json files.
   */
  isSnapshot(commitId: string, treeData: TreeData): boolean {
    const commit = treeData.commits.find(c => c.id === commitId);
    return !commit?.storageType || commit.storageType === 'snapshot';
  }

  /**
   * Reconstruct a commit's full .3dm file by walking the delta chain
   * back to the nearest keyframe and applying deltas forward.
   *
   * @param filePath Path to the .3dm project file
   * @param targetCommitId The commit to reconstruct
   * @param treeData The current tree.json data
   * @returns The full .3dm ArrayBuffer for the target commit
   * @throws If any file in the chain is missing, corrupt, or hash verification fails
   */
  async reconstructCommit(
    filePath: string,
    targetCommitId: string,
    treeData: TreeData
  ): Promise<ArrayBuffer> {
    // 1. Build the chain from target back to the nearest keyframe
    const chain = this.buildDeltaChain(targetCommitId, treeData);

    // 2. The first entry in the chain is the keyframe — read it from disk. Pass the
    //    tree.json-declared originalFormat so readCommitFile looks at the exact file
    //    rather than probing extensions (slightly faster and more explicit about intent).
    const keyframeCommit = chain[0];
    const keyframeBuffer = await this.fileStorage.readCommitFile(filePath, keyframeCommit.id, keyframeCommit.originalFormat);
    if (keyframeBuffer === null) {
      throw new Error(
        `Reconstruction failed: keyframe commit file missing for commit ${keyframeCommit.id}. ` +
        `Expected snapshot file at ${this.fileStorage.getCommitFilePath(filePath, keyframeCommit.id, keyframeCommit.originalFormat)}`
      );
    }

    // 3. If the target IS the keyframe, return it directly
    if (chain.length === 1) {
      return keyframeBuffer;
    }

    // 4. Apply each delta in sequence (chain[1], chain[2], ..., chain[n])
    let currentBuffer = keyframeBuffer;

    for (let i = 1; i < chain.length; i++) {
      const deltaCommit = chain[i];

      // Read the delta file from disk
      const deltaBuffer = await this.fileStorage.readDeltaFile(filePath, deltaCommit.id);
      if (deltaBuffer === null) {
        throw new Error(
          `Reconstruction failed: delta file missing for commit ${deltaCommit.id} ` +
          `(step ${i} of ${chain.length - 1} in delta chain). ` +
          `Expected delta file at ${this.fileStorage.getDeltaFilePath(filePath, deltaCommit.id)}`
        );
      }

      // Verify we have an expected hash for integrity checking
      if (!deltaCommit.fullHash) {
        throw new Error(
          `Reconstruction failed: commit ${deltaCommit.id} is stored as a delta ` +
          `but has no fullHash for integrity verification. The tree.json may be corrupt.`
        );
      }

      // Apply the delta via the worker pool (includes SHA-256 verification)
      try {
        currentBuffer = await this.workerPool.applyDelta(
          currentBuffer,
          deltaBuffer,
          deltaCommit.fullHash
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Reconstruction failed: error applying delta for commit ${deltaCommit.id} ` +
          `(step ${i} of ${chain.length - 1} in delta chain): ${message}`
        );
      }
    }

    return currentBuffer;
  }

  /**
   * Read a commit file, reconstructing from deltas if necessary.
   * This is the primary entry point for getting a commit's .3dm data.
   *
   * @param filePath Path to the .3dm project file
   * @param commitId The commit to read
   * @param treeData The current tree.json data
   * @returns The full .3dm ArrayBuffer, or null if the commit is not found in tree data
   */
  async readCommitFile(
    filePath: string,
    commitId: string,
    treeData: TreeData
  ): Promise<ArrayBuffer | null> {
    if (this.isSnapshot(commitId, treeData)) {
      const commit = treeData.commits.find(c => c.id === commitId);
      return this.fileStorage.readCommitFile(filePath, commitId, commit?.originalFormat);
    }
    return this.reconstructCommit(filePath, commitId, treeData);
  }

  /**
   * Build an ordered delta chain from the nearest keyframe to the target commit.
   * Returns an array where [0] is the keyframe and [last] is the target.
   *
   * Walks from the target commit back through baseCommitId references
   * until it finds a snapshot (keyframe).
   *
   * @throws If the chain is broken (missing commits or circular references)
   */
  private buildDeltaChain(targetCommitId: string, treeData: TreeData): TreeCommitData[] {
    const commitMap = new Map<string, TreeCommitData>();
    for (const commit of treeData.commits) {
      commitMap.set(commit.id, commit);
    }

    const chain: TreeCommitData[] = [];
    const visited = new Set<string>();
    let currentId: string | undefined = targetCommitId;

    while (currentId) {
      // Circular reference check
      if (visited.has(currentId)) {
        throw new Error(
          `Reconstruction failed: circular reference detected in delta chain. ` +
          `Commit ${currentId} was visited twice. Chain so far: ` +
          `[${chain.map(c => c.id).join(' -> ')}]`
        );
      }
      visited.add(currentId);

      const commit = commitMap.get(currentId);
      if (!commit) {
        throw new Error(
          `Reconstruction failed: commit ${currentId} not found in tree data. ` +
          `Delta chain is broken. Chain so far: [${chain.map(c => c.id).join(' -> ')}]`
        );
      }

      // Add to the front of the chain (we're walking backward)
      chain.unshift(commit);

      // If this commit is a snapshot (or has no storageType), it's our keyframe
      if (!commit.storageType || commit.storageType === 'snapshot') {
        break;
      }

      // Otherwise, follow the baseCommitId to continue up the chain
      if (!commit.baseCommitId) {
        throw new Error(
          `Reconstruction failed: commit ${commit.id} has storageType 'delta' ` +
          `but no baseCommitId. The tree.json may be corrupt.`
        );
      }

      currentId = commit.baseCommitId;
    }

    // Verify the chain starts with a keyframe
    if (chain.length === 0) {
      throw new Error(
        `Reconstruction failed: empty delta chain for commit ${targetCommitId}.`
      );
    }

    const keyframe = chain[0];
    if (keyframe.storageType === 'delta') {
      throw new Error(
        `Reconstruction failed: delta chain for commit ${targetCommitId} ` +
        `does not reach a keyframe. The chain starts with delta commit ${keyframe.id}. ` +
        `A keyframe commit may have been deleted.`
      );
    }

    return chain;
  }
}
