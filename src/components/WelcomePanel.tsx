import React, { useState, useEffect } from "react";
import {
  FileBox,
  FolderOpen,
  ChevronRight,
  Cloud,
  CloudDownload,
  Loader2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useRecentProjects } from "@/contexts/RecentProjectsContext";
import { useDesktopAPI } from "@/lib/desktop-api";
import { projectAPI, CloudProject } from "@/lib/project-api";
import { cloudSyncService, getLocalPathForProject, setCloudProjectPath, getSeenSharedProjectIds, markProjectAsSeen } from "@/lib/cloud-sync-service";
import { toast } from "sonner";
import { features } from "@/lib/features";

/** Shorten path for display - replace /Users/username with ~ */
function shortenPath(path: string): string {
  // Match /Users/username or C:\Users\username
  const usersMatch = path.match(/^(\/Users\/[^/]+)(\/.*)?$/);
  if (usersMatch) {
    return "~" + (usersMatch[2] || "");
  }
  const winMatch = path.match(/^([A-Z]:\\Users\\[^\\]+)(\\.*)?$/i);
  if (winMatch) {
    return "~" + (winMatch[2]?.replace(/\\/g, "/") || "");
  }
  // Fallback: show last 2 path segments
  const parts = path.split(/[/\\]/).filter(Boolean);
  if (parts.length > 2) {
    return "…/" + parts.slice(-2).join("/");
  }
  return path;
}

export default function WelcomePanel({
  triggerFileDialog,
  onDragDropHint,
}: {
  triggerFileDialog: () => void;
  onDragDropHint: string;
}) {
  const { user } = useAuth();
  const { recentProjects } = useRecentProjects();
  const desktopAPI = useDesktopAPI();
  const isDesktop = desktopAPI.isDesktop;
  const signedIn = !!user;

  const [sharedProjects, setSharedProjects] = useState<CloudProject[]>([]);
  const [loadingShared, setLoadingShared] = useState(false);
  const [downloadingProjectId, setDownloadingProjectId] = useState<string | null>(null);

  // Fetch shared projects when user is signed in
  useEffect(() => {
    if (!features.team || !signedIn || !user) return;

    let cancelled = false;
    const fetchShared = async () => {
      setLoadingShared(true);
      try {
        const projects = await projectAPI.getUserProjects();
        if (!cancelled) {
          setSharedProjects(projects);

          // Check for new shared projects and show notifications
          const seen = getSeenSharedProjectIds(user.id);
          const newProjects = projects.filter(p => !seen.includes(p.id) && p.owner_id !== user.id);
          for (const proj of newProjects) {
            toast.info(`"${proj.name}" was shared with you`, {
              description: 'You can download it from the Shared Projects section.',
              duration: 6000,
            });
            markProjectAsSeen(user.id, proj.id);
          }
          // Also mark owned projects as seen
          for (const proj of projects.filter(p => p.owner_id === user.id)) {
            markProjectAsSeen(user.id, proj.id);
          }
        }
      } catch {
        // Silently fail -- user might not have network
      } finally {
        if (!cancelled) setLoadingShared(false);
      }
    };
    fetchShared();
    return () => { cancelled = true; };
  }, [signedIn, user]);

  const handleOpenRecent = async (path: string) => {
    if (isDesktop) {
      await desktopAPI.openProjectByPath(path);
    }
  };

  const handleOpenSharedProject = async (project: CloudProject) => {
    if (!user || !isDesktop) return;

    // Check if we already have a local path for this project
    const existingPath = getLocalPathForProject(user.id, project.id);
    if (existingPath) {
      try {
        await desktopAPI.openProjectByPath(existingPath);
        return;
      } catch {
        // File may have been moved/deleted -- fall through to re-download
      }
    }

    // First-time pull: show save dialog, then download
    setDownloadingProjectId(project.id);
    try {
      const suggestedName = project.name.endsWith('.3dm') ? project.name : `${project.name}.3dm`;
      const savePath = await desktopAPI.showSaveDialog({
        defaultPath: suggestedName,
        filters: [
          { name: 'Rhino 3D Models', extensions: ['3dm'] },
        ],
      });

      if (!savePath) {
        // User cancelled the dialog
        return;
      }

      toast.loading('Downloading project from cloud...', { id: 'shared-download' });

      const result = await cloudSyncService.downloadFullProject(project.id, (downloaded, total) => {
        toast.loading(`Downloading commits ${downloaded}/${total}...`, { id: 'shared-download' });
      });
      if (!result) {
        toast.error('No data found in cloud for this project', { id: 'shared-download' });
        return;
      }

      const { treeData, commitBuffers, derivativeBuffers } = result;

      // Find the head commit of the active branch to use as the working file
      const activeBranch = treeData.branches.find(b => b.id === treeData.activeBranchId);
      const headCommitId = activeBranch?.headCommitId;
      const headBuffer = headCommitId ? commitBuffers.get(headCommitId) : undefined;
      const headCommit = headCommitId ? treeData.commits.find(c => c.id === headCommitId) : undefined;

      if (!headBuffer || !headCommitId) {
        toast.error('Could not find the latest version of this project', { id: 'shared-download' });
        return;
      }

      // For the working file on disk we want the reconstructed original, not a .delta.
      // If the head commit was stored as delta, reconstruction requires the full chain —
      // for first-time pull we defer to the main open path, so we write the delta buffer
      // here ONLY for snapshots. The renderer's reconstruct flow will materialize the
      // working file after open. (Deltas are rare for the head commit; the cloud push
      // currently writes snapshots for heads.)
      if (headCommit?.storageType !== 'delta') {
        await desktopAPI.writeFileBuffer(savePath, headBuffer);
      }

      // Save originals into the 0studio folder with the correct extension based on each
      // commit's storageType (pre-existing bug: everything was saved as .3dm).
      for (const [commitId, buffer] of commitBuffers) {
        const commit = treeData.commits.find(c => c.id === commitId);
        if (commit?.storageType === 'delta') {
          await desktopAPI.saveDeltaFile(savePath, commitId, buffer);
        } else {
          await desktopAPI.saveCommitFile(savePath, commitId, buffer);
        }
      }

      // Save derivative (.glb) files — enables immediate viewing without regeneration.
      for (const [commitId, buffer] of derivativeBuffers) {
        try {
          await desktopAPI.saveDerivativeFile(savePath, commitId, buffer);
        } catch {
          // Non-fatal — viewer will fall back to original loading path.
        }
      }

      // Preserve every field the server sent (dual-artifact, delta, author, etc.) and only
      // overwrite the sync sets to reflect what we just landed.
      const allCommitIds = treeData.commits.map(c => c.id);
      const landedDerivativeIds = Array.from(derivativeBuffers.keys());
      await desktopAPI.saveTreeFile(savePath, {
        ...treeData,
        cloudSyncedCommitIds: allCommitIds,
        derivativeSyncedCommitIds: landedDerivativeIds,
      });

      // Remember this path for future pulls
      setCloudProjectPath(user.id, project.id, savePath);

      toast.success('Project downloaded successfully', { id: 'shared-download' });

      // Open the downloaded file
      await desktopAPI.openProjectByPath(savePath);
    } catch (error: any) {
      toast.error(error.message || 'Failed to download project', { id: 'shared-download' });
    } finally {
      setDownloadingProjectId(null);
    }
  };

  // Split shared projects into owned vs shared-with-me
  const sharedWithMe = sharedProjects.filter(p => user && p.owner_id !== user.id);
  const ownedProjects = sharedProjects.filter(p => user && p.owner_id === user.id);

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center">
      <div className="flex flex-col items-center gap-8 max-w-md w-full mx-4">
        <div className="flex flex-col items-center gap-4">
          <h1 className="text-3xl font-semibold tracking-tight">0studio</h1>
        </div>

        <div className="w-full flex flex-col gap-6 bg-background/80 backdrop-blur-xl border border-border/50 rounded-lg shadow-2xl p-6">
          {/* Primary actions */}
          <div className="flex flex-col gap-2">
            <Button
              onClick={triggerFileDialog}
              variant="secondary"
              className="h-14 w-full justify-start gap-4 px-4 hover:bg-muted/80 transition-colors"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <FolderOpen className="w-5 h-5 text-primary" />
              </div>
              <div className="text-left">
                <div className="font-medium">Open project</div>
                <div className="text-xs text-muted-foreground">{onDragDropHint}</div>
              </div>
              <ChevronRight className="w-4 h-4 ml-auto text-muted-foreground" />
            </Button>
            <Button
              onClick={triggerFileDialog}
              variant="ghost"
              className="h-12 w-full justify-start gap-4 px-4"
            >
              <FileBox className="w-5 h-5 text-muted-foreground" />
              <span>Import .3dm file</span>
            </Button>
          </div>

          {/* Recent projects */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-muted-foreground">Recent projects</h2>
              {recentProjects.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {recentProjects.length} {recentProjects.length === 1 ? "project" : "projects"}
                </span>
              )}
            </div>
            <div className="max-h-40 overflow-auto space-y-0.5">
              {!signedIn ? (
                <p className="text-sm text-muted-foreground/70 py-2">
                  Sign in to see your recent projects.
                </p>
              ) : recentProjects.length === 0 ? (
                <p className="text-sm text-muted-foreground/70 py-2">
                  No recent projects. Open a .3dm file to get started.
                </p>
              ) : (
                recentProjects.map((project) => (
                  <button
                    key={project.path}
                    onClick={() => handleOpenRecent(project.path)}
                    disabled={!isDesktop}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-md text-left hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
                  >
                    <span className="font-medium truncate flex-1 min-w-0">{project.name}</span>
                    <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                      {shortenPath(project.path)}
                    </span>
                    {isDesktop && (
                      <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Shared projects */}
          {features.team && signedIn && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" />
                  Shared with you
                </h2>
                {sharedWithMe.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {sharedWithMe.length} {sharedWithMe.length === 1 ? "project" : "projects"}
                  </span>
                )}
              </div>
              <div className="max-h-40 overflow-auto space-y-0.5">
                {loadingShared ? (
                  <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground/70">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Loading shared projects...
                  </div>
                ) : sharedWithMe.length === 0 ? (
                  <p className="text-sm text-muted-foreground/70 py-2">
                    No projects shared with you yet.
                  </p>
                ) : (
                  sharedWithMe.map((project) => {
                    const localPath = user ? getLocalPathForProject(user.id, project.id) : null;
                    const isDownloading = downloadingProjectId === project.id;

                    return (
                      <button
                        key={project.id}
                        onClick={() => handleOpenSharedProject(project)}
                        disabled={!isDesktop || isDownloading}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-md text-left hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
                      >
                        <Cloud className="w-4 h-4 text-info flex-shrink-0" />
                        <span className="font-medium truncate flex-1 min-w-0">{project.name}</span>
                        {isDownloading ? (
                          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground flex-shrink-0" />
                        ) : localPath ? (
                          <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                            {shortenPath(localPath)}
                          </span>
                        ) : (
                          <CloudDownload className="w-4 h-4 text-info opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Your cloud projects (owned) */}
          {signedIn && ownedProjects.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <Cloud className="w-3.5 h-3.5" />
                  Your cloud projects
                </h2>
                <span className="text-xs text-muted-foreground">
                  {ownedProjects.length} {ownedProjects.length === 1 ? "project" : "projects"}
                </span>
              </div>
              <div className="max-h-32 overflow-auto space-y-0.5">
                {ownedProjects.map((project) => {
                  const localPath = user ? getLocalPathForProject(user.id, project.id) : null;
                  const displayPath = localPath || project.s3_key;
                  return (
                    <button
                      key={project.id}
                      onClick={() => handleOpenSharedProject(project)}
                      disabled={!isDesktop}
                      className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-md text-left hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
                    >
                      <span className="font-medium truncate flex-1 min-w-0">{project.name}</span>
                      <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                        {shortenPath(displayPath)}
                      </span>
                      {isDesktop && (
                        <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
