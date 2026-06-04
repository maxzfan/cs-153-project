import { projectAPI, CloudProject } from './project-api';
import { getAuthHeaders } from './auth-utils';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

export interface RemoteCommitInfo {
  id: string;
  message: string;
  timestamp: number;
  parentCommitId: string | null;
  branchId: string;
  starred: boolean;
  authorId?: string;
  authorEmail?: string;
  // Delta-compression fields (already persisted locally, carry through to cloud)
  storageType?: 'snapshot' | 'delta';
  baseCommitId?: string;
  fullHash?: string;
  deltaChainLength?: number;
  // Dual-artifact fields (tree.json v1.1). Absent = legacy '.3dm' original, no derivative.
  originalFormat?: '.3dm' | '.rvt' | '.ifc';
  derivativeStatus?: 'present' | 'missing';
  derivativeSize?: number;
}

export interface RemoteBranchInfo {
  id: string;
  name: string;
  headCommitId: string;
  color: string;
  isMain: boolean;
  parentBranchId?: string;
  originCommitId?: string;
}

export interface RemoteTreeData {
  version: string;
  activeBranchId: string | null;
  currentCommitId: string | null;
  previouslyWorkingBranchId?: string | null;
  branches: RemoteBranchInfo[];
  commits: RemoteCommitInfo[];
  cloudSyncedCommitIds: string[];
  derivativeSyncedCommitIds?: string[];
}

/**
 * Map storageType → original-artifact extension. Derivative (.glb) is handled separately.
 */
function originalExtensionFor(storageType: 'snapshot' | 'delta' | undefined, originalFormat: RemoteCommitInfo['originalFormat']): string {
  if (storageType === 'delta') return '.delta';
  return originalFormat ?? '.3dm';
}

export interface SyncStatus {
  localOnly: string[];
  remoteOnly: string[];
  synced: string[];
}

// Local storage helpers for mapping cloud projects to local file paths (per-user)
function getCloudPathsKey(userId: string): string {
  return `0studio_cloud_paths_${userId}`;
}

function getSeenProjectsKey(userId: string): string {
  return `0studio_seen_shared_projects_${userId}`;
}

export function getCloudProjectPaths(userId: string): Record<string, string> {
  try {
    const stored = localStorage.getItem(getCloudPathsKey(userId));
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export function setCloudProjectPath(userId: string, projectId: string, localPath: string): void {
  const paths = getCloudProjectPaths(userId);
  paths[projectId] = localPath;
  localStorage.setItem(getCloudPathsKey(userId), JSON.stringify(paths));
}

export function getLocalPathForProject(userId: string, projectId: string): string | null {
  const paths = getCloudProjectPaths(userId);
  return paths[projectId] || null;
}

export function findProjectIdByLocalPath(userId: string, localPath: string): string | null {
  const paths = getCloudProjectPaths(userId);
  for (const [projectId, path] of Object.entries(paths)) {
    if (path === localPath) return projectId;
  }
  return null;
}

export function getSeenSharedProjectIds(userId: string): string[] {
  try {
    const stored = localStorage.getItem(getSeenProjectsKey(userId));
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function markProjectAsSeen(userId: string, projectId: string): void {
  const seen = getSeenSharedProjectIds(userId);
  if (!seen.includes(projectId)) {
    seen.push(projectId);
    localStorage.setItem(getSeenProjectsKey(userId), JSON.stringify(seen));
  }
}

class CloudSyncService {
  /**
   * Resolve a local file path to its cloud project. Returns null if not registered.
   */
  async getCloudProject(filePath: string): Promise<CloudProject | null> {
    return projectAPI.getProjectByFilePath(filePath);
  }

  /**
   * Get a presigned upload URL for a project file.
   */
  async getPushUrl(projectId: string, fileKey: string): Promise<{ upload_url: string; s3_key: string }> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BACKEND_URL}/api/projects/${projectId}/sync/push-url`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ file_key: fileKey }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      const err = new Error(errorData.error || 'Failed to get push URL') as Error & { status: number; errorData: Record<string, unknown> };
      err.status = response.status;
      err.errorData = errorData;
      throw err;
    }

    return response.json();
  }

  /**
   * Get a presigned download URL for a project file.
   */
  async getPullUrl(projectId: string, fileKey: string): Promise<{ download_url: string; s3_key: string }> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BACKEND_URL}/api/projects/${projectId}/sync/pull-url`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ file_key: fileKey }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || 'Failed to get pull URL');
    }

    return response.json();
  }

  /**
   * List all files synced for a project.
   */
  async listRemoteFiles(projectId: string): Promise<{ file_key: string; size: number; lastModified: string }[]> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BACKEND_URL}/api/projects/${projectId}/sync/list`, {
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || 'Failed to list remote files');
    }

    const data = await response.json();
    return data.files;
  }

  /**
   * Upload a file buffer to S3 via presigned URL.
   */
  async uploadFile(uploadUrl: string, data: ArrayBuffer | string): Promise<void> {
    const body = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      body,
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }
  }

  /**
   * Download a file from S3 via presigned URL as ArrayBuffer.
   */
  async downloadFile(downloadUrl: string): Promise<ArrayBuffer> {
    const response = await fetch(downloadUrl);

    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`);
    }

    return response.arrayBuffer();
  }

  /**
   * Download text content from S3 via presigned URL.
   */
  async downloadText(downloadUrl: string): Promise<string> {
    const response = await fetch(downloadUrl);

    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`);
    }

    return response.text();
  }

  /**
   * Push tree.json to the cloud (legacy — uses presigned URL, no conflict detection).
   */
  async pushTreeJson(projectId: string, treeData: RemoteTreeData): Promise<void> {
    const { upload_url } = await this.getPushUrl(projectId, 'tree.json');
    await this.uploadFile(upload_url, JSON.stringify(treeData, null, 2));
  }

  /**
   * Push tree.json directly through the backend with optimistic locking.
   * If expectedETag doesn't match the current S3 ETag, throws with status 409.
   */
  async pushTreeJsonDirect(projectId: string, treeData: RemoteTreeData, expectedETag: string | null): Promise<{ etag: string }> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BACKEND_URL}/api/projects/${projectId}/sync/push-tree`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ treeData, expectedETag }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      const err = new Error(errorData.error || 'Failed to push tree.json') as Error & { status: number; errorData: Record<string, unknown> };
      err.status = response.status;
      err.errorData = errorData;
      throw err;
    }

    return response.json();
  }

  /**
   * Get the current ETag for tree.json without downloading it.
   */
  async getTreeETag(projectId: string): Promise<string | null> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BACKEND_URL}/api/projects/${projectId}/sync/tree-etag`, {
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || 'Failed to get tree ETag');
    }

    const data = await response.json();
    return data.etag;
  }

  /**
   * Pull tree.json from the cloud. Returns null if not found.
   */
  async pullTreeJson(projectId: string): Promise<RemoteTreeData | null> {
    try {
      const { download_url } = await this.getPullUrl(projectId, 'tree.json');
      const text = await this.downloadText(download_url);
      return JSON.parse(text) as RemoteTreeData;
    } catch (error: any) {
      if (error.message?.includes('not found') || error.message?.includes('404') || error.message?.includes('NoSuchKey')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Push a single commit original file (.3dm / .delta / .rvt / .ifc) to the cloud.
   * @param storageType 'delta' uses .delta extension; otherwise uses originalFormat (defaulting to .3dm)
   * @param originalFormat extension for snapshot commits on non-.3dm formats (.rvt, .ifc)
   */
  async pushCommitFile(
    projectId: string,
    commitId: string,
    fileBuffer: ArrayBuffer,
    storageType?: 'snapshot' | 'delta',
    originalFormat?: RemoteCommitInfo['originalFormat'],
  ): Promise<void> {
    const ext = originalExtensionFor(storageType, originalFormat);
    const fileKey = `commits/${commitId}${ext}`;
    const { upload_url } = await this.getPushUrl(projectId, fileKey);
    await this.uploadFile(upload_url, fileBuffer);
  }

  /**
   * Pull a single commit original file (.3dm / .delta / .rvt / .ifc) from the cloud.
   */
  async pullCommitFile(
    projectId: string,
    commitId: string,
    storageType?: 'snapshot' | 'delta',
    originalFormat?: RemoteCommitInfo['originalFormat'],
  ): Promise<ArrayBuffer> {
    const ext = originalExtensionFor(storageType, originalFormat);
    const fileKey = `commits/${commitId}${ext}`;
    const { download_url } = await this.getPullUrl(projectId, fileKey);
    return this.downloadFile(download_url);
  }

  /**
   * Push the glTF derivative (.glb) for a commit. Always standalone, never delta-compressed.
   * Kept separate from pushCommitFile so callers can track original vs. derivative sync
   * independently via Promise.allSettled.
   */
  async pushDerivativeFile(projectId: string, commitId: string, derivativeBuffer: ArrayBuffer): Promise<void> {
    const fileKey = `commits/${commitId}.glb`;
    const { upload_url } = await this.getPushUrl(projectId, fileKey);
    await this.uploadFile(upload_url, derivativeBuffer);
  }

  /**
   * Pull the glTF derivative (.glb) for a commit.
   */
  async pullDerivativeFile(projectId: string, commitId: string): Promise<ArrayBuffer> {
    const fileKey = `commits/${commitId}.glb`;
    const { download_url } = await this.getPullUrl(projectId, fileKey);
    return this.downloadFile(download_url);
  }

  /**
   * Compare local commits with remote to determine sync status.
   */
  computeSyncStatus(localCommitIds: string[], cloudSyncedIds: string[], remoteCommitIds: string[]): SyncStatus {
    const localSet = new Set(localCommitIds);
    const remoteSet = new Set(remoteCommitIds);
    const syncedSet = new Set(cloudSyncedIds);

    return {
      localOnly: localCommitIds.filter(id => !syncedSet.has(id)),
      remoteOnly: remoteCommitIds.filter(id => !localSet.has(id)),
      synced: localCommitIds.filter(id => syncedSet.has(id) && remoteSet.has(id)),
    };
  }

  /**
   * Download the latest commit for a project (for first-time pull).
   * Uses the commit's storageType + originalFormat to pick the right extension — fixes a
   * pre-existing bug where delta commits were downloaded with a .3dm extension and
   * silently corrupted.
   */
  async downloadLatestSnapshot(projectId: string): Promise<{
    treeData: RemoteTreeData;
    latestCommitId: string;
    commitBuffer: ArrayBuffer;
    derivativeBuffer: ArrayBuffer | null;
  } | null> {
    const treeData = await this.pullTreeJson(projectId);
    if (!treeData) return null;

    const activeBranch = treeData.branches.find(b => b.id === treeData.activeBranchId);
    if (!activeBranch?.headCommitId) return null;

    const latestCommitId = activeBranch.headCommitId;
    const latestCommit = treeData.commits.find(c => c.id === latestCommitId);

    const commitBuffer = await this.pullCommitFile(
      projectId,
      latestCommitId,
      latestCommit?.storageType,
      latestCommit?.originalFormat,
    );

    // Derivative is best-effort: never block the initial snapshot pull on a missing .glb.
    let derivativeBuffer: ArrayBuffer | null = null;
    if (latestCommit?.derivativeStatus === 'present') {
      try {
        derivativeBuffer = await this.pullDerivativeFile(projectId, latestCommitId);
      } catch {
        derivativeBuffer = null;
      }
    }

    return { treeData, latestCommitId, commitBuffer, derivativeBuffer };
  }

  /**
   * Download the full project: tree.json + every commit original + every available derivative.
   *
   * Preview-first ordering: within each batch we launch derivative and original fetches
   * in parallel (Promise.allSettled) so a team member can view commits as soon as each
   * .glb lands, even if the bigger originals are still downloading.
   *
   * Calls onProgress(downloaded, total) for each original commit that lands so the UI can
   * report sensible status (originals are what block working-file restore).
   */
  async downloadFullProject(
    projectId: string,
    onProgress?: (downloaded: number, total: number) => void,
  ): Promise<{
    treeData: RemoteTreeData;
    commitBuffers: Map<string, ArrayBuffer>;
    derivativeBuffers: Map<string, ArrayBuffer>;
    missingDerivativeIds: Set<string>;
  } | null> {
    const treeData = await this.pullTreeJson(projectId);
    if (!treeData) return null;

    const commitBuffers = new Map<string, ArrayBuffer>();
    const derivativeBuffers = new Map<string, ArrayBuffer>();
    const missingDerivativeIds = new Set<string>();
    let downloaded = 0;
    const total = treeData.commits.length;

    const BATCH_SIZE = 4;
    for (let i = 0; i < treeData.commits.length; i += BATCH_SIZE) {
      const batch = treeData.commits.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (commit) => {
          const originalPromise = this.pullCommitFile(
            projectId,
            commit.id,
            commit.storageType,
            commit.originalFormat,
          );
          const derivativePromise = commit.derivativeStatus === 'present'
            ? this.pullDerivativeFile(projectId, commit.id)
            : Promise.reject(new Error('no derivative'));

          const [originalResult, derivativeResult] = await Promise.allSettled([
            originalPromise,
            derivativePromise,
          ]);

          if (originalResult.status === 'fulfilled') {
            commitBuffers.set(commit.id, originalResult.value);
          }
          if (derivativeResult.status === 'fulfilled') {
            derivativeBuffers.set(commit.id, derivativeResult.value);
          } else if (commit.derivativeStatus === 'present') {
            // Server said it was present but we couldn't fetch — fall back to missing.
            missingDerivativeIds.add(commit.id);
          }

          downloaded++;
          onProgress?.(downloaded, total);
        }),
      );
    }

    return { treeData, commitBuffers, derivativeBuffers, missingDerivativeIds };
  }
}

export const cloudSyncService = new CloudSyncService();
