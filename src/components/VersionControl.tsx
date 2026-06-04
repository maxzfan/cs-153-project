import { useState, useEffect, useMemo } from "react";
import { useViewMode } from "@/hooks/use-view-mode";
import { useModel } from "@/contexts/ModelContext";
import { useVersionControl, ModelCommit, Branch } from "@/contexts/VersionControlContext";
import { useCloudSync } from "@/contexts/CloudSyncContext";
import { useGallery } from "@/contexts/GalleryContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Archive, Save, Star, Download, Search, FolderOpen, X, Grid3x3, ArrowLeft, Cloud, CloudUpload, CloudDownload, Loader2, Check, ChevronRight, List, GitBranch } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { CommitPresenceAvatars } from '@/components/CommitPresenceAvatars';
import { TeamPresencePanel } from '@/components/TeamPresencePanel';
import { features } from '@/lib/features';

const formatTimeAgo = (timestamp: number) => {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
};

// Helper to build tree structure for visualization
interface CommitNode {
  commit: ModelCommit;
  branch: Branch | undefined;
  children: CommitNode[];
  x: number; // Column position (0 = main, 1 = first branch, etc.)
  yOffset: number; // Cumulative Y offset in pixels (accounts for variable row heights)
  height: number; // Row height: starred = 56px, un-starred = 36px
}

interface BranchingTreeProps {
  commits: ModelCommit[];
  branches: Branch[];
  currentCommitId: string | null;
  pulledCommitId: string | null;
  onRestoreCommit: (commitId: string) => void;
  onPullCommit: (commitId: string, e: React.MouseEvent) => void;
  onToggleStar: (commitId: string) => void;
  getVersionLabel: (commit: ModelCommit) => string;
  isGalleryMode: boolean;
  selectedCommitIds: Set<string>;
  onToggleSelection: (commitId: string) => void;
  cloudSyncedCommitIds: Set<string>;
  highlightedCommitIds?: Set<string>;
}

const BranchingTree = ({
  commits,
  branches,
  currentCommitId,
  pulledCommitId,
  onRestoreCommit,
  onPullCommit,
  onToggleStar,
  getVersionLabel,
  isGalleryMode,
  selectedCommitIds,
  onToggleSelection,
  cloudSyncedCommitIds,
  highlightedCommitIds,
}: BranchingTreeProps) => {
  // Build tree layout
  const { nodes, connections, maxX } = useMemo(() => {
    if (commits.length === 0) return { nodes: [], connections: [], maxX: 0 };

    // Sort commits by timestamp (oldest first for building tree)
    const sortedCommits = [...commits].sort((a, b) => a.timestamp - b.timestamp);
    
    // Group commits by branch
    const branchCommits = new Map<string, ModelCommit[]>();
    sortedCommits.forEach(commit => {
      const branchId = commit.branchId || 'main';
      if (!branchCommits.has(branchId)) {
        branchCommits.set(branchId, []);
      }
      branchCommits.get(branchId)!.push(commit);
    });
    
    // Assign x positions only to branches that have commits present
    const branchXPositions = new Map<string, number>();
    const mainBranch = branches.find(b => b.isMain);
    let currentX = 0;

    if (mainBranch && branchCommits.has(mainBranch.id)) {
      branchXPositions.set(mainBranch.id, currentX);
      currentX++;
    }

    // Sort non-main branches by their origin commit timestamp, only include branches with commits
    const nonMainBranches = branches
      .filter(b => !b.isMain && branchCommits.has(b.id))
      .sort((a, b) => {
        const aOrigin = commits.find(c => c.id === a.originCommitId);
        const bOrigin = commits.find(c => c.id === b.originCommitId);
        return (aOrigin?.timestamp || 0) - (bOrigin?.timestamp || 0);
      });

    nonMainBranches.forEach(branch => {
      branchXPositions.set(branch.id, currentX);
      currentX++;
    });
    
    // Build nodes with positions and cumulative Y offsets
    const starredHeight = 56;
    const unstarredHeight = 36;
    const nodes: CommitNode[] = [];
    const commitToNode = new Map<string, CommitNode>();

    // Sort commits by timestamp (newest first for display)
    const displayOrder = [...commits].sort((a, b) => b.timestamp - a.timestamp);

    let cumulativeY = 0;
    displayOrder.forEach((commit) => {
      const branch = branches.find(b => b.id === commit.branchId);
      const x = branchXPositions.get(commit.branchId) || 0;
      const height = commit.starred ? starredHeight : unstarredHeight;

      const node: CommitNode = {
        commit,
        branch,
        children: [],
        x,
        yOffset: cumulativeY,
        height,
      };

      cumulativeY += height;
      nodes.push(node);
      commitToNode.set(commit.id, node);
    });
    
    // Build connections (from child to parent)
    const connections: { from: CommitNode; to: CommitNode; isBranchPoint: boolean }[] = [];
    
    nodes.forEach(node => {
      if (node.commit.parentCommitId) {
        const parentNode = commitToNode.get(node.commit.parentCommitId);
        if (parentNode) {
          const isBranchPoint = node.x !== parentNode.x;
          connections.push({ from: node, to: parentNode, isBranchPoint });
        }
      }
    });
    
    return { nodes, connections, maxX: currentX - 1 };
  }, [commits, branches]);

  // Derive branch labels from the unique branches present in computed nodes
  const branchLabels = useMemo(() => {
    const seen = new Set<string>();
    const labels: { name: string; color: string; x: number }[] = [];
    nodes.forEach(node => {
      if (node.branch && !seen.has(node.branch.id)) {
        seen.add(node.branch.id);
        labels.push({ name: node.branch.name, color: node.branch.color, x: node.x });
      }
    });
    return labels.sort((a, b) => a.x - b.x);
  }, [nodes]);

  if (nodes.length === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-xs text-muted-foreground">No versions saved yet</p>
        <p className="text-xs text-muted-foreground mt-1">Save your first version to start tracking changes</p>
      </div>
    );
  }

  const columnWidth = 24; // Width between branch columns — SVG node y-positions depend on row heights being exactly 36/56px
  const nodeRadius = 5;
  const svgWidth = (maxX + 1) * columnWidth + 20;
  const totalHeight = nodes.length > 0 ? nodes[nodes.length - 1].yOffset + nodes[nodes.length - 1].height : 0;
  const branchLabelHeight = 20;

  return (
    <div className="relative">
      {/* Branch labels */}
      {branchLabels.length > 1 && (
        <div className="relative mb-1" style={{ height: branchLabelHeight }}>
          {branchLabels.map((label) => (
            <span
              key={label.name}
              className="absolute text-detail truncate text-muted-foreground"
              style={{
                left: label.x * columnWidth + 4,
                top: 0,
                fontSize: '9px',
                maxWidth: columnWidth * 2,
              }}
              title={label.name}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full mr-0.5" style={{ backgroundColor: label.color }} />
              {label.name}
            </span>
          ))}
        </div>
      )}
      {/* SVG for branch lines */}
      <svg
        className="absolute left-0 pointer-events-none"
        width={svgWidth}
        height={totalHeight}
        style={{ overflow: 'visible', top: branchLabels.length > 1 ? branchLabelHeight + 4 : 0 }}
      >
        {/* Draw connections */}
        {connections.map((conn, idx) => {
          const fromX = conn.from.x * columnWidth + 10 + nodeRadius;
          const fromY = conn.from.yOffset + nodeRadius + 6;
          const toX = conn.to.x * columnWidth + 10 + nodeRadius;
          const toY = conn.to.yOffset + nodeRadius + 6;
          
          const branchColor = conn.from.branch?.color || '#888';
          
          if (conn.isBranchPoint) {
            // Curved connection for branch point
            const midY = (fromY + toY) / 2;
            return (
              <g key={idx}>
                {/* Horizontal line from branch point */}
                <line
                  x1={toX}
                  y1={toY}
                  x2={fromX}
                  y2={toY}
                  stroke={branchColor}
                  strokeWidth={2}
                  strokeDasharray="4 2"
                />
                {/* Vertical line on the branch */}
                <line
                  x1={fromX}
                  y1={toY}
                  x2={fromX}
                  y2={fromY}
                  stroke={branchColor}
                  strokeWidth={2}
                />
              </g>
            );
          } else {
            // Straight vertical line
            return (
              <line
                key={idx}
                x1={fromX}
                y1={fromY}
                x2={toX}
                y2={toY}
                stroke={branchColor}
                strokeWidth={2}
              />
            );
          }
        })}
        
        {/* Draw nodes */}
        {nodes.map((node, idx) => {
          const x = node.x * columnWidth + 10 + nodeRadius;
          const y = node.yOffset + nodeRadius + 6;
          const isCurrentCommit = node.commit.id === currentCommitId;
          const isPulledCommit = node.commit.id === pulledCommitId;
          const branchColor = node.branch?.color || '#888';
          const isNodeDimmed = highlightedCommitIds && !highlightedCommitIds.has(node.commit.id);

          return (
            <g key={idx} opacity={isNodeDimmed ? 0.3 : 1}>
              {/* Outer ring for pulled commit highlight */}
              {isPulledCommit && (
                <circle
                  cx={x}
                  cy={y}
                  r={nodeRadius + 4}
                  fill="none"
                  stroke="#a3a3a3"
                  strokeWidth={2}
                  className="animate-pulse"
                />
              )}
              {/* Node circle */}
              <circle
                cx={x}
                cy={y}
                r={nodeRadius}
                fill={isCurrentCommit ? branchColor : 'transparent'}
                stroke={branchColor}
                strokeWidth={2}
              />
            </g>
          );
        })}
      </svg>
      
      {/* Commit items */}
      <div style={{ marginLeft: svgWidth, marginTop: branchLabels.length > 1 ? branchLabelHeight + 4 : 0 }}>
        {nodes.map((node) => {
          const isCurrentCommit = node.commit.id === currentCommitId;
          const isPulledCommit = node.commit.id === pulledCommitId;
          const versionLabel = getVersionLabel(node.commit);
          const isDimmed = highlightedCommitIds && !highlightedCommitIds.has(node.commit.id);

          return (
            <div
              key={node.commit.id}
              className={`flex gap-3 group cursor-pointer rounded-md px-2 transition-colors ${
                isPulledCommit
                  ? 'bg-secondary/30 ring-2 ring-border'
                  : isCurrentCommit
                  ? 'bg-primary/10'
                  : 'hover:bg-secondary/50'
              }`}
              style={{ height: node.height, opacity: isDimmed ? 0.3 : 1 }}
              onClick={(e) => {
                if (isDimmed) return;
                if ((e.target as HTMLElement).closest('.star-button')) return;
                if ((e.target as HTMLElement).closest('.pull-button')) return;
                if (!isCurrentCommit) onRestoreCommit(node.commit.id);
              }}
              title={
                isPulledCommit
                  ? 'Active working version (pulled)'
                  : isCurrentCommit
                  ? 'Current version'
                  : 'Click to restore to this version'
              }
            >
              {/* Checkbox for gallery mode */}
              {isGalleryMode && (
                <div className="flex items-start pt-2">
                  <Checkbox
                    checked={selectedCommitIds.has(node.commit.id)}
                    onCheckedChange={() => onToggleSelection(node.commit.id)}
                    disabled={!selectedCommitIds.has(node.commit.id) && selectedCommitIds.size >= 4}
                    title={
                      !selectedCommitIds.has(node.commit.id) && selectedCommitIds.size >= 4
                        ? 'Maximum of 4 models can be selected for gallery view'
                        : selectedCommitIds.has(node.commit.id)
                        ? 'Click to deselect'
                        : 'Click to select for gallery view'
                    }
                  />
                </div>
              )}

              {/* Content */}
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                {node.commit.starred ? (
                  /* Starred: two-line layout */
                  <>
                    <div className="flex items-center gap-2">
                      <button
                        className="star-button p-0.5 hover:bg-secondary rounded transition-colors shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleStar(node.commit.id);
                        }}
                        title="Unstar this version"
                      >
                        <Star className="w-3.5 h-3.5 fill-foreground text-foreground transition-colors" />
                      </button>
                      <p className="text-sm font-medium truncate">{node.commit.message}</p>
                      <div className="flex items-center gap-1 ml-auto shrink-0">
                        {cloudSyncedCommitIds.has(node.commit.id) && (
                          <Cloud className="w-3 h-3 text-info shrink-0" title="Synced to cloud" />
                        )}
                        {features.team && <CommitPresenceAvatars commitId={node.commit.id} />}
                        <span className="text-code text-xs text-muted-foreground">{versionLabel}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-7 mt-0.5">
                      <span className="text-xs text-muted-foreground">{formatTimeAgo(node.commit.timestamp)}</span>
                      {node.branch && !node.branch.isMain && (
                        <Badge variant="outline" className="text-detail px-1.5 py-0 h-4 border-border text-foreground">
                          {node.branch.name}
                        </Badge>
                      )}
                    </div>
                  </>
                ) : (
                  /* Un-starred: single-line layout */
                  <div className="flex items-center gap-2">
                    <button
                      className="star-button p-0.5 hover:bg-secondary rounded transition-colors shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleStar(node.commit.id);
                      }}
                      title="Star this version"
                    >
                      <Star className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground transition-colors" />
                    </button>
                    <p className="text-sm truncate">{node.commit.message}</p>
                    <div className="flex items-center gap-1 ml-auto shrink-0">
                      {cloudSyncedCommitIds.has(node.commit.id) && (
                        <Cloud className="w-3 h-3 text-info shrink-0" title="Synced to cloud" />
                      )}
                      {features.team && <CommitPresenceAvatars commitId={node.commit.id} />}
                      <span className="text-xs text-muted-foreground">{formatTimeAgo(node.commit.timestamp)}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Action buttons on hover */}
              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-start pt-2">
                <button
                  className="pull-button p-1 hover:bg-secondary rounded transition-colors"
                  onClick={(e) => onPullCommit(node.commit.id, e)}
                  title="Pull this version to local file (updates file on disk)"
                >
                  <Download className="w-3.5 h-3.5 text-muted-foreground hover:text-primary" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============ Branch List View (flat list grouped by branch) ============
const BranchListView = ({
  commits,
  branches,
  currentCommitId,
  pulledCommitId,
  onRestoreCommit,
  onPullCommit,
  onToggleStar,
  getVersionLabel,
  isGalleryMode,
  selectedCommitIds,
  onToggleSelection,
  cloudSyncedCommitIds,
}: BranchingTreeProps) => {
  const mainBranch = branches.find(b => b.isMain);
  const nonMainBranches = branches.filter(b => !b.isMain);

  const commitsByBranch = useMemo(() => {
    const grouped = new Map<string, ModelCommit[]>();
    const mainId = mainBranch?.id || 'main';
    grouped.set(mainId, []);
    nonMainBranches.forEach(b => grouped.set(b.id, []));

    commits.forEach(commit => {
      const branchId = commit.branchId || mainId;
      if (!grouped.has(branchId)) grouped.set(branchId, []);
      grouped.get(branchId)!.push(commit);
    });

    // Sort each branch's commits newest-first
    grouped.forEach((branchCommits) => {
      branchCommits.sort((a, b) => b.timestamp - a.timestamp);
    });

    return grouped;
  }, [commits, branches, mainBranch, nonMainBranches]);

  const starredHeight = 56;
  const unstarredHeight = 36;

  const renderCommitRow = (commit: ModelCommit) => {
    const isCurrentCommit = commit.id === currentCommitId;
    const isPulledCommit = commit.id === pulledCommitId;
    const branch = branches.find(b => b.id === commit.branchId);
    const versionLabel = getVersionLabel(commit);

    return (
      <div
        key={commit.id}
        className={`flex gap-3 group cursor-pointer rounded-md px-2 transition-colors ${
          isPulledCommit
            ? 'bg-secondary/30 ring-2 ring-border'
            : isCurrentCommit
            ? 'bg-primary/10'
            : 'hover:bg-secondary/50'
        }`}
        style={{ height: commit.starred ? starredHeight : unstarredHeight }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('.star-button')) return;
          if ((e.target as HTMLElement).closest('.pull-button')) return;
          if (!isCurrentCommit) onRestoreCommit(commit.id);
        }}
        title={
          isPulledCommit
            ? 'Active working version (pulled)'
            : isCurrentCommit
            ? `Current version${commit.authorEmail ? ` · ${commit.authorEmail}` : ''}`
            : `Click to restore to this version${commit.authorEmail ? ` · ${commit.authorEmail}` : ''}`
        }
      >
        {isGalleryMode && (
          <div className="flex items-start pt-2">
            <Checkbox
              checked={selectedCommitIds.has(commit.id)}
              onCheckedChange={() => onToggleSelection(commit.id)}
              disabled={!selectedCommitIds.has(commit.id) && selectedCommitIds.size >= 4}
            />
          </div>
        )}

        <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-2.5 ${
          isCurrentCommit ? 'bg-foreground' : 'border-2 border-muted-foreground'
        }`} />

        <div className="flex-1 min-w-0 flex flex-col justify-center">
          {commit.starred ? (
            <>
              <div className="flex items-center gap-2">
                <button
                  className="star-button p-0.5 hover:bg-secondary rounded transition-colors shrink-0"
                  onClick={(e) => { e.stopPropagation(); onToggleStar(commit.id); }}
                  title="Unstar this version"
                >
                  <Star className="w-3.5 h-3.5 fill-foreground text-foreground transition-colors" />
                </button>
                <p className="text-sm font-medium truncate">{commit.message}</p>
                <div className="flex items-center gap-1 ml-auto shrink-0">
                  {cloudSyncedCommitIds.has(commit.id) && (
                    <Cloud className="w-3 h-3 text-info shrink-0" title="Synced to cloud" />
                  )}
                  {features.team && <CommitPresenceAvatars commitId={commit.id} />}
                  <span className="text-code text-xs text-muted-foreground">{versionLabel}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-7 mt-0.5">
                {commit.authorEmail && (
                  <span className="text-xs text-muted-foreground truncate max-w-[120px]">{commit.authorEmail}</span>
                )}
                <span className="text-xs text-muted-foreground">{formatTimeAgo(commit.timestamp)}</span>
                {branch && !branch.isMain && (
                  <Badge variant="outline" className="text-detail px-1.5 py-0 h-4 border-border text-foreground">
                    {branch.name}
                  </Badge>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <button
                className="star-button p-0.5 hover:bg-secondary rounded transition-colors shrink-0"
                onClick={(e) => { e.stopPropagation(); onToggleStar(commit.id); }}
                title="Star this version"
              >
                <Star className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground transition-colors" />
              </button>
              <p className="text-sm truncate">{commit.message}</p>
              <div className="flex items-center gap-1 ml-auto shrink-0">
                {cloudSyncedCommitIds.has(commit.id) && (
                  <Cloud className="w-3 h-3 text-info shrink-0" title="Synced to cloud" />
                )}
                {features.team && <CommitPresenceAvatars commitId={commit.id} />}
                <span className="text-xs text-muted-foreground">{formatTimeAgo(commit.timestamp)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-start pt-2">
          <button
            className="pull-button p-1 hover:bg-secondary rounded transition-colors"
            onClick={(e) => onPullCommit(commit.id, e)}
            title="Pull this version to local file (updates file on disk)"
          >
            <Download className="w-3.5 h-3.5 text-muted-foreground hover:text-primary" />
          </button>
        </div>
      </div>
    );
  };

  const mainId = mainBranch?.id || 'main';
  const mainCommits = commitsByBranch.get(mainId) || [];

  if (commits.length === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-xs text-muted-foreground">No versions saved yet</p>
        <p className="text-xs text-muted-foreground mt-1">Save your first version to start tracking changes</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Main branch commits */}
      {mainCommits.map(renderCommitRow)}

      {/* Non-main branches as collapsible sections */}
      {nonMainBranches.map(branch => {
        const branchCommits = commitsByBranch.get(branch.id) || [];
        if (branchCommits.length === 0) return null;

        return (
          <Collapsible key={branch.id}>
            <CollapsibleTrigger className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-secondary/50 transition-colors group/branch">
              <ChevronRight className="w-3 h-3 text-muted-foreground transition-transform group-data-[state=open]/branch:rotate-90" />
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: branch.color }}
              />
              <span className="text-xs font-medium">{branch.name}</span>
              <span className="text-xs text-muted-foreground ml-auto">{branchCommits.length}</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="ml-3 border-l border-border pl-1">
                {branchCommits.map(renderCommitRow)}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
};

export const VersionControl = () => {
  const {
    currentFile, 
    fileName, 
    clearModel, 
    triggerFileDialog, 
    loadedModel,
  } = useModel();
  const {
    currentModel,
    modelName,
    commits,
    currentCommitId,
    hasUnsavedChanges,
    branches,
    pulledCommitId,
    setCurrentModel,
    commitModelChanges,
    restoreToCommit,
    pullFromCommit,
    markUnsavedChanges,
    clearCurrentModel,
    toggleStarCommit,
    getCommitVersionLabel,
  } = useVersionControl();
  const {
    isGalleryMode,
    selectedCommitIds,
    toggleGalleryMode,
    toggleCommitSelection,
    clearSelectedCommits,
    resetGallery,
  } = useGallery();
  const {
    cloudProject,
    cloudSyncedCommitIds,
    cloudSyncStatus,
    isCloudSyncing,
    pushToCloud,
    pullFromCloud,
    refreshCloudStatus,
  } = useCloudSync();
  
  const [commitMessage, setCommitMessage] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showStarredOnly, setShowStarredOnly] = useState(false);
  const [viewMode, setViewMode] = useViewMode();

  // When a model file is loaded, update the version control
  useEffect(() => {
    if (currentFile && currentFile !== currentModel) {
      setCurrentModel(currentFile);
    }
  }, [currentFile, currentModel, setCurrentModel]);

  const handleRestoreCommit = async (commitId: string) => {
    try {
      await restoreToCommit(commitId);
    } catch {
      toast.error('Failed to restore version');
    }
  };

  const handlePullCommit = async (commitId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await pullFromCommit(commitId);
    } catch {
      toast.error('Failed to pull version to disk');
    }
  };

  const handleCommit = async () => {
    if (!commitMessage.trim() || isCommitting) return;

    if (!hasUnsavedChanges || !loadedModel) {
      return;
    }

    setIsCommitting(true);

    try {
      await commitModelChanges(commitMessage.trim(), loadedModel);
      setCommitMessage("");
    } catch {
      toast.error("Failed to save version");
    } finally {
      setIsCommitting(false);
    }
  };

  const handleOpenNewModel = () => {
    triggerFileDialog();
  };

  const handleCloseModel = () => {
    clearModel();
    resetGallery();
    clearCurrentModel().catch(() => {});
  };

  // Filter commits based on search and starred filter
  const filteredCommits = useMemo(() => {
    let filtered = commits;
    
    if (showStarredOnly) {
      filtered = filtered.filter(commit => commit.starred);
    }
    
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(commit =>
        commit.message.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  }, [commits, showStarredOnly, searchQuery]);

  return (
    <div className="h-full flex flex-col panel-glass">
      {/* Header: back to all projects + current project name */}
      <div className="panel-header flex items-center gap-2 min-w-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCloseModel}
          className="h-6 px-2 shrink-0"
          title="Back to all projects"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </Button>
        <span className="font-medium text-sm truncate min-w-0" title={fileName ?? currentFile ?? undefined}>
          {fileName ?? "Project"}
        </span>
        <div className="flex items-center gap-1 ml-auto shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleOpenNewModel}
            className="h-6 px-2"
            title="Open new model"
          >
            <FolderOpen className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCloseModel}
            className="h-6 px-2"
            title="Close model"
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Commit Input */}
          {hasUnsavedChanges && (
            <section>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Save New Version
              </h3>
              <div className="space-y-2">
                <Input
                  placeholder="Describe these changes..."
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && commitMessage.trim()) {
                      handleCommit();
                    }
                  }}
                />
                {pulledCommitId && (
                  <p className="text-xs text-muted-foreground">
                    Creating new branch from {(() => { const c = commits.find(c => c.id === pulledCommitId); return c ? getCommitVersionLabel(c) : 'unknown version'; })()}
                  </p>
                )}
                <Button 
                  onClick={handleCommit} 
                  disabled={!commitMessage.trim() || isCommitting}
                  className="w-full gap-2"
                >
                  <Save className="w-4 h-4" />
                  {isCommitting ? "Saving Version..." : pulledCommitId ? "Create Branch & Save" : "Save Version"}
                </Button>
              </div>
            </section>
          )}

          {/* Cloud Sync Status */}
          {cloudProject && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {isCloudSyncing ? (
                <Loader2 className="w-3.5 h-3.5 text-info animate-spin shrink-0" />
              ) : (
                <Cloud className="w-3.5 h-3.5 text-info shrink-0" />
              )}
              <span className="truncate">{cloudProject.name}</span>
              {cloudSyncStatus && (
                <>
                  <span className="text-muted-foreground">·</span>
                  {cloudSyncStatus.localOnly.length === 0 && cloudSyncStatus.remoteOnly.length === 0 ? (
                    <span className="text-success flex items-center gap-1 shrink-0">
                      <Check className="w-3 h-3" /> Up to date
                    </span>
                  ) : (
                    <span className="flex items-center gap-2 shrink-0">
                      {cloudSyncStatus.localOnly.length > 0 && (
                        <span className="text-warning">{cloudSyncStatus.localOnly.length} to push</span>
                      )}
                      {cloudSyncStatus.remoteOnly.length > 0 && (
                        <span className="text-info">{cloudSyncStatus.remoteOnly.length} to pull</span>
                      )}
                    </span>
                  )}
                </>
              )}
            </div>
          )}

          {/* Team Presence */}
          {features.team && <TeamPresencePanel />}

          {/* Version History */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Version History ({commits.length})
              </h3>
              <div className="flex items-center gap-1">
                {commits.length > 0 && (
                  <>
                    {/* List / Graph toggle */}
                    <div className="flex items-center rounded-md border border-border h-6">
                      <button
                        onClick={() => setViewMode('list')}
                        className={`px-1.5 h-full rounded-l-md transition-colors ${
                          viewMode === 'list' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
                        }`}
                        title="List view"
                      >
                        <List className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setViewMode('graph')}
                        className={`px-1.5 h-full rounded-r-md transition-colors ${
                          viewMode === 'graph' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
                        }`}
                        title="Graph view"
                      >
                        <GitBranch className="w-3 h-3" />
                      </button>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={toggleGalleryMode}
                      className={`h-6 px-2 text-xs ${isGalleryMode ? 'bg-primary/10' : ''}`}
                      title={isGalleryMode ? 'Exit gallery mode' : 'Enter gallery mode to compare versions'}
                    >
                      <Grid3x3 className={`w-3 h-3 mr-1 ${isGalleryMode ? 'text-primary' : ''}`} />
                      Gallery
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowStarredOnly(!showStarredOnly)}
                      className="h-6 px-2 text-xs"
                    >
                      <Star className={`w-3 h-3 mr-1 ${showStarredOnly ? 'fill-foreground text-foreground' : 'text-muted-foreground'}`} />
                      {showStarredOnly ? 'Show All' : 'Starred'}
                    </Button>
                  </>
                )}
              </div>
            </div>
            
            {/* Search Input */}
            {commits.length > 0 && (
              <div className="relative mb-3">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search by commit message..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-8 text-xs"
                />
              </div>
            )}

            {/* Version list or graph */}
            {viewMode === 'list' ? (
              filteredCommits.length === 0 && commits.length > 0 ? (
                <div className="text-center py-4">
                  <p className="text-xs text-muted-foreground">
                    {showStarredOnly && searchQuery
                      ? 'No starred commits match your search'
                      : showStarredOnly
                      ? 'No starred commits yet'
                      : 'No commits match your search'}
                  </p>
                </div>
              ) : (
                <BranchListView
                  commits={filteredCommits}
                  branches={branches}
                  currentCommitId={currentCommitId}
                  pulledCommitId={pulledCommitId}
                  onRestoreCommit={handleRestoreCommit}
                  onPullCommit={handlePullCommit}
                  onToggleStar={toggleStarCommit}
                  getVersionLabel={getCommitVersionLabel}
                  isGalleryMode={isGalleryMode}
                  selectedCommitIds={selectedCommitIds}
                  onToggleSelection={toggleCommitSelection}
                  cloudSyncedCommitIds={cloudSyncedCommitIds}
                />
              )
            ) : (
              <BranchingTree
                commits={commits}
                branches={branches}
                currentCommitId={currentCommitId}
                pulledCommitId={pulledCommitId}
                onRestoreCommit={handleRestoreCommit}
                onPullCommit={handlePullCommit}
                onToggleStar={toggleStarCommit}
                getVersionLabel={getCommitVersionLabel}
                isGalleryMode={isGalleryMode}
                selectedCommitIds={selectedCommitIds}
                onToggleSelection={toggleCommitSelection}
                cloudSyncedCommitIds={cloudSyncedCommitIds}
                highlightedCommitIds={searchQuery || showStarredOnly ? new Set(filteredCommits.map(c => c.id)) : undefined}
              />
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  );
};
