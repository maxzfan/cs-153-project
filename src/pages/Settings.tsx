import { useState, useEffect, useCallback } from 'react';
import { useTheme } from 'next-themes';
import { useAuth } from '@/contexts/AuthContext';
import { useModel } from '@/contexts/ModelContext';
import { useVersionControl } from '@/contexts/VersionControlContext';
import { TitleBar } from '@/components/TitleBar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useViewMode } from '@/hooks/use-view-mode';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  ArrowLeft,
  Cloud,
  User,
  FolderOpen,
  UserPlus,
  Trash2,
  Shield,
  Crown,
  Eye,
  Pencil,
  Mail,
  CreditCard,
  ExternalLink,
  Loader2,
  Users,
  RefreshCw,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { projectAPI, CloudProject, ProjectMemberWithEmail } from '@/lib/project-api';
import { ProjectMemberRole } from '@/lib/supabase';
import { cloudSyncService, RemoteTreeData } from '@/lib/cloud-sync-service';
import { features } from '@/lib/features';

// ============ Account Settings Tab ============
function AccountSettings() {
  const { user, paymentPlan, refreshPaymentStatus, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [viewMode, setViewMode] = useViewMode();

  const planLabel = !paymentPlan
    ? 'Free'
    : paymentPlan === 'student'
      ? 'Pro'
      : paymentPlan === 'enterprise'
        ? 'Enterprise'
        : 'Free';

  const handleRefreshPlan = async () => {
    setIsRefreshing(true);
    const found = await refreshPaymentStatus?.({ retryAfterPayment: true });
    setIsRefreshing(false);
    if (!found) {
      toast.info('No active subscription found. If you just subscribed, it may take a moment.');
    } else {
      toast.success('Plan status refreshed');
    }
  };

  return (
    <div className="space-y-8">
      {/* Profile Section */}
      <div>
        <h3 className="text-lg font-semibold mb-1">Profile</h3>
        <p className="text-sm text-muted-foreground mb-4">Your account information</p>
        <div className="space-y-4">
          <div className="flex items-center gap-4 p-4 rounded-lg border bg-card">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.email || 'Not signed in'}</p>
              <p className="text-xs text-muted-foreground">
                Member since {user?.created_at ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {features.payments && (
      <>
      <Separator />

      {/* Plan & Billing Section */}
      <div>
        <h3 className="text-lg font-semibold mb-1">Plan & Billing</h3>
        <p className="text-sm text-muted-foreground mb-4">Manage your subscription</p>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
            <div className="flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Current plan</p>
                <p className="text-xs text-muted-foreground">
                  {planLabel === 'Free' ? 'Local version control, unlimited commits' : planLabel === 'Pro' ? 'Cloud storage, team sharing (up to 5)' : 'Organization-wide collaboration'}
                </p>
              </div>
            </div>
            <Badge variant={paymentPlan ? 'default' : 'secondary'} className="ml-4">
              {planLabel}
            </Badge>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/dashboard')}
              className="gap-1.5"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {paymentPlan ? 'Change plan' : 'Upgrade'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefreshPlan}
              disabled={isRefreshing}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? 'Checking...' : 'Refresh status'}
            </Button>
          </div>
        </div>
      </div>
      </>
      )}

      <Separator />

      {/* Preferences Section */}
      <div>
        <h3 className="text-lg font-semibold mb-1">Preferences</h3>
        <p className="text-sm text-muted-foreground mb-4">App display settings</p>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
            <div>
              <p className="text-sm font-medium">Theme</p>
              <p className="text-xs text-muted-foreground">Application color scheme</p>
            </div>
            <Select value={theme} onValueChange={setTheme}>
              <SelectTrigger className="w-[120px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
            <div>
              <p className="text-sm font-medium">Version History View</p>
              <p className="text-xs text-muted-foreground">How versions are displayed in the sidebar</p>
            </div>
            <Select
              value={viewMode}
              onValueChange={(val) => setViewMode(val as 'list' | 'graph')}
            >
              <SelectTrigger className="w-[120px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="list">List</SelectItem>
                <SelectItem value="graph">Graph</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
            <div>
              <p className="text-sm font-medium">Auto-save commits</p>
              <p className="text-xs text-muted-foreground">Automatically detect and prompt for commits</p>
            </div>
            <Badge variant="outline">Enabled</Badge>
          </div>
        </div>
      </div>

      <Separator />

      {/* Account Actions */}
      <div>
        <h3 className="text-lg font-semibold mb-1">Account</h3>
        <p className="text-sm text-muted-foreground mb-4">Account management</p>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await signOut();
            navigate('/');
          }}
          className="text-destructive hover:text-destructive"
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}

// ============ Role Icon Helper ============
function RoleIcon({ role }: { role: ProjectMemberRole }) {
  switch (role) {
    case 'owner':
      return <Crown className="h-3.5 w-3.5 text-warning" />;
    case 'editor':
      return <Pencil className="h-3.5 w-3.5 text-info" />;
    case 'viewer':
      return <Eye className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function roleBadgeVariant(role: ProjectMemberRole): 'default' | 'secondary' | 'outline' {
  switch (role) {
    case 'owner':
      return 'default';
    case 'editor':
      return 'secondary';
    case 'viewer':
      return 'outline';
  }
}

// ============ Project Settings Tab ============
function ProjectSettings() {
  const { user } = useAuth();
  const { currentFile, fileName } = useModel();
  const {
    commits,
    branches,
    activeBranchId,
    currentCommitId,
    previouslyWorkingBranchId,
    cloudSyncedCommitIdsRef,
  } = useVersionControl();

  const [cloudProject, setCloudProject] = useState<CloudProject | null>(null);
  const [members, setMembers] = useState<ProjectMemberWithEmail[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<ProjectMemberRole>('viewer');
  const [isInviting, setIsInviting] = useState(false);

  const isOwner = cloudProject?.owner_id === user?.id;
  const currentUserMember = members.find(m => m.user_id === user?.id);
  const canManageMembers = isOwner || currentUserMember?.role === 'editor';
  const canChangeRoles = isOwner;

  // Load cloud project and members
  const loadProjectData = useCallback(async () => {
    if (!currentFile || !user) return;

    setIsLoading(true);
    try {
      const project = await projectAPI.getProjectByFilePath(currentFile);
      setCloudProject(project);

      if (project) {
        const memberData = await projectAPI.getProjectMembers(project.id);
        setMembers(memberData);
      }
    } catch {
      // Silent catch
    } finally {
      setIsLoading(false);
    }
  }, [currentFile, user]);

  useEffect(() => {
    loadProjectData();
  }, [loadProjectData]);

  // Register project for collaboration
  const handleRegisterProject = async () => {
    if (!currentFile || !fileName) return;

    setIsRegistering(true);
    try {
      const project = await projectAPI.registerProject(fileName.replace('.3dm', ''), currentFile);
      setCloudProject(project);

      // Push tree.json to S3 so the project is immediately usable
      const treeData: RemoteTreeData = {
        version: '1.0',
        activeBranchId,
        currentCommitId,
        previouslyWorkingBranchId,
        cloudSyncedCommitIds: Array.from(cloudSyncedCommitIdsRef.current),
        branches: branches.map(b => ({
          id: b.id,
          name: b.name,
          headCommitId: b.headCommitId,
          color: b.color,
          isMain: b.isMain,
          parentBranchId: b.parentBranchId,
          originCommitId: b.originCommitId,
        })),
        commits: commits.map(c => ({
          id: c.id,
          message: c.message,
          timestamp: c.timestamp,
          parentCommitId: c.parentCommitId,
          branchId: c.branchId,
          starred: c.starred || false,
        })),
      };
      await cloudSyncService.pushTreeJson(project.id, treeData);

      toast.success(features.team ? 'Project enabled for collaboration' : 'Cloud sync enabled');

      // Reload members
      const memberData = await projectAPI.getProjectMembers(project.id);
      setMembers(memberData);
    } catch (error: any) {
      toast.error(error.message || 'Failed to enable collaboration');
    } finally {
      setIsRegistering(false);
    }
  };

  // Invite member
  const handleInvite = async () => {
    if (!cloudProject || !inviteEmail.trim()) return;

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(inviteEmail.trim())) {
      toast.error('Please enter a valid email address');
      return;
    }

    setIsInviting(true);
    try {
      await projectAPI.inviteMember(cloudProject.id, inviteEmail.trim(), inviteRole);
      setInviteEmail('');
      setInviteRole('viewer');
      // Reload members
      const memberData = await projectAPI.getProjectMembers(cloudProject.id);
      setMembers(memberData);
    } catch {
      // Toast already shown in projectAPI
    } finally {
      setIsInviting(false);
    }
  };

  // Update member role
  const handleRoleChange = async (memberId: string, newRole: ProjectMemberRole) => {
    if (!cloudProject) return;

    try {
      await projectAPI.updateMemberRole(cloudProject.id, memberId, newRole);
      const memberData = await projectAPI.getProjectMembers(cloudProject.id);
      setMembers(memberData);
    } catch {
      // Toast already shown in projectAPI
    }
  };

  // Remove member
  const handleRemoveMember = async (memberId: string) => {
    if (!cloudProject) return;

    try {
      await projectAPI.removeMember(cloudProject.id, memberId);
      const memberData = await projectAPI.getProjectMembers(cloudProject.id);
      setMembers(memberData);
    } catch {
      // Toast already shown in projectAPI
    }
  };

  // No project open
  if (!currentFile) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FolderOpen className="h-12 w-12 text-muted-foreground/40 mb-4" />
        <h3 className="text-lg font-medium mb-2">No project open</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Open a .3dm file to access project settings, manage team members, and configure permissions.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Project Info */}
      <div>
        <h3 className="text-lg font-semibold mb-1">Project</h3>
        <p className="text-sm text-muted-foreground mb-4">Current project information</p>
        <div className="p-4 rounded-lg border bg-card">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <FolderOpen className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{fileName}</p>
              <p className="text-xs text-muted-foreground truncate">{currentFile}</p>
            </div>
            {cloudProject && (
              <Badge variant="secondary" className="shrink-0">
                <Cloud className="h-3 w-3 mr-1" />
                {features.team ? 'Collaboration enabled' : 'Cloud sync enabled'}
              </Badge>
            )}
          </div>
          {cloudProject && (
            <p className="text-xs text-muted-foreground mt-2 font-mono select-all">Project ID: {cloudProject.id}</p>
          )}
        </div>
      </div>

      <Separator />

      {/* Collaboration Section */}
      {!cloudProject ? (
        <div>
          <h3 className="text-lg font-semibold mb-1">{features.team ? 'Collaboration' : 'Cloud Sync'}</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {features.team
              ? 'Enable collaboration to invite team members and manage permissions'
              : 'Enable cloud sync to back up your versions to the cloud'}
          </p>
          <div className="p-6 rounded-lg border border-dashed bg-card/50 text-center">
            <Cloud className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-4">
              {features.team
                ? 'Register this project in the cloud to start collaborating with your team.'
                : 'Register this project in the cloud to sync your versions.'}
            </p>
            <Button
              onClick={handleRegisterProject}
              disabled={isRegistering}
              className="gap-2"
            >
              {isRegistering ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Cloud className="h-4 w-4" />
              )}
              {isRegistering ? 'Enabling...' : features.team ? 'Enable collaboration' : 'Enable cloud sync'}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {features.team && (
          <>
          {/* Team Members Section */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold mb-1">Team Members</h3>
                <p className="text-sm text-muted-foreground">
                  {members.length} member{members.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>

            {/* Member list */}
            <div className="space-y-2 mb-6">
              {members.map((member) => {
                const isSelf = member.user_id === user?.id;
                const memberIsOwner = member.role === 'owner';

                return (
                  <div
                    key={member.id}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-card"
                  >
                    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{member.email}</p>
                        {isSelf && (
                          <Badge variant="outline" className="text-detail px-1.5 py-0">
                            you
                          </Badge>
                        )}
                        {member.status === 'pending' && (
                          <Badge variant="outline" className="text-detail px-1.5 py-0 text-warning border-warning/30">
                            pending
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Role selector (only for owners editing non-self members) */}
                      {canChangeRoles && !isSelf && !memberIsOwner ? (
                        <Select
                          value={member.role}
                          onValueChange={(value) =>
                            handleRoleChange(member.id, value as ProjectMemberRole)
                          }
                        >
                          <SelectTrigger className="h-7 w-[100px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="editor">
                              <span className="flex items-center gap-1.5">
                                <Pencil className="h-3 w-3" /> Editor
                              </span>
                            </SelectItem>
                            <SelectItem value="viewer">
                              <span className="flex items-center gap-1.5">
                                <Eye className="h-3 w-3" /> Viewer
                              </span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant={roleBadgeVariant(member.role)} className="gap-1 text-xs">
                          <RoleIcon role={member.role} />
                          {member.role}
                        </Badge>
                      )}

                      {/* Remove button (only for owners removing non-self members) */}
                      {canChangeRoles && !isSelf && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove team member</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to remove{' '}
                                <strong>{member.email}</strong> from this project? They will lose access immediately.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleRemoveMember(member.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Invite form */}
            {canManageMembers && (
              <>
                <Separator className="mb-6" />
                <div>
                  <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <UserPlus className="h-4 w-4" />
                    Invite a team member
                  </h4>
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="email@example.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleInvite();
                      }}
                      className="flex-1"
                    />
                    <Select
                      value={inviteRole}
                      onValueChange={(value) => setInviteRole(value as ProjectMemberRole)}
                    >
                      <SelectTrigger className="w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="editor">
                          <span className="flex items-center gap-1.5">
                            <Pencil className="h-3 w-3" /> Editor
                          </span>
                        </SelectItem>
                        <SelectItem value="viewer">
                          <span className="flex items-center gap-1.5">
                            <Eye className="h-3 w-3" /> Viewer
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={handleInvite}
                      disabled={isInviting || !inviteEmail.trim()}
                      className="gap-1.5"
                    >
                      {isInviting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <UserPlus className="h-4 w-4" />
                      )}
                      Invite
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Invited users will get access when they sign in with this email.
                  </p>
                </div>
              </>
            )}
          </div>

          <Separator />

          {/* Permissions Legend */}
          <div>
            <h3 className="text-lg font-semibold mb-1">Permission Levels</h3>
            <p className="text-sm text-muted-foreground mb-4">What each role can do</p>
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                <Crown className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Owner</p>
                  <p className="text-xs text-muted-foreground">
                    Full access. Can manage members, change roles, delete project, and all editor permissions.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                <Pencil className="h-4 w-4 text-info mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Editor</p>
                  <p className="text-xs text-muted-foreground">
                    Can commit changes, create branches, pull versions, and invite new members.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                <Eye className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Viewer</p>
                  <p className="text-xs text-muted-foreground">
                    Can view the project, browse commits and branches, but cannot make changes.
                  </p>
                </div>
              </div>
            </div>
          </div>
          </>
          )}
        </>
      )}
    </div>
  );
}

// ============ Main Settings Page ============
function SettingsContent() {
  const { user } = useAuth();
  const { currentFile } = useModel();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const defaultTab = searchParams.get('tab') || (currentFile ? 'project' : 'account');

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <User className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
          <h2 className="text-lg font-medium mb-2">Sign in required</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Please sign in to access settings.
          </p>
          <Button variant="outline" onClick={() => navigate('/')}>
            Go back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-2xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/')}
            className="shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Manage your account and project settings
            </p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue={defaultTab} className="w-full">
          <TabsList className="w-full mb-6">
            <TabsTrigger value="account" className="flex-1 gap-2">
              <User className="h-4 w-4" />
              Account
            </TabsTrigger>
            <TabsTrigger value="project" className="flex-1 gap-2">
              <FolderOpen className="h-4 w-4" />
              Project
              {currentFile && (
                <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="account">
            <AccountSettings />
          </TabsContent>

          <TabsContent value="project">
            <ProjectSettings />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default function Settings() {
  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TitleBar />
      <SettingsContent />
    </div>
  );
}
