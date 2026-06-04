import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import { desktopAPI } from "@/lib/desktop-api";
import { LoadedModel } from "./ModelContext";
import { exportModelToBuffer } from "@/lib/rhino3dm-service";
import { getFileBuffer, storeFileBuffer, deleteFileBuffers } from "@/lib/commit-storage";
import { toast } from "sonner";
import { usePresence } from '@/contexts/PresenceContext';
import { useAuth } from '@/contexts/AuthContext';
import { features } from '@/lib/features';

interface ModelCommit {
  id: string;
  message: string;
  timestamp: number;
  modelData?: LoadedModel; // Store the actual model data (for display/restore in UI)
  fileBuffer?: ArrayBuffer; // Store the exact .3dm file buffer (for exact file restoration)
  starred?: boolean; // Whether this commit is starred/favorited
  parentCommitId?: string | null; // Parent commit ID for branching (null for root)
  branchId: string; // Branch this commit belongs to
  // Delta compression fields
  storageType?: 'snapshot' | 'delta'; // absent = snapshot (backward compat)
  baseCommitId?: string; // for deltas: which commit this is a delta against
  fullHash?: string; // SHA-256 of the full reconstructed .3dm
  deltaChainLength?: number; // how many deltas from nearest keyframe
  authorId?: string;
  authorEmail?: string;
  // Dual-artifact fields (tree.json v1.1). Absence = legacy '.3dm' original, no derivative.
  originalFormat?: '.3dm' | '.rvt' | '.ifc';
  derivativeStatus?: 'present' | 'missing';
  derivativeSize?: number;
}

// Tree file schema version. Bump when adding fields older apps would silently strip on save.
const TREE_JSON_VERSION = '1.1';

/**
 * Derive the committed artifact's extension from the project file path. Returns
 * undefined for `.3dm` so we don't bloat tree.json with default values — absence is
 * equivalent to `.3dm` per the v1.1 schema contract.
 */
function originalFormatFromPath(filePath: string | null): '.3dm' | '.rvt' | '.ifc' | undefined {
  if (!filePath) return undefined;
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.rvt')) return '.rvt';
  if (lower.endsWith('.ifc')) return '.ifc';
  return undefined; // .3dm (default) or unknown — caller treats as '.3dm'
}

// Parse 'major.minor' into [major, minor]. Returns null for malformed input.
function parseTreeVersion(v: unknown): [number, number] | null {
  if (typeof v !== 'string') return null;
  const m = v.match(/^(\d+)\.(\d+)$/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10)];
}

// Numeric compare: true if `a` is strictly newer than `b`.
function isNewer(a: [number, number], b: [number, number]): boolean {
  return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
}

// Tracks which project paths have shown the newer-version warning this session, so switching
// back and forth between a newer project and an older project each shows the warning once.
const warnedNewerTreePaths = new Set<string>();

interface Branch {
  id: string;
  name: string;
  headCommitId: string; // Latest commit on this branch
  color: string; // Color for visualization
  parentBranchId?: string; // Parent branch (for branch-off-branch scenarios)
  originCommitId?: string; // Commit this branch was created from
  isMain: boolean; // Whether this is the main/master branch
}

interface VersionControlContextType {
  // Model tracking
  currentModel: string | null;
  modelName: string | null;
  commits: ModelCommit[];
  currentCommitId: string | null;
  hasUnsavedChanges: boolean;
  
  // Branching
  branches: Branch[];
  activeBranchId: string | null;
  pulledCommitId: string | null; // The commit that was last pulled/downloaded (for highlighting)
  
  // Actions
  setCurrentModel: (path: string) => Promise<void>;
  commitModelChanges: (message: string, currentModelData?: LoadedModel, customBranchName?: string) => Promise<void>;
  createInitialCommit: (modelData: LoadedModel, fileBuffer?: ArrayBuffer, filePath?: string) => void | Promise<void>;
  restoreToCommit: (commitId: string) => Promise<boolean>;
  pullFromCommit: (commitId: string) => Promise<boolean>; // Pull commit to local file (updates file on disk)
  markUnsavedChanges: () => void;
  clearUnsavedChanges: () => void;
  clearCurrentModel: () => Promise<void>;
  toggleStarCommit: (commitId: string) => void; // Toggle star status of a commit
  getStarredCommits: () => ModelCommit[]; // Get all starred commits
  
  // Branching actions
  switchBranch: (branchId: string) => void;
  keepBranch: (branchId: string) => void; // Mark a branch as the main/kept branch
  getBranchCommits: (branchId: string) => ModelCommit[];
  getCommitVersionLabel: (commit: ModelCommit) => string; // Get version label like v3a, v3b

  // Build the tree-data payload the main process needs to reconstruct a delta commit.
  // Exposed so other consumers (e.g. gallery preview) can call reconstructCommit themselves.
  buildTreeDataForReconstruction: () => object;
  
  // Internal — exposed for CloudSyncContext
  previouslyWorkingBranchId: string | null;
  cloudSyncedCommitIdsRef: React.MutableRefObject<Set<string>>;
  setCloudSyncedCommitIdsExternal: (ids: Set<string>) => void;
  // Derivative sync is tracked separately from original sync so a failed .glb upload
  // doesn't block re-pushing the original (and vice versa). Parallels cloudSyncedCommitIdsRef.
  derivativeSyncedCommitIdsRef: React.MutableRefObject<Set<string>>;
  setDerivativeSyncedCommitIdsExternal: (ids: Set<string>) => void;
  setCommits: React.Dispatch<React.SetStateAction<ModelCommit[]>>;
  setBranches: React.Dispatch<React.SetStateAction<Branch[]>>;
  initialCloudSyncedCommitIds: string[] | null;
  initialDerivativeSyncedCommitIds: string[] | null;

  // Model restoration callback - will be set by ModelContext
  onModelRestore?: (modelData: LoadedModel) => void;
  setModelRestoreCallback: (callback: (modelData: LoadedModel) => void) => void;
}

const VersionControlContext = createContext<VersionControlContextType | undefined>(undefined);

interface VersionControlProviderProps {
  children: ReactNode;
}

// Branch colors for visualization
const CURRENT_WORKING_BRANCH_COLOR = '#22c55e'; // green
const PREVIOUSLY_WORKING_BRANCH_COLOR = '#ef4444'; // red
const DEFAULT_BRANCH_COLOR = '#737373'; // gray for other branches

export const VersionControlProvider: React.FC<VersionControlProviderProps> = ({ children }) => {
  const { user } = useAuth();
  const [currentModel, setCurrentModelState] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);
  const [commits, setCommits] = useState<ModelCommit[]>([]);
  const [currentCommitId, setCurrentCommitId] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [onModelRestore, setOnModelRestore] = useState<((modelData: LoadedModel) => void) | undefined>(undefined);
  const [isLoadingTree, setIsLoadingTree] = useState(false);
  const [treeLoadPromise, setTreeLoadPromise] = useState<Promise<void> | null>(null);
  
  // Branching state
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [pulledCommitId, setPulledCommitId] = useState<string | null>(null);
  const [previouslyWorkingBranchId, setPreviouslyWorkingBranchId] = useState<string | null>(null);

  // Commit mutex - prevents concurrent commitModelChanges invocations.
  // Exposed via ref so other contexts (e.g. CloudSyncContext) can observe in-progress commits.
  const isCommittingRef = useRef(false);

  // Set when the loaded tree.json was written by a newer app version. While true, we do not
  // write tree.json — overwriting would silently strip fields the newer app wrote.
  const treeJsonReadOnlyRef = useRef(false);

  // Cloud sync: ref kept here for saveTreeFile; state owned by CloudSyncContext
  const cloudSyncedCommitIdsRef = useRef<Set<string>>(new Set());
  const [cloudSyncedCommitIdsState, setCloudSyncedCommitIdsState] = useState<Set<string>>(new Set());
  const setCloudSyncedCommitIdsExternal = useCallback((ids: Set<string>) => {
    setCloudSyncedCommitIdsState(ids);
  }, []);
  // Initial cloud synced IDs loaded from tree.json, for CloudSyncContext to pick up
  const [initialCloudSyncedCommitIds, setInitialCloudSyncedCommitIds] = useState<string[] | null>(null);

  // Derivative sync: separate ref so a missing .glb doesn't imply a missing original
  // (and recovery is per-artifact). Persisted into tree.json as derivativeSyncedCommitIds.
  const derivativeSyncedCommitIdsRef = useRef<Set<string>>(new Set());
  const [derivativeSyncedCommitIdsState, setDerivativeSyncedCommitIdsState] = useState<Set<string>>(new Set());
  const setDerivativeSyncedCommitIdsExternal = useCallback((ids: Set<string>) => {
    setDerivativeSyncedCommitIdsState(ids);
  }, []);
  const [initialDerivativeSyncedCommitIds, setInitialDerivativeSyncedCommitIds] = useState<string[] | null>(null);

  const { updatePresenceCommit } = usePresence();

  const setModelRestoreCallback = useCallback((callback: (modelData: LoadedModel) => void) => {
    setOnModelRestore(() => callback);
  }, []);



  // Helper function to save tree.json file
  const saveTreeFile = useCallback(async (filePath: string) => {
    if (!desktopAPI.isDesktop || !filePath) {
      return; // Silently return if not desktop or no file path
    }

    // Refuse to overwrite a tree.json written by a newer app version.
    // Data-loss prevention for mixed-version teams (plan R9).
    if (treeJsonReadOnlyRef.current) {
      return;
    }

    try {
      const treeData = {
        version: TREE_JSON_VERSION,
        activeBranchId: activeBranchId,
        currentCommitId: currentCommitId,
        previouslyWorkingBranchId: previouslyWorkingBranchId,
        cloudSyncedCommitIds: Array.from(cloudSyncedCommitIdsRef.current),
        derivativeSyncedCommitIds: Array.from(derivativeSyncedCommitIdsRef.current),
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
          const commitData: any = {
            id: c.id,
            message: c.message,
            timestamp: c.timestamp,
            parentCommitId: c.parentCommitId,
            branchId: c.branchId,
            starred: c.starred || false,
          };
          // Persist delta compression fields
          if (c.storageType) commitData.storageType = c.storageType;
          if (c.baseCommitId) commitData.baseCommitId = c.baseCommitId;
          if (c.fullHash) commitData.fullHash = c.fullHash;
          if (c.deltaChainLength != null) commitData.deltaChainLength = c.deltaChainLength;
          if (c.authorId) commitData.authorId = c.authorId;
          if (c.authorEmail) commitData.authorEmail = c.authorEmail;
          // Persist dual-artifact fields. derivativeStatus is only written when 'present' —
          // absence means 'missing', matching the conditional-write pattern for storageType.
          if (c.originalFormat) commitData.originalFormat = c.originalFormat;
          if (c.derivativeStatus === 'present') commitData.derivativeStatus = 'present';
          if (c.derivativeSize != null) commitData.derivativeSize = c.derivativeSize;
          return commitData;
        }),
      };

      await desktopAPI.saveTreeFile(filePath, treeData);
    } catch {
      // Silent catch (non-critical)
    }
  }, [branches, commits, activeBranchId, currentCommitId, previouslyWorkingBranchId]);

  // Helper function to load tree.json file
  const loadTreeFile = useCallback(async (filePath: string): Promise<{ branches: Branch[], commits: ModelCommit[], activeBranchId: string | null, currentCommitId: string | null, previouslyWorkingBranchId: string | null, cloudSyncedCommitIds: string[], derivativeSyncedCommitIds: string[] } | null> => {
    if (!desktopAPI.isDesktop || !filePath) return null;

    try {
      const treeData = await desktopAPI.loadTreeFile(filePath);
      if (!treeData) return null;

      // Warn once per project when the loaded tree was written by a newer app version.
      // Saves from this session would silently strip fields that newer version wrote.
      // The separate `isTreeVersionNewerThanApp` check below gates saveTreeFile itself to
      // avoid actual data loss — this toast just informs the user.
      const loadedVer = parseTreeVersion(treeData.version);
      const appVer = parseTreeVersion(TREE_JSON_VERSION);
      const newerThanApp = !!(loadedVer && appVer && isNewer(loadedVer, appVer));
      treeJsonReadOnlyRef.current = newerThanApp;
      if (newerThanApp && !warnedNewerTreePaths.has(filePath)) {
        warnedNewerTreePaths.add(filePath);
        toast.error(
          `tree.json for this project was saved by a newer 0studio version (${treeData.version}). ` +
          `Edits will not be persisted until you upgrade.`
        );
      }

      // Validate commit files exist
      const commitIds = treeData.commits.map((c: any) => c.id);
      const missingCommitIds = await desktopAPI.validateCommitFiles(filePath, commitIds);

      if (missingCommitIds.length > 0) {
        // Filter out commits with missing files
        treeData.commits = treeData.commits.filter((c: any) => !missingCommitIds.includes(c.id));
      }

      // Convert tree data to Branch and ModelCommit arrays
      const loadedBranches: Branch[] = treeData.branches.map((b: any) => ({
        id: b.id,
        name: b.name,
        headCommitId: b.headCommitId,
        color: b.color,
        isMain: b.isMain,
        parentBranchId: b.parentBranchId,
        originCommitId: b.originCommitId,
      }));

      const loadedCommits: ModelCommit[] = treeData.commits.map((c: any) => {
        const commit: ModelCommit = {
          id: c.id,
          message: c.message,
          timestamp: c.timestamp,
          parentCommitId: c.parentCommitId,
          branchId: c.branchId,
          starred: c.starred || false,
          // Note: modelData and fileBuffer are not stored in tree.json
          // They will be loaded from files when needed
        };
        // Restore delta compression fields
        if (c.storageType) commit.storageType = c.storageType;
        if (c.baseCommitId) commit.baseCommitId = c.baseCommitId;
        if (c.fullHash) commit.fullHash = c.fullHash;
        if (c.deltaChainLength != null) commit.deltaChainLength = c.deltaChainLength;
        if (c.authorId) commit.authorId = c.authorId;
        if (c.authorEmail) commit.authorEmail = c.authorEmail;
        // Restore dual-artifact fields. Allowlist originalFormat against known values so a
        // compromised or edited tree.json can't inject arbitrary strings into path joining.
        if (c.originalFormat === '.3dm' || c.originalFormat === '.rvt' || c.originalFormat === '.ifc') {
          commit.originalFormat = c.originalFormat;
        }
        if (c.derivativeStatus === 'present' || c.derivativeStatus === 'missing') {
          commit.derivativeStatus = c.derivativeStatus;
        }
        if (typeof c.derivativeSize === 'number') commit.derivativeSize = c.derivativeSize;
        return commit;
      });

      const loadedPreviouslyWorkingBranchId = (treeData as any).previouslyWorkingBranchId || null;
      const loadedCloudSyncedIds: string[] = (treeData as any).cloudSyncedCommitIds || [];
      const loadedDerivativeSyncedIdsRaw = (treeData as any).derivativeSyncedCommitIds;
      // Backward-compat: pre-Phase-3 tree.json files don't carry this field. Fall back to
      // treating every cloud-synced commit as also derivative-synced iff it has
      // derivativeStatus='present' in the restored commits. This way, a project that
      // migrated to v1.1 locally before Phase 3 shipped still reports accurate sync state.
      const loadedDerivativeSyncedIds: string[] = Array.isArray(loadedDerivativeSyncedIdsRaw)
        ? loadedDerivativeSyncedIdsRaw
        : loadedCommits
            .filter(c => c.derivativeStatus === 'present' && loadedCloudSyncedIds.includes(c.id))
            .map(c => c.id);

      return {
        branches: loadedBranches,
        commits: loadedCommits,
        activeBranchId: treeData.activeBranchId,
        currentCommitId: treeData.currentCommitId,
        previouslyWorkingBranchId: loadedPreviouslyWorkingBranchId,
        cloudSyncedCommitIds: loadedCloudSyncedIds,
        derivativeSyncedCommitIds: loadedDerivativeSyncedIds,
      };
    } catch {
      return null;
    }
  }, []);

  const setCurrentModel = useCallback((path: string): Promise<void> => {
    setCurrentModelState(path);
    
    // Extract filename from path. Split on both POSIX `/` and Windows `\` so
    // packaged Windows builds get `bar.3dm` instead of the entire
    // `C:\Users\...\bar.3dm` string.
    const fileName = path.split(/[\\/]/).pop() || path;
    setModelName(fileName);
    
    // Clear unsaved changes only when switching to a different model
    setHasUnsavedChanges(false);
    setPulledCommitId(null);

    // Load from tree.json (sole source of truth in 0studio_{filename}/)
    setIsLoadingTree(true);
    
    // Create a promise that loads branches/commits from 0studio_{filename}/tree.json
    const loadPromise = (async () => {
      const treeData = await loadTreeFile(path);
      
      if (treeData && treeData.commits.length > 0) {
        if (treeData.previouslyWorkingBranchId) {
          setPreviouslyWorkingBranchId(treeData.previouslyWorkingBranchId);
        }

        // Signal cloud synced commit IDs to CloudSyncContext
        if (treeData.cloudSyncedCommitIds && treeData.cloudSyncedCommitIds.length > 0) {
          cloudSyncedCommitIdsRef.current = new Set(treeData.cloudSyncedCommitIds);
          setInitialCloudSyncedCommitIds(treeData.cloudSyncedCommitIds);
        }

        // Signal derivative-synced commit IDs to CloudSyncContext. Separate from
        // cloudSyncedCommitIds so missing derivatives can be retried independently.
        if (treeData.derivativeSyncedCommitIds && treeData.derivativeSyncedCommitIds.length > 0) {
          derivativeSyncedCommitIdsRef.current = new Set(treeData.derivativeSyncedCommitIds);
          setInitialDerivativeSyncedCommitIds(treeData.derivativeSyncedCommitIds);
        }

        setBranches(treeData.branches);
        setCommits(treeData.commits);
        setActiveBranchId(treeData.activeBranchId);
        setCurrentCommitId(treeData.currentCommitId);
        if (features.team) updatePresenceCommit(treeData.currentCommitId);
        setIsLoadingTree(false);

        return;
      }
      
      // One-time migration: check localStorage for legacy data and migrate to tree.json
      try {
        const legacyCommitsKey = `vc_commits_${path}`;
        const legacyCommitsData = localStorage.getItem(legacyCommitsKey);

        if (legacyCommitsData) {
          const parsedCommits = JSON.parse(legacyCommitsData);

          // Parse branches
          const legacyBranchesKey = `vc_branches_${path}`;
          const legacyBranchesData = localStorage.getItem(legacyBranchesKey);
          const parsedBranches: Branch[] = legacyBranchesData ? JSON.parse(legacyBranchesData) : [];

          // Apply starred status from localStorage
          const legacyStarredKey = `starred_commits_${path}`;
          const legacyStarredData = localStorage.getItem(legacyStarredKey);
          let starredIds: Set<string> = new Set();
          if (legacyStarredData) {
            try {
              starredIds = new Set(JSON.parse(legacyStarredData));
            } catch {
              // Silent catch
            }
          }

          // Build commit objects with starred status
          const migratedCommits = parsedCommits.map((c: any) => ({
            id: c.id,
            message: c.message,
            timestamp: c.timestamp,
            parentCommitId: c.parentCommitId,
            branchId: c.branchId || 'main',
            starred: starredIds.has(c.id) || c.starred || false,
          }));

          // Determine active branch
          const mainBranch = parsedBranches.find(b => b.isMain);
          const migrationActiveBranchId = mainBranch?.id || parsedBranches[0]?.id || 'main';
          const migrationCurrentCommitId = migratedCommits.length > 0 ? migratedCommits[0].id : null;

          // Write migrated data to tree.json
          if (desktopAPI.isDesktop && migratedCommits.length > 0) {
            const migrationTreeData = {
              version: TREE_JSON_VERSION,
              activeBranchId: migrationActiveBranchId,
              currentCommitId: migrationCurrentCommitId,
              previouslyWorkingBranchId: null,
              cloudSyncedCommitIds: [],
              branches: parsedBranches.map((b: any) => ({
                id: b.id,
                name: b.name,
                headCommitId: b.headCommitId,
                color: b.color,
                isMain: b.isMain,
                parentBranchId: b.parentBranchId,
                originCommitId: b.originCommitId,
              })),
              commits: migratedCommits,
            };
            await desktopAPI.saveTreeFile(path, migrationTreeData);

            // Clear legacy localStorage keys
            localStorage.removeItem(legacyCommitsKey);
            localStorage.removeItem(legacyBranchesKey);
            localStorage.removeItem(legacyStarredKey);

            // Clean up orphaned IndexedDB entries
            deleteFileBuffers(path).catch(() => {});

            // Load from the newly-written tree.json
            const freshTreeData = await loadTreeFile(path);
            if (freshTreeData && freshTreeData.commits.length > 0) {
              setBranches(freshTreeData.branches);
              setCommits(freshTreeData.commits);
              setActiveBranchId(freshTreeData.activeBranchId);
              setCurrentCommitId(freshTreeData.currentCommitId);
              if (features.team) updatePresenceCommit(freshTreeData.currentCommitId);
              setIsLoadingTree(false);
              return;
            }
          }
        }
      } catch {
        // Migration failed — continue normally (createInitialCommit will handle on first import)
      }

      // No existing data — createInitialCommit will handle on first model import
      setIsLoadingTree(false);
    })();
    
    setTreeLoadPromise(loadPromise);
    return loadPromise;
  }, [loadTreeFile]);

  const createInitialCommit = useCallback(async (modelData: LoadedModel, fileBuffer?: ArrayBuffer, filePath?: string) => {
    // Only create initial commit if no commits exist
    const targetPath = filePath || currentModel;
    
    if (!targetPath) {
      return;
    }

    // Wait for tree loading to complete before creating initial commit
    // This prevents race conditions where we create a duplicate initial commit
    if (treeLoadPromise) {
      try {
        await treeLoadPromise;
      } catch {
        // Silent catch
      }
    }

    // Use a Promise to get the current commits count from within the setState callback
    // This ensures we check the actual current state, not a stale closure value
    const currentCommitsCount = await new Promise<number>(resolve => {
      setCommits(prevCommits => {
        resolve(prevCommits.length);
        return prevCommits;
      });
    });

    // If we have commits from tree.json, don't create a new initial commit
    if (currentCommitsCount > 0) {
      // Update the modelData for the current commit (so we have it for display)
      setCommits(prevCommits => {
        if (prevCommits.length > 0) {
          return prevCommits.map((c, idx) => {
            // Update the first commit (current head) with the modelData if it doesn't have one
            if (idx === 0 && !c.modelData) {
              return { ...c, modelData, fileBuffer };
            }
            return c;
          });
        }
        return prevCommits;
      });
      return;
    }

    // Create main branch if it doesn't exist
    const mainBranchId = 'main';
    setBranches(prevBranches => {
      if (prevBranches.length === 0) {
        const mainBranch: Branch = {
          id: mainBranchId,
          name: 'main',
          headCommitId: '', // Will be updated after commit
          color: CURRENT_WORKING_BRANCH_COLOR, // Current working branch is green
          isMain: true,
        };
        return [mainBranch];
      }
      return prevBranches;
    });
    const branchIdToSet = activeBranchId || mainBranchId;
    if (branchIdToSet) {
      setBranches(prevBranches => prevBranches.map(b => 
        b.id === branchIdToSet ? { ...b, color: CURRENT_WORKING_BRANCH_COLOR } : b
      ));
    }
    setActiveBranchId(branchIdToSet);

    // Generate a unique commit ID with timestamp and random component
    const commitId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Tag the commit with the source format so the file on disk gets the right
    // extension and tree.json round-trips the format. targetPath is the primary
    // project file path (.3dm/.rvt/.ifc).
    const initialOriginalFormat = originalFormatFromPath(targetPath);
    const initialCommit: ModelCommit = {
      id: commitId,
      message: "Initial model import",
      timestamp: Date.now(),
      modelData: modelData,
      fileBuffer: fileBuffer, // Store file buffer if provided
      parentCommitId: null, // Root commit has no parent
      branchId: mainBranchId,
      ...(initialOriginalFormat ? { originalFormat: initialOriginalFormat } : {}),
    };
    
    setCurrentCommitId(initialCommit.id);
    if (features.team) updatePresenceCommit(initialCommit.id);

    const updatedCommits = [initialCommit];
    setCommits(updatedCommits);
    
    // Create the updated branch with the new headCommitId
    const mainBranch: Branch = {
      id: mainBranchId,
      name: 'main',
      headCommitId: commitId,
      color: CURRENT_WORKING_BRANCH_COLOR, // Current working branch is green
      isMain: true,
    };
    const updatedBranches = [mainBranch];
    setBranches(updatedBranches);
    
    // Save file to 0studio folder (file system storage) with the correct extension
    // for the source format. For .3dm the third argument is absent (defaults to .3dm);
    // for .rvt/.ifc the file-storage-service picks the matching extension.
    if (fileBuffer && desktopAPI.isDesktop) {
      try {
        await desktopAPI.saveCommitFile(targetPath, initialCommit.id, fileBuffer, initialOriginalFormat);
      } catch {
        // Silent catch
      }
    }
    
    // Explicitly save tree.json after initial commit (don't rely on useEffect which may be skipped during loading)
    if (desktopAPI.isDesktop) {
      try {
        const treeData = {
          version: TREE_JSON_VERSION,
          activeBranchId: mainBranchId,
          currentCommitId: commitId,
          previouslyWorkingBranchId: previouslyWorkingBranchId, // Save previously working branch
          branches: updatedBranches.map(b => ({
            id: b.id,
            name: b.name,
            headCommitId: b.headCommitId,
            color: b.color,
            isMain: b.isMain,
            parentBranchId: b.parentBranchId,
            originCommitId: b.originCommitId,
          })),
          commits: updatedCommits.map(c => {
            const commitData: Record<string, unknown> = {
              id: c.id,
              message: c.message,
              timestamp: c.timestamp,
              parentCommitId: c.parentCommitId,
              branchId: c.branchId,
              starred: c.starred || false,
            };
            if (c.originalFormat) commitData.originalFormat = c.originalFormat;
            return commitData;
          }),
        };
        await desktopAPI.saveTreeFile(targetPath, treeData);
      } catch {
        // Silent catch
      }
    }
  }, [currentModel, treeLoadPromise]);

  // Auto-save tree.json whenever branches, commits, activeBranchId, or currentCommitId change.
  // Debounced by 100ms to coalesce the 2-4 rapid writes a single commit produces as its
  // intermediate state transitions flush through React.
  // Skip saving during initial load (when commits/branches are being loaded).
  useEffect(() => {
    if (!currentModel || (branches.length === 0 && commits.length === 0) || isLoadingTree) {
      return;
    }
    const timer = setTimeout(() => {
      saveTreeFile(currentModel).catch(() => {});
    }, 100);
    return () => clearTimeout(timer);
  }, [branches, commits, activeBranchId, currentCommitId, previouslyWorkingBranchId, currentModel, saveTreeFile, isLoadingTree]);


  // File change detection - mark unsaved changes when file changes on disk
  useEffect(() => {
    if (!desktopAPI.isDesktop || !currentModel) return;

    const handleFileChange = (event: any) => {
      if (event.eventType === 'change' && event.filePath && event.filePath === currentModel) {
        setHasUnsavedChanges(true);
      }
    };

    // Set up file change listener
    const unsubFileChanged = desktopAPI.onFileChanged(handleFileChange);

    // Cleanup
    return () => {
      unsubFileChanged?.();
    };
  }, [currentModel]); // Re-setup when current model changes

  const commitModelChanges = useCallback(async (message: string, currentModelData?: LoadedModel, customBranchName?: string): Promise<void> => {
    if (!currentModel) {
      throw new Error("No model is currently open");
    }

    if (isCommittingRef.current) {
      toast.warning("A commit is already in progress");
      return;
    }
    isCommittingRef.current = true;

    try {
      let fileBuffer: ArrayBuffer | undefined;

      // Always read the exact file buffer from disk (if desktop) for exact file storage
      if (desktopAPI.isDesktop) {
        const buffer = await desktopAPI.readFileBuffer(currentModel);
        if (buffer) {
          fileBuffer = buffer;
        }
      }

      // Determine if we need to create a new branch
      // If currentCommitId is not the head of the active branch, we're branching
      let targetBranchId = activeBranchId || 'main';
      let parentCommitId = currentCommitId;
      let newBranch: Branch | null = null;
      
      // Check if we're at the head of the current branch
      const activeBranch = branches.find(b => b.id === activeBranchId);
      const isAtBranchHead = activeBranch && activeBranch.headCommitId === currentCommitId;
      
      // If we pulled to an old commit and are now committing, create a new branch
      if (pulledCommitId && pulledCommitId !== activeBranch?.headCommitId) {
        // We're creating a branch from an old commit
        // Find how many branches already exist from this parent
        const existingBranchesFromParent = branches.filter(b => b.originCommitId === pulledCommitId);
        const branchLetter = String.fromCharCode(97 + existingBranchesFromParent.length); // a, b, c, etc.
        
        // Generate new branch ID and name
        const newBranchId = `branch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const branchName = customBranchName || `v${getCommitNumber(pulledCommitId)}${branchLetter}`;
        
        newBranch = {
          id: newBranchId,
          name: branchName,
          headCommitId: '', // Will be updated after commit
          color: CURRENT_WORKING_BRANCH_COLOR, // New branch becomes current working (green)
          parentBranchId: activeBranchId || undefined,
          originCommitId: pulledCommitId,
          isMain: false,
        };
        
        targetBranchId = newBranchId;
        parentCommitId = pulledCommitId;
        
      }

      // Generate a unique commit ID with timestamp and random component to avoid collisions
      const commitId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      // Tag originalFormat from the open project's path so snapshots go to disk with
      // the matching extension (.3dm absent = default; .rvt / .ifc persisted explicitly).
      const commitOriginalFormat = originalFormatFromPath(currentModel);
      const newCommit: ModelCommit = {
        id: commitId,
        message,
        timestamp: Date.now(),
        modelData: currentModelData, // Store for UI display and in-memory restore
        fileBuffer: fileBuffer, // Store exact .3dm file buffer for exact file restoration
        parentCommitId: parentCommitId,
        branchId: targetBranchId,
        authorId: user?.id,
        authorEmail: user?.email,
        ...(commitOriginalFormat ? { originalFormat: commitOriginalFormat } : {}),
      };

      // Delta compression: determine keyframe vs delta
      if (fileBuffer && currentModel && desktopAPI.isDesktop) {
        const parentCommit = parentCommitId ? commits.find(c => c.id === parentCommitId) : null;

        // Determine if this should be a keyframe
        const isNewBranch = newBranch != null;
        const isFirstCommit = parentCommit == null;
        const isCrossBranch = parentCommit != null && parentCommit.branchId !== targetBranchId;
        const parentDeltaChainLength = (parentCommit as any)?.deltaChainLength || 0;
        const chainLengthExceeded = parentDeltaChainLength >= 7; // max chain = 8

        const isKeyframe = isFirstCommit || isNewBranch || isCrossBranch || chainLengthExceeded;

        if (isKeyframe) {
          // Save as full snapshot with the project's native extension.
          newCommit.storageType = 'snapshot';
          try {
            await desktopAPI.saveCommitFile(currentModel, newCommit.id, fileBuffer, commitOriginalFormat);
          } catch (error) {
            toast.error("Failed to save commit file.");
            throw error;
          }
        } else {
          // Attempt delta compression
          let savedAsDelta = false;
          try {
            // Get the parent's full .3dm buffer (reconstruct if needed)
            let parentBuffer: ArrayBuffer | null = null;

            if (parentCommit?.storageType === 'delta') {
              // Reconstruct parent from delta chain
              const treeDataForReconstruction = {
                version: '1.0',
                activeBranchId,
                currentCommitId,
                branches: branches.map(b => ({
                  id: b.id, name: b.name, headCommitId: b.headCommitId,
                  color: b.color, isMain: b.isMain, parentBranchId: b.parentBranchId,
                  originCommitId: b.originCommitId,
                })),
                commits: commits.map(c => {
                  const cd: any = {
                    id: c.id, message: c.message, timestamp: c.timestamp,
                    parentCommitId: c.parentCommitId, branchId: c.branchId,
                    starred: c.starred || false,
                  };
                  if (c.storageType) cd.storageType = c.storageType;
                  if (c.baseCommitId) cd.baseCommitId = c.baseCommitId;
                  if (c.fullHash) cd.fullHash = c.fullHash;
                  if (c.deltaChainLength != null) cd.deltaChainLength = c.deltaChainLength;
                  return cd;
                }),
              };
              parentBuffer = await desktopAPI.reconstructCommit(currentModel, parentCommitId!, treeDataForReconstruction);
            } else {
              parentBuffer = await desktopAPI.readCommitFile(currentModel, parentCommitId!);
            }

            if (parentBuffer) {
              const deltaResult = await desktopAPI.computeDelta(parentBuffer, fileBuffer);

              if (deltaResult && !deltaResult.fallbackToKeyframe) {
                // Save as delta
                await desktopAPI.saveDeltaFile(currentModel, newCommit.id, deltaResult.delta);
                newCommit.storageType = 'delta';
                newCommit.baseCommitId = parentCommitId!;
                newCommit.fullHash = deltaResult.fullHash;
                newCommit.deltaChainLength = parentDeltaChainLength + 1;
                savedAsDelta = true;
              } else if (deltaResult) {
                // Delta too large, fallback to keyframe
                newCommit.storageType = 'snapshot';
                newCommit.fullHash = deltaResult.fullHash;
              }
            }
          } catch {
            // Delta computation failed, fall back to keyframe
          }

          if (!savedAsDelta) {
            // Save as full snapshot (fallback) with the project's native extension.
            newCommit.storageType = newCommit.storageType || 'snapshot';
            try {
              await desktopAPI.saveCommitFile(currentModel, newCommit.id, fileBuffer, commitOriginalFormat);
            } catch (error) {
              toast.error("Failed to save commit file.");
              throw error;
            }
          }
        }
      }

      // Update branches
      let updatedBranches = [...branches];
      if (newBranch) {
        newBranch.headCommitId = commitId;
        updatedBranches.push(newBranch);
      } else {
        // Update head of current branch
        updatedBranches = updatedBranches.map(b =>
          b.id === targetBranchId ? { ...b, headCommitId: commitId } : b
        );
      }

      // Update branch colors before setting active branch
      const previousActiveId = activeBranchId;
      if (previousActiveId && previousActiveId !== targetBranchId) {
        setPreviouslyWorkingBranchId(previousActiveId);
        updatedBranches = updatedBranches.map(b => {
          if (b.id === previousActiveId) {
            return { ...b, color: PREVIOUSLY_WORKING_BRANCH_COLOR };
          } else if (b.id === targetBranchId) {
            return { ...b, color: CURRENT_WORKING_BRANCH_COLOR };
          }
          return b;
        });
      } else if (targetBranchId) {
        updatedBranches = updatedBranches.map(b =>
          b.id === targetBranchId ? { ...b, color: CURRENT_WORKING_BRANCH_COLOR } : b
        );
      }

      setBranches(updatedBranches);
      setActiveBranchId(targetBranchId);

      setCommits(prev => {
        return [newCommit, ...prev];
      });

      setCurrentCommitId(newCommit.id);
      if (features.team) updatePresenceCommit(newCommit.id);
      setHasUnsavedChanges(false);
      setPulledCommitId(null); // Clear pulled commit after successful commit

      toast.success(newBranch ? `New branch "${newBranch.name}" created` : "Commit saved successfully");
    } finally {
      isCommittingRef.current = false;
    }
  }, [currentModel, currentCommitId, activeBranchId, branches, pulledCommitId, user]);
  
  // Helper to get commit number in the timeline
  const getCommitNumber = useCallback((commitId: string | null): number => {
    if (!commitId) return 0;
    const commit = commits.find(c => c.id === commitId);
    if (!commit) return 0;
    
    // Count commits in the same branch up to this commit
    const branchCommits = commits
      .filter(c => c.branchId === commit.branchId)
      .sort((a, b) => a.timestamp - b.timestamp);
    
    return branchCommits.findIndex(c => c.id === commitId) + 1;
  }, [commits]);

  // Helper to build tree data for reconstruction from current state
  const buildTreeDataForReconstruction = useCallback(() => {
    return {
      version: '1.0',
      activeBranchId,
      currentCommitId,
      branches: branches.map(b => ({
        id: b.id, name: b.name, headCommitId: b.headCommitId,
        color: b.color, isMain: b.isMain, parentBranchId: b.parentBranchId,
        originCommitId: b.originCommitId,
      })),
      commits: commits.map(c => {
        const cd: any = {
          id: c.id, message: c.message, timestamp: c.timestamp,
          parentCommitId: c.parentCommitId, branchId: c.branchId,
          starred: c.starred || false,
        };
        if (c.storageType) cd.storageType = c.storageType;
        if (c.baseCommitId) cd.baseCommitId = c.baseCommitId;
        if (c.fullHash) cd.fullHash = c.fullHash;
        if (c.deltaChainLength != null) cd.deltaChainLength = c.deltaChainLength;
        return cd;
      }),
    };
  }, [activeBranchId, currentCommitId, branches, commits]);

  const restoreToCommit = useCallback(async (commitId: string): Promise<boolean> => {
    try {
      const commit = commits.find(c => c.id === commitId);
      if (!commit) {
        return false;
      }

      // Priority 0: If delta commit, reconstruct via the reconstruction service
      let fileBuffer: ArrayBuffer | undefined;
      if (commit.storageType === 'delta' && desktopAPI.isDesktop && currentModel) {
        const treeData = buildTreeDataForReconstruction();
        const reconstructed = await desktopAPI.reconstructCommit(currentModel, commitId, treeData);
        if (reconstructed) {
          fileBuffer = reconstructed;
          // Cache in IndexedDB for fast repeated access
          storeFileBuffer(commitId, currentModel, reconstructed).catch(() => {});
        }
      }

      // Priority 1: Load from 0studio folder (file system storage) - PRIMARY METHOD
      if (!fileBuffer && desktopAPI.isDesktop && currentModel) {
        const storedFile = await desktopAPI.readCommitFile(currentModel, commitId);
        if (storedFile) {
          fileBuffer = storedFile;
        }
      }

      // Priority 2: Fall back to in-memory file buffer
      if (!fileBuffer && commit.fileBuffer) {
        fileBuffer = commit.fileBuffer;
      }

      // Priority 3: Fall back to IndexedDB
      if (!fileBuffer && currentModel) {
        const storedBuffer = await getFileBuffer(commitId, currentModel);
        if (storedBuffer) {
          fileBuffer = storedBuffer;
        }
      }

      // Priority 4: Fall back to exporting modelData (less ideal)
      let modelData: LoadedModel | undefined = commit.modelData;
      if (!fileBuffer && modelData) {
        try {
          const { exportModelToBuffer } = await import('@/lib/rhino3dm-service');
          fileBuffer = await exportModelToBuffer(modelData);
        } catch {
          // Silent catch
        }
      }

      // Load the model from file buffer if available
      if (fileBuffer) {
        const file = new File([fileBuffer], modelName || 'model.3dm', { type: 'application/octet-stream' });
        const { load3dmFile } = await import('@/lib/rhino3dm-service');
        const loaded = await load3dmFile(file);
        modelData = loaded;
      }

      if (!modelData) {
        return false;
      }

      // Restore the model by calling the callback provided by ModelContext
      if (onModelRestore) {
        onModelRestore(modelData);
      } else {
        return false;
      }

      setCurrentCommitId(commitId);
      if (features.team) updatePresenceCommit(commitId);
      setHasUnsavedChanges(false);

      return true;
    } catch {
      return false;
    }
  }, [commits, onModelRestore, currentModel, modelName, buildTreeDataForReconstruction]);

  const pullFromCommit = useCallback(async (commitId: string): Promise<boolean> => {
    if (!currentModel || !desktopAPI.isDesktop) {
      toast.error("Pull only works in desktop mode with an open file");
      return false;
    }

    try {
      const commit = commits.find(c => c.id === commitId);
      if (!commit) {
        toast.error("Commit not found");
        return false;
      }

      let fileBuffer: ArrayBuffer | undefined;

      // Priority 0: If delta commit, reconstruct via the reconstruction service
      if (commit.storageType === 'delta' && desktopAPI.isDesktop) {
        const treeData = buildTreeDataForReconstruction();
        const reconstructed = await desktopAPI.reconstructCommit(currentModel, commitId, treeData);
        if (reconstructed) {
          fileBuffer = reconstructed;
          // Cache in IndexedDB for fast repeated access
          storeFileBuffer(commitId, currentModel, reconstructed).catch(() => {});
        }
      }

      // Priority 1: Read from 0studio folder (file system storage) - PRIMARY METHOD
      if (!fileBuffer && desktopAPI.isDesktop) {
        const storedFile = await desktopAPI.readCommitFile(currentModel, commitId);
        if (storedFile) {
          fileBuffer = storedFile;
        }
      }

      // Priority 2: Fall back to in-memory file buffer (for backwards compatibility)
      if (!fileBuffer && commit.fileBuffer) {
        fileBuffer = commit.fileBuffer;
      }

      // Priority 3: Fall back to IndexedDB (for backwards compatibility)
      if (!fileBuffer) {
        const storedBuffer = await getFileBuffer(commitId, currentModel);
        if (storedBuffer) {
          fileBuffer = storedBuffer;
        }
      }

      // Priority 4: Fall back to exporting modelData (less ideal, loses polysurface data)
      if (!fileBuffer && commit.modelData) {
        try {
          fileBuffer = await exportModelToBuffer(commit.modelData);
          toast.warning("Note: Using converted model data - may differ from original file");
        } catch {
          toast.error("Failed to convert model data to file");
          return false;
        }
      }

      // If we still don't have a file buffer, we can't proceed
      if (!fileBuffer) {
        toast.error("No file data available for this commit. The commit may have been created before file buffer storage was implemented.");
        return false;
      }

      // Write the exact file buffer to disk
      await desktopAPI.writeFileBuffer(currentModel, fileBuffer);

      // Touch the file to ensure Rhino detects the change
      // Read and immediately write to update file metadata
      await new Promise(resolve => setTimeout(resolve, 100));
      const verifyBuffer = await desktopAPI.readFileBuffer(currentModel);
      if (verifyBuffer && verifyBuffer.byteLength === fileBuffer.byteLength) {
        // File was written correctly, touch it again to trigger Rhino reload
        await desktopAPI.writeFileBuffer(currentModel, fileBuffer);
      }

      // Wait for file system to settle
      await new Promise(resolve => setTimeout(resolve, 200));

      // Reload the model in the UI
      const file = new File([fileBuffer], modelName || 'model.3dm', { type: 'application/octet-stream' });
      const { load3dmFile } = await import('@/lib/rhino3dm-service');
      const loaded = await load3dmFile(file);
      
      if (onModelRestore) {
        onModelRestore(loaded);
      }

      setCurrentCommitId(commitId);
      if (features.team) updatePresenceCommit(commitId);
      setPulledCommitId(commitId); // Track which commit was pulled for highlighting
      setHasUnsavedChanges(false);
      
      // Switch to the branch of this commit and update colors
      const previousActiveId = activeBranchId;
      const newBranchId = commit.branchId;
      if (previousActiveId && previousActiveId !== newBranchId) {
        setPreviouslyWorkingBranchId(previousActiveId);
        setBranches(prevBranches => prevBranches.map(b => {
          if (b.id === previousActiveId) {
            return { ...b, color: PREVIOUSLY_WORKING_BRANCH_COLOR };
          } else if (b.id === newBranchId) {
            return { ...b, color: CURRENT_WORKING_BRANCH_COLOR };
          }
          return b;
        }));
      } else if (newBranchId) {
        setBranches(prevBranches => prevBranches.map(b => 
          b.id === newBranchId ? { ...b, color: CURRENT_WORKING_BRANCH_COLOR } : b
        ));
      }
      setActiveBranchId(newBranchId);
      
      toast.success("File updated to exact commit version - Rhino should auto-reload");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to pull from commit");
      return false;
    }
  }, [commits, currentModel, modelName, onModelRestore, buildTreeDataForReconstruction]);

  const markUnsavedChanges = useCallback(() => {
    setHasUnsavedChanges(true);
  }, []);

  const clearUnsavedChanges = useCallback(() => {
    setHasUnsavedChanges(false);
  }, []);

  const clearCurrentModel = useCallback(async () => {
    // Save tree.json one final time before clearing (if we have data to save)
    const modelToSave = currentModel;
    if (modelToSave && (branches.length > 0 || commits.length > 0)) {
      try {
        await saveTreeFile(modelToSave);
      } catch {
        // Silent catch
      }
    }
    
    setCurrentModelState(null);
    setModelName(null);
    setCommits([]);
    setCurrentCommitId(null);
    if (features.team) updatePresenceCommit(null);
    setHasUnsavedChanges(false);
    // Reset branching state
    setBranches([]);
    setActiveBranchId(null);
    setPulledCommitId(null);
    // Reset tree loading state
    setTreeLoadPromise(null);
    setIsLoadingTree(false);
    // Reset tree version guard so the next opened project starts fresh.
    treeJsonReadOnlyRef.current = false;
    // Reset cloud sync ref (CloudSyncContext will reset its own state via currentModel effect)
    cloudSyncedCommitIdsRef.current = new Set();
    setInitialCloudSyncedCommitIds(null);
    derivativeSyncedCommitIdsRef.current = new Set();
    setInitialDerivativeSyncedCommitIds(null);
  }, [currentModel, branches, commits, saveTreeFile]);

  // Handle project-closed event from Electron
  useEffect(() => {
    if (!desktopAPI.isDesktop) return;

    const handleProjectClosed = async () => {
      await clearCurrentModel();
    };

    // Set up project closed listener
    const unsubProjectClosed = desktopAPI.onProjectClosed(handleProjectClosed);

    // Cleanup
    return () => {
      unsubProjectClosed?.();
    };
  }, [clearCurrentModel]);


  // Toggle star status of a commit
  // When starring a delta commit, convert it to a keyframe (snapshot)
  const toggleStarCommit = useCallback(async (commitId: string) => {
    const commit = commits.find(c => c.id === commitId);
    if (!commit) return;

    const isStarring = !commit.starred;

    // If starring a delta commit, convert it to a keyframe
    if (isStarring && commit.storageType === 'delta' && desktopAPI.isDesktop && currentModel) {
      try {
        const treeData = buildTreeDataForReconstruction();
        const reconstructed = await desktopAPI.reconstructCommit(currentModel, commitId, treeData);
        if (reconstructed) {
          // Save as a full keyframe with the commit's native extension (preserved on
          // the existing commit record). For legacy commits without originalFormat this
          // defaults to .3dm, matching pre-Phase-3 behavior.
          await desktopAPI.saveCommitFile(currentModel, commitId, reconstructed, commit.originalFormat);

          // Update commit: starred + convert to snapshot
          setCommits(prevCommits =>
            prevCommits.map(c =>
              c.id === commitId
                ? {
                    ...c,
                    starred: true,
                    storageType: 'snapshot' as const,
                    baseCommitId: undefined,
                    deltaChainLength: undefined,
                    // Keep fullHash for integrity
                  }
                : c
            )
          );
          return;
        }
      } catch {
        // Reconstruction failed — still toggle the star, just don't convert storage
        toast.error('Could not convert commit to keyframe, but star was toggled.');
      }
    }

    // Default: just toggle the star
    setCommits(prevCommits =>
      prevCommits.map(c =>
        c.id === commitId
          ? { ...c, starred: !c.starred }
          : c
      )
    );
  }, [commits, currentModel, buildTreeDataForReconstruction]);

  // Get all starred commits
  const getStarredCommits = useCallback((): ModelCommit[] => {
    return commits.filter(commit => commit.starred);
  }, [commits]);

  // Branching functions
  const switchBranch = useCallback((branchId: string) => {
    const branch = branches.find(b => b.id === branchId);
    if (!branch) {
      return;
    }

    const previousActiveId = activeBranchId;
    if (previousActiveId && previousActiveId !== branchId) {
      setPreviouslyWorkingBranchId(previousActiveId);
      setBranches(prevBranches => prevBranches.map(b => {
        if (b.id === previousActiveId) {
          return { ...b, color: PREVIOUSLY_WORKING_BRANCH_COLOR };
        } else if (b.id === branchId) {
          return { ...b, color: CURRENT_WORKING_BRANCH_COLOR };
        }
        return b;
      }));
    } else if (branchId) {
      setBranches(prevBranches => prevBranches.map(b => 
        b.id === branchId ? { ...b, color: CURRENT_WORKING_BRANCH_COLOR } : b
      ));
    }
    
    setActiveBranchId(branchId);
    setCurrentCommitId(branch.headCommitId);
    if (features.team) updatePresenceCommit(branch.headCommitId);
    setPulledCommitId(null);
  }, [branches, activeBranchId]);

  const keepBranch = useCallback((branchId: string) => {
    if (!currentModel) return;
    
    const branchToKeep = branches.find(b => b.id === branchId);
    if (!branchToKeep) {
      return;
    }
    
    // Mark this branch as main and demote others, update colors
    const previousActiveId = activeBranchId;
    const updatedBranches = branches.map(b => {
      const isMain = b.id === branchId;
      let color = b.color;
      
      if (b.id === branchId) {
        // Current working branch is green
        color = CURRENT_WORKING_BRANCH_COLOR;
      } else if (b.id === previousActiveId && previousActiveId !== branchId) {
        // Previously working branch is red
        color = PREVIOUSLY_WORKING_BRANCH_COLOR;
        setPreviouslyWorkingBranchId(previousActiveId);
      }
      
      return {
        ...b,
        isMain,
        color,
      };
    });
    
    setBranches(updatedBranches);
    setActiveBranchId(branchId);

    toast.success(`Branch "${branchToKeep.name}" is now the main branch`);
  }, [branches, commits, currentModel]);

  const getBranchCommits = useCallback((branchId: string): ModelCommit[] => {
    return commits.filter(c => c.branchId === branchId).sort((a, b) => b.timestamp - a.timestamp);
  }, [commits]);

  const getCommitVersionLabel = useCallback((commit: ModelCommit): string => {
    // Find the branch for this commit
    const branch = branches.find(b => b.id === commit.branchId);
    
    // Get all commits on main branch sorted by timestamp
    const mainBranch = branches.find(b => b.isMain);
    const mainCommits = commits
      .filter(c => c.branchId === mainBranch?.id)
      .sort((a, b) => a.timestamp - b.timestamp);
    
    if (branch?.isMain) {
      // Main branch: just use version number v1, v2, v3...
      const idx = mainCommits.findIndex(c => c.id === commit.id);
      return `v${idx + 1}`;
    }
    
    // For non-main branches, find the origin point
    if (branch?.originCommitId) {
      const originCommit = commits.find(c => c.id === branch.originCommitId);
      if (originCommit) {
        // Find the version number of the origin commit
        const originBranch = branches.find(b => b.id === originCommit.branchId);
        const originBranchCommits = commits
          .filter(c => c.branchId === originBranch?.id)
          .sort((a, b) => a.timestamp - b.timestamp);
        const originIdx = originBranchCommits.findIndex(c => c.id === originCommit.id);
        const baseVersion = originIdx + 1;
        
        // Get all sibling branches from the same origin
        const siblingBranches = branches
          .filter(b => b.originCommitId === branch.originCommitId && !b.isMain)
          .sort((a, b) => {
            // Sort by creation time (first commit timestamp)
            const aFirstCommit = commits.filter(c => c.branchId === a.id).sort((x, y) => x.timestamp - y.timestamp)[0];
            const bFirstCommit = commits.filter(c => c.branchId === b.id).sort((x, y) => x.timestamp - y.timestamp)[0];
            return (aFirstCommit?.timestamp || 0) - (bFirstCommit?.timestamp || 0);
          });
        
        const branchIndex = siblingBranches.findIndex(b => b.id === branch.id);
        const branchLetter = String.fromCharCode(97 + branchIndex); // a, b, c...
        
        // Get commit index within this branch
        const branchCommits = commits
          .filter(c => c.branchId === commit.branchId)
          .sort((a, b) => a.timestamp - b.timestamp);
        const commitIdx = branchCommits.findIndex(c => c.id === commit.id);
        
        if (commitIdx === 0) {
          return `v${baseVersion + 1}${branchLetter}`;
        }
        return `v${baseVersion + 1 + commitIdx}${branchLetter}`;
      }
    }
    
    // Fallback
    const branchCommits = commits
      .filter(c => c.branchId === commit.branchId)
      .sort((a, b) => a.timestamp - b.timestamp);
    const idx = branchCommits.findIndex(c => c.id === commit.id);
    return `v${idx + 1}`;
  }, [branches, commits]);



  const value: VersionControlContextType = {
    currentModel,
    modelName,
    commits,
    currentCommitId,
    hasUnsavedChanges,
    // Branching
    branches,
    activeBranchId,
    pulledCommitId,
    // Actions
    setCurrentModel,
    commitModelChanges,
    createInitialCommit,
    restoreToCommit,
    pullFromCommit,
    markUnsavedChanges,
    clearUnsavedChanges,
    clearCurrentModel,
    toggleStarCommit,
    getStarredCommits,
    // Branching actions
    switchBranch,
    keepBranch,
    getBranchCommits,
    getCommitVersionLabel,
    buildTreeDataForReconstruction,
    // Internal — exposed for CloudSyncContext
    previouslyWorkingBranchId,
    cloudSyncedCommitIdsRef,
    setCloudSyncedCommitIdsExternal,
    derivativeSyncedCommitIdsRef,
    setDerivativeSyncedCommitIdsExternal,
    setCommits,
    setBranches,
    initialCloudSyncedCommitIds,
    initialDerivativeSyncedCommitIds,
    // Callbacks
    onModelRestore,
    setModelRestoreCallback,
  };

  return (
    <VersionControlContext.Provider value={value}>
      {children}
    </VersionControlContext.Provider>
  );
};

export const useVersionControl = (): VersionControlContextType => {
  const context = useContext(VersionControlContext);
  if (!context) {
    throw new Error("useVersionControl must be used within a VersionControlProvider");
  }
  return context;
};

export type { ModelCommit, Branch };