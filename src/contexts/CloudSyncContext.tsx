import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import { desktopAPI } from "@/lib/desktop-api";
import { toast } from "sonner";
import { cloudSyncService, type RemoteTreeData, type RemoteCommitInfo, type SyncStatus, findProjectIdByLocalPath, setCloudProjectPath } from "@/lib/cloud-sync-service";
import { projectAPI, type CloudProject } from "@/lib/project-api";
import { supabase } from "@/lib/supabase";
import { useVersionControl, type ModelCommit, type Branch } from "@/contexts/VersionControlContext";
import { usePresence } from '@/contexts/PresenceContext';
import { features } from '@/lib/features';

interface CloudSyncContextType {
  cloudProject: CloudProject | null;
  cloudSyncedCommitIds: Set<string>;
  // Parallel to cloudSyncedCommitIds: which commits have an uploaded .glb derivative.
  // A commit may be in cloudSyncedCommitIds but NOT here if its derivative upload failed
  // (or never ran because derivativeStatus is 'missing').
  derivativeSyncedCommitIds: Set<string>;
  cloudSyncStatus: SyncStatus | null;
  isCloudSyncing: boolean;
  pushToCloud: () => Promise<void>;
  pullFromCloud: () => Promise<void>;
  refreshCloudStatus: () => Promise<void>;
}

const CloudSyncContext = createContext<CloudSyncContextType | undefined>(undefined);

interface CloudSyncProviderProps {
  children: ReactNode;
}

export const CloudSyncProvider: React.FC<CloudSyncProviderProps> = ({ children }) => {
  const {
    currentModel,
    commits,
    branches,
    activeBranchId,
    currentCommitId,
    previouslyWorkingBranchId,
    setCommits,
    setBranches,
    cloudSyncedCommitIdsRef,
    setCloudSyncedCommitIdsExternal,
    derivativeSyncedCommitIdsRef,
    setDerivativeSyncedCommitIdsExternal,
  } = useVersionControl();

  const { joinProject, leaveProject, updatePushingState } = usePresence();

  // Cloud sync state
  const [cloudProject, setCloudProject] = useState<CloudProject | null>(null);
  const [cloudSyncedCommitIds, setCloudSyncedCommitIds] = useState<Set<string>>(new Set());
  const [derivativeSyncedCommitIds, setDerivativeSyncedCommitIds] = useState<Set<string>>(new Set());
  const [cloudSyncStatus, setCloudSyncStatus] = useState<SyncStatus | null>(null);
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  const lastKnownTreeETag = useRef<string | null>(null);
  const isSyncingRef = useRef(false);

  // Keep the ref in VersionControlContext in sync so saveTreeFile can use it
  useEffect(() => {
    cloudSyncedCommitIdsRef.current = cloudSyncedCommitIds;
    setCloudSyncedCommitIdsExternal(cloudSyncedCommitIds);
  }, [cloudSyncedCommitIds, cloudSyncedCommitIdsRef, setCloudSyncedCommitIdsExternal]);

  useEffect(() => {
    derivativeSyncedCommitIdsRef.current = derivativeSyncedCommitIds;
    setDerivativeSyncedCommitIdsExternal(derivativeSyncedCommitIds);
  }, [derivativeSyncedCommitIds, derivativeSyncedCommitIdsRef, setDerivativeSyncedCommitIdsExternal]);

  // Auto-detect cloud project when model changes
  useEffect(() => {
    if (!currentModel) {
      setCloudProject(null);
      setCloudSyncStatus(null);
      setCloudSyncedCommitIds(new Set());
      setDerivativeSyncedCommitIds(new Set());
      return;
    }
  }, [currentModel]);

  // Detect cloud project in background when model is loaded
  // This replaces the inline async IIFE that was in setCurrentModel
  useEffect(() => {
    if (!currentModel) return;

    let cancelled = false;

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;

        // Check localStorage mapping first
        if (userId) {
          const mappedProjectId = findProjectIdByLocalPath(userId, currentModel);
          if (mappedProjectId) {
            const allProjects = await projectAPI.getUserProjects();
            const proj = allProjects.find(p => p.id === mappedProjectId);
            if (proj && !cancelled) {
              setCloudProject(proj);
              return;
            }
          }
        }

        // Fall back to file path match (owner's original path)
        const proj = await projectAPI.getProjectByFilePath(currentModel);
        if (proj && !cancelled) {
          setCloudProject(proj);
          // Also save mapping for future lookups
          if (userId) setCloudProjectPath(userId, proj.id, currentModel);
        }
      } catch {
        // Not cloud-enabled, that's fine
      }
    })();

    return () => { cancelled = true; };
  }, [currentModel]);

  // Initialize ETag when cloud project is detected so first push has conflict detection
  useEffect(() => {
    if (!cloudProject) { lastKnownTreeETag.current = null; return; }
    cloudSyncService.getTreeETag(cloudProject.id).then(etag => {
      lastKnownTreeETag.current = etag;
    }).catch(() => {});
  }, [cloudProject]);

  // Restore cloud synced commit IDs from tree data when model loads
  // This is triggered by VersionControlContext setting initialCloudSyncedCommitIds
  const { initialCloudSyncedCommitIds, initialDerivativeSyncedCommitIds } = useVersionControl();
  useEffect(() => {
    if (initialCloudSyncedCommitIds && initialCloudSyncedCommitIds.length > 0) {
      const syncedSet = new Set(initialCloudSyncedCommitIds);
      setCloudSyncedCommitIds(syncedSet);
    }
  }, [initialCloudSyncedCommitIds]);

  useEffect(() => {
    if (initialDerivativeSyncedCommitIds && initialDerivativeSyncedCommitIds.length > 0) {
      setDerivativeSyncedCommitIds(new Set(initialDerivativeSyncedCommitIds));
    }
  }, [initialDerivativeSyncedCommitIds]);

  // Join/leave presence channel when cloudProject changes
  useEffect(() => {
    if (!features.team) return;
    if (cloudProject?.id) {
      joinProject(cloudProject.id);
    } else {
      leaveProject();
    }
    return () => leaveProject();
  }, [cloudProject?.id, joinProject, leaveProject]);

  const refreshCloudStatus = useCallback(async () => {
    if (!cloudProject) return;

    try {
      const remoteTree = await cloudSyncService.pullTreeJson(cloudProject.id);
      const remoteCommitIds = remoteTree?.commits?.map(c => c.id) || [];
      const localCommitIds = commits.map(c => c.id);
      const status = cloudSyncService.computeSyncStatus(
        localCommitIds,
        Array.from(cloudSyncedCommitIdsRef.current),
        remoteCommitIds
      );
      setCloudSyncStatus(status);
    } catch {
      // Silent catch
    }
  }, [cloudProject, commits, cloudSyncedCommitIdsRef]);

  const pushToCloud = useCallback(async () => {
    if (!cloudProject || !currentModel) {
      toast.error('Project is not cloud-enabled. Enable collaboration in Settings first.');
      return;
    }
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;

    setIsCloudSyncing(true);
    updatePushingState(true).catch(() => {}); // broadcast push-in-progress (non-blocking)
    try {
      // Pre-flight ETag check: detect conflicts before uploading commit files
      const currentETag = await cloudSyncService.getTreeETag(cloudProject.id);
      if (lastKnownTreeETag.current !== null && currentETag !== lastKnownTreeETag.current) {
        toast.error('Someone else pushed changes. Pull to get the latest before pushing again.');
        return;
      }

      // Originals that need upload: any commit not already marked as cloud-synced.
      const unsyncedCommitIds = commits
        .map(c => c.id)
        .filter(id => !cloudSyncedCommitIdsRef.current.has(id));

      // Derivatives that need upload: any commit claiming a local .glb but not yet
      // cloud-synced as a derivative. Tracked independently so a failed .glb retries
      // without re-uploading the (much larger) original. Only considered for commits
      // that have a derivative locally — commits with derivativeStatus='missing' are
      // skipped entirely (placeholder in viewer).
      const unsyncedDerivativeIds = commits
        .filter(c => c.derivativeStatus === 'present' && !derivativeSyncedCommitIdsRef.current.has(c.id))
        .map(c => c.id);

      // Tracking sets for this push — we only mutate committed state after the tree.json
      // write succeeds so we don't end up recording uploads whose index write was lost.
      const uploadedOriginalIds = new Set<string>();
      const uploadedDerivativeIds = new Set<string>();
      const failedOriginalIds: string[] = [];
      const failedDerivativeIds: string[] = [];

      if (unsyncedCommitIds.length > 0 || unsyncedDerivativeIds.length > 0) {
        const unionCount = new Set([...unsyncedCommitIds, ...unsyncedDerivativeIds]).size;
        toast.info(`Pushing ${unionCount} commit(s) to cloud...`);

        // Walk every commit that needs either artifact. Running original + derivative
        // uploads per-commit in parallel via Promise.allSettled means a transient .glb
        // failure never blocks the original, and vice versa.
        const allCommitsToTouch = Array.from(new Set([...unsyncedCommitIds, ...unsyncedDerivativeIds]));
        for (const commitId of allCommitsToTouch) {
          const commit = commits.find(c => c.id === commitId);
          if (!commit) continue;
          const storageType = commit.storageType;
          const originalFormat = commit.originalFormat;

          // Only upload the original if this commit hasn't already been synced.
          let originalPromise: Promise<void> | null = null;
          if (unsyncedCommitIds.includes(commitId)) {
            originalPromise = (async () => {
              let fileBuffer: ArrayBuffer | null = null;
              if (desktopAPI.isDesktop) {
                if (storageType === 'delta') {
                  fileBuffer = await desktopAPI.readDeltaFile(currentModel, commitId);
                } else {
                  fileBuffer = await desktopAPI.readCommitFile(currentModel, commitId);
                }
              }
              // Fall back to in-memory buffer (snapshot only — deltas are only on disk)
              if (!fileBuffer && storageType !== 'delta' && commit.fileBuffer) {
                fileBuffer = commit.fileBuffer;
              }
              if (!fileBuffer) {
                throw new Error('original buffer unavailable');
              }
              await cloudSyncService.pushCommitFile(cloudProject.id, commitId, fileBuffer, storageType, originalFormat);
            })();
          }

          // Only upload the derivative if locally present and not already synced.
          let derivativePromise: Promise<void> | null = null;
          if (unsyncedDerivativeIds.includes(commitId)) {
            derivativePromise = (async () => {
              if (!desktopAPI.isDesktop) throw new Error('derivative upload requires desktop');
              const derivativeBuffer = await desktopAPI.readDerivativeFile(currentModel, commitId);
              if (!derivativeBuffer) {
                throw new Error('derivative buffer missing on disk');
              }
              await cloudSyncService.pushDerivativeFile(cloudProject.id, commitId, derivativeBuffer);
            })();
          }

          const [originalResult, derivativeResult] = await Promise.allSettled([
            originalPromise ?? Promise.resolve(),
            derivativePromise ?? Promise.resolve(),
          ]);

          // Re-raise subscription_required so the outer catch surfaces it as an upgrade prompt.
          for (const result of [originalResult, derivativeResult]) {
            if (result.status === 'rejected') {
              const e = result.reason as Error & { status?: number; errorData?: Record<string, unknown> };
              if (e?.status === 403 && e?.errorData?.error === 'subscription_required') {
                throw result.reason;
              }
            }
          }

          if (originalPromise) {
            if (originalResult.status === 'fulfilled') uploadedOriginalIds.add(commitId);
            else failedOriginalIds.push(commitId);
          }
          if (derivativePromise) {
            if (derivativeResult.status === 'fulfilled') uploadedDerivativeIds.add(commitId);
            else failedDerivativeIds.push(commitId);
          }
        }

        if (failedOriginalIds.length > 0) {
          toast.warning(`${failedOriginalIds.length} version(s) could not be uploaded — they will be retried on next push`);
        }
        if (failedDerivativeIds.length > 0) {
          toast.warning(`${failedDerivativeIds.length} preview(s) could not be uploaded — teammates will regenerate locally`);
        }
      }

      // Merge newly-uploaded IDs into the persistent sync sets. These are captured into
      // const snapshots so the tree.json we push and the state we commit agree even if
      // another push races behind us.
      const newSynced = new Set(cloudSyncedCommitIdsRef.current);
      uploadedOriginalIds.forEach(id => newSynced.add(id));
      const newDerivativeSynced = new Set(derivativeSyncedCommitIdsRef.current);
      uploadedDerivativeIds.forEach(id => newDerivativeSynced.add(id));

      // Push tree.json with optimistic locking (v1.1 schema with dual-artifact fields).
      const treeData: RemoteTreeData = {
        version: '1.1',
        activeBranchId,
        currentCommitId,
        previouslyWorkingBranchId,
        cloudSyncedCommitIds: Array.from(newSynced),
        derivativeSyncedCommitIds: Array.from(newDerivativeSynced),
        branches: branches.map(b => ({
          id: b.id,
          name: b.name,
          headCommitId: b.headCommitId,
          color: b.color,
          isMain: b.isMain,
          parentBranchId: b.parentBranchId,
          originCommitId: b.originCommitId,
        })),
        commits: commits.map(c => {
          const commitData: RemoteCommitInfo = {
            id: c.id,
            message: c.message,
            timestamp: c.timestamp,
            parentCommitId: c.parentCommitId ?? null,
            branchId: c.branchId,
            starred: c.starred || false,
          };
          if (c.storageType) commitData.storageType = c.storageType;
          if (c.baseCommitId) commitData.baseCommitId = c.baseCommitId;
          if (c.fullHash) commitData.fullHash = c.fullHash;
          if (c.deltaChainLength != null) commitData.deltaChainLength = c.deltaChainLength;
          if (c.authorId) commitData.authorId = c.authorId;
          if (c.authorEmail) commitData.authorEmail = c.authorEmail;
          // Dual-artifact fields. derivativeStatus only serialized when 'present' — the
          // backend allowlist-validates these values so an injected '.delta/../../' would
          // be rejected at push time.
          if (c.originalFormat) commitData.originalFormat = c.originalFormat;
          if (c.derivativeStatus === 'present') commitData.derivativeStatus = 'present';
          if (c.derivativeSize != null) commitData.derivativeSize = c.derivativeSize;
          return commitData;
        }),
      };

      try {
        const { etag } = await cloudSyncService.pushTreeJsonDirect(cloudProject.id, treeData, lastKnownTreeETag.current);
        lastKnownTreeETag.current = etag;
      } catch (pushError: unknown) {
        const err = pushError as Error & { status?: number; errorData?: Record<string, unknown> };
        if (err.status === 409 || err.errorData?.error === 'conflict') {
          toast.error('Someone else pushed changes. Pull to get the latest before pushing again.');
          return;
        }
        throw pushError;
      }

      // Only commit the new sync sets AFTER tree.json landed — otherwise a tree-push
      // conflict would leave local state claiming artifacts are synced that the index
      // doesn't reflect.
      setCloudSyncedCommitIds(newSynced);
      setDerivativeSyncedCommitIds(newDerivativeSynced);

      // Refresh status
      await refreshCloudStatus();

      if (unsyncedCommitIds.length > 0) {
        toast.success(`Pushed ${unsyncedCommitIds.length} commit(s) to cloud`);
      } else {
        toast.success('Cloud sync updated');
      }
    } catch (error: unknown) {
      const err = error as Error & { status?: number; errorData?: Record<string, unknown> };
      if (err.status === 403 && (err.errorData?.error === 'subscription_required' || err.message === 'subscription_required')) {
        toast.error('An active subscription is required to push to cloud. Upgrade on the Dashboard.');
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to push to cloud');
      }
    } finally {
      setIsCloudSyncing(false);
      isSyncingRef.current = false;
      updatePushingState(false).catch(() => {}); // clear push-in-progress broadcast
    }
  }, [cloudProject, currentModel, commits, branches, activeBranchId, currentCommitId, previouslyWorkingBranchId, refreshCloudStatus, cloudSyncedCommitIdsRef, derivativeSyncedCommitIdsRef, updatePushingState]);

  const pullFromCloud = useCallback(async () => {
    if (!cloudProject || !currentModel) {
      toast.error('Project is not cloud-enabled. Enable collaboration in Settings first.');
      return;
    }
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;

    setIsCloudSyncing(true);
    try {
      const remoteTree = await cloudSyncService.pullTreeJson(cloudProject.id);
      if (!remoteTree) {
        toast.info('No cloud data found for this project');
        setIsCloudSyncing(false);
        return;
      }

      const localCommitIds = new Set(commits.map(c => c.id));
      const remoteOnlyCommitIds = remoteTree.commits
        .map(c => c.id)
        .filter(id => !localCommitIds.has(id));

      if (remoteOnlyCommitIds.length === 0) {
        toast.info('Already up to date');
        setIsCloudSyncing(false);
        return;
      }

      toast.info(`Pulling ${remoteOnlyCommitIds.length} commit(s) from cloud...`);

      // Preview-first pull: for each remote commit, fetch derivative (.glb) and original
      // in parallel via Promise.allSettled. The derivative is typically much smaller and
      // unblocks the viewer before the full original lands. A failed derivative downgrades
      // the local commit to derivativeStatus='missing' without blocking the original.
      const landedDerivativeIds = new Set<string>();
      for (const commitId of remoteOnlyCommitIds) {
        const remoteCommit = remoteTree.commits.find(c => c.id === commitId);
        if (!remoteCommit) continue;
        const storageType = remoteCommit.storageType;
        const originalFormat = remoteCommit.originalFormat;

        const originalPromise = cloudSyncService.pullCommitFile(cloudProject.id, commitId, storageType, originalFormat);
        const derivativePromise = remoteCommit.derivativeStatus === 'present'
          ? cloudSyncService.pullDerivativeFile(cloudProject.id, commitId)
          : Promise.reject(new Error('no derivative'));

        const [originalResult, derivativeResult] = await Promise.allSettled([
          originalPromise,
          derivativePromise,
        ]);

        if (originalResult.status === 'fulfilled' && desktopAPI.isDesktop) {
          try {
            if (storageType === 'delta') {
              await desktopAPI.saveDeltaFile(currentModel, commitId, originalResult.value);
            } else {
              await desktopAPI.saveCommitFile(currentModel, commitId, originalResult.value);
            }
          } catch {
            // Silent catch — a failed local write will re-manifest on next pull.
          }
        }

        if (derivativeResult.status === 'fulfilled' && desktopAPI.isDesktop) {
          try {
            await desktopAPI.saveDerivativeFile(currentModel, commitId, derivativeResult.value);
            landedDerivativeIds.add(commitId);
          } catch {
            // Silent catch — viewer will fall back to original loading path.
          }
        }
      }

      // Merge remote commits and branches into local state
      const mergedCommitMap = new Map<string, ModelCommit>();
      for (const c of commits) {
        mergedCommitMap.set(c.id, c);
      }
      for (const rc of remoteTree.commits) {
        if (!mergedCommitMap.has(rc.id)) {
          const commitData: ModelCommit = {
            id: rc.id,
            message: rc.message,
            timestamp: rc.timestamp,
            parentCommitId: rc.parentCommitId,
            branchId: rc.branchId,
            starred: rc.starred,
          };
          // Preserve delta compression fields from remote
          if (rc.storageType) commitData.storageType = rc.storageType;
          if (rc.baseCommitId) commitData.baseCommitId = rc.baseCommitId;
          if (rc.fullHash) commitData.fullHash = rc.fullHash;
          if (rc.deltaChainLength != null) commitData.deltaChainLength = rc.deltaChainLength;
          if (rc.authorId) commitData.authorId = rc.authorId;
          if (rc.authorEmail) commitData.authorEmail = rc.authorEmail;
          // Preserve dual-artifact fields. If remote claims derivativeStatus='present'
          // but we never actually got the .glb down (preview-first pull above may have
          // 404'd), treat it as 'missing' locally so the viewer falls back cleanly.
          if (rc.originalFormat === '.3dm' || rc.originalFormat === '.rvt' || rc.originalFormat === '.ifc') {
            commitData.originalFormat = rc.originalFormat;
          }
          if (rc.derivativeStatus === 'present') {
            commitData.derivativeStatus = landedDerivativeIds.has(rc.id) ? 'present' : 'missing';
          } else if (rc.derivativeStatus === 'missing') {
            commitData.derivativeStatus = 'missing';
          }
          if (typeof rc.derivativeSize === 'number') commitData.derivativeSize = rc.derivativeSize;
          mergedCommitMap.set(rc.id, commitData);
        }
      }

      const mergedBranchMap = new Map<string, Branch>();
      for (const b of branches) {
        mergedBranchMap.set(b.id, b);
      }
      for (const rb of remoteTree.branches) {
        if (!mergedBranchMap.has(rb.id)) {
          mergedBranchMap.set(rb.id, {
            id: rb.id,
            name: rb.name,
            headCommitId: rb.headCommitId,
            color: rb.color,
            isMain: rb.isMain,
            parentBranchId: rb.parentBranchId,
            originCommitId: rb.originCommitId,
          });
        } else {
          // Update head if remote head is a descendant of local head (walk parent chain)
          const local = mergedBranchMap.get(rb.id)!;
          if (local.headCommitId !== rb.headCommitId) {
            // Check if remote head descends from local head
            let cursor = rb.headCommitId;
            let remoteIsDescendant = false;
            const visited = new Set<string>();
            while (cursor && !visited.has(cursor)) {
              visited.add(cursor);
              if (cursor === local.headCommitId) { remoteIsDescendant = true; break; }
              const parent = mergedCommitMap.get(cursor);
              cursor = parent?.parentCommitId ?? '';
            }
            if (remoteIsDescendant) {
              mergedBranchMap.set(rb.id, { ...local, headCommitId: rb.headCommitId });
            } else {
              // Neither is ancestor — pick the one with more commits in the chain (fallback)
              const remoteHead = mergedCommitMap.get(rb.headCommitId);
              const localHead = mergedCommitMap.get(local.headCommitId);
              if (remoteHead && localHead && remoteHead.timestamp > localHead.timestamp) {
                mergedBranchMap.set(rb.id, { ...local, headCommitId: rb.headCommitId });
              }
            }
          }
        }
      }

      const mergedCommits = Array.from(mergedCommitMap.values()).sort((a, b) => b.timestamp - a.timestamp);
      const mergedBranches = Array.from(mergedBranchMap.values());

      // Update synced IDs (all remote commits whose original landed are locally available).
      const newSynced = new Set(cloudSyncedCommitIdsRef.current);
      remoteTree.commits.forEach(c => newSynced.add(c.id));
      setCloudSyncedCommitIds(newSynced);

      // Derivative-synced: union of the server's set (if it reported any) with whatever
      // actually landed during this pull. Trusts the server index but self-corrects with
      // what we observed.
      const newDerivativeSynced = new Set(derivativeSyncedCommitIdsRef.current);
      (remoteTree.derivativeSyncedCommitIds ?? []).forEach(id => newDerivativeSynced.add(id));
      landedDerivativeIds.forEach(id => newDerivativeSynced.add(id));
      setDerivativeSyncedCommitIds(newDerivativeSynced);

      setCommits(mergedCommits);
      setBranches(mergedBranches);

      // Refresh sync status
      const allIds = mergedCommits.map(c => c.id);
      const remoteIds = remoteTree.commits.map(c => c.id);
      const status = cloudSyncService.computeSyncStatus(allIds, Array.from(newSynced), remoteIds);
      setCloudSyncStatus(status);

      // Update the ETag after a successful pull so the next push uses the correct baseline
      try {
        lastKnownTreeETag.current = await cloudSyncService.getTreeETag(cloudProject.id);
      } catch {
        // Non-fatal: if we can't get the ETag, the next push will still do its own check
      }

      toast.success(`Pulled ${remoteOnlyCommitIds.length} commit(s) from cloud`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to pull from cloud');
    } finally {
      setIsCloudSyncing(false);
      isSyncingRef.current = false;
    }
  }, [cloudProject, currentModel, commits, branches, setCommits, setBranches, cloudSyncedCommitIdsRef, derivativeSyncedCommitIdsRef]);

  const value: CloudSyncContextType = {
    cloudProject,
    cloudSyncedCommitIds,
    derivativeSyncedCommitIds,
    cloudSyncStatus,
    isCloudSyncing,
    pushToCloud,
    pullFromCloud,
    refreshCloudStatus,
  };

  return (
    <CloudSyncContext.Provider value={value}>
      {children}
    </CloudSyncContext.Provider>
  );
};

export const useCloudSync = (): CloudSyncContextType => {
  const context = useContext(CloudSyncContext);
  if (!context) {
    throw new Error("useCloudSync must be used within a CloudSyncProvider");
  }
  return context;
};
