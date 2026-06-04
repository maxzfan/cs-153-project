import { Router } from 'express';

/**
 * Project CRUD + member management routes mounted at /api/projects.
 * Returns an Express Router.
 */
export function createProjectRoutes({ supabase, verifyAuth, checkProjectPermission, verifySubscription, resolvePendingInvites, sendProjectInviteEmail }) {
  const router = Router();

  // Register a project in the cloud
  router.post('/', verifyAuth, verifySubscription(), async (req, res) => {
    try {
      const { name, file_path } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'Missing project name' });
      }

      // Check if project already exists for this file path and user
      if (file_path) {
        const { data: existing } = await supabase
          .from('projects')
          .select('*')
          .eq('owner_id', req.user.id)
          .eq('s3_key', file_path)
          .single();

        if (existing) {
          return res.json(existing);
        }
      }

      const s3Key = file_path || `org-${req.user.id}/project-${Date.now()}`;

      const { data: project, error } = await supabase
        .from('projects')
        .insert({
          name,
          s3_key: s3Key,
          owner_id: req.user.id,
        })
        .select()
        .single();

      if (error) {
        return res.status(500).json({ error: 'Failed to create project' });
      }

      // Auto-add the creator as owner in project_members
      await supabase.from('project_members').insert({
        project_id: project.id,
        user_id: req.user.id,
        email: req.user.email,
        role: 'owner',
        invited_by: req.user.id,
        status: 'active',
      });

      res.json(project);
    } catch (error) {
      res.status(500).json({ error: 'Failed to register project' });
    }
  });

  // Get projects the user owns or is a member of
  router.get('/user-projects', verifyAuth, async (req, res) => {
    try {
      // Resolve any pending invites so shared projects show up immediately
      await resolvePendingInvites(req.user);

      // Get projects user owns
      const { data: ownedProjects, error: ownedError } = await supabase
        .from('projects')
        .select('*')
        .eq('owner_id', req.user.id)
        .order('created_at', { ascending: false });

      if (ownedError) {
        return res.status(500).json({ error: 'Failed to fetch projects' });
      }

      // Get projects user is a member of (by user_id or email)
      const memberFilters = [`user_id.eq.${req.user.id}`];
      if (req.user.email) {
        memberFilters.push(`email.eq.${req.user.email.toLowerCase()}`);
      }
      const { data: memberships, error: memberError } = await supabase
        .from('project_members')
        .select('project_id')
        .or(memberFilters.join(','))
        .eq('status', 'active')
        .neq('role', 'owner');

      if (memberError) {
        return res.status(500).json({ error: 'Failed to fetch projects' });
      }

      let memberProjects = [];
      if (memberships && memberships.length > 0) {
        const projectIds = [...new Set(memberships.map(m => m.project_id))];
        const { data: projects, error: projError } = await supabase
          .from('projects')
          .select('*')
          .in('id', projectIds)
          .order('created_at', { ascending: false });

        if (!projError && projects) {
          memberProjects = projects;
        }
      }

      // Combine and deduplicate
      const allProjects = [...(ownedProjects || []), ...memberProjects];
      const seen = new Set();
      const unique = allProjects.filter(p => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });

      res.json({ projects: unique });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch projects' });
    }
  });

  // Get project by file path
  router.get('/by-path', verifyAuth, async (req, res) => {
    try {
      const { file_path } = req.query;

      if (!file_path) {
        return res.status(400).json({ error: 'Missing file_path parameter' });
      }

      const { data: project, error } = await supabase
        .from('projects')
        .select('*')
        .eq('s3_key', file_path)
        .single();

      if (error && error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Project not found' });
      }

      if (error) {
        return res.status(500).json({ error: 'Failed to fetch project' });
      }

      // Verify user has access
      if (project.owner_id !== req.user.id) {
        const { data: membership } = await supabase
          .from('project_members')
          .select('*')
          .eq('project_id', project.id)
          .eq('user_id', req.user.id)
          .eq('status', 'active')
          .single();

        if (!membership) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      res.json(project);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch project' });
    }
  });

  // Get project members
  router.get('/:projectId/members', verifyAuth, async (req, res) => {
    try {
      const { projectId } = req.params;

      const permission = await checkProjectPermission(projectId, req.user.id, 'viewer', req.user.email);
      if (!permission.allowed) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const { data: members, error } = await supabase
        .from('project_members')
        .select('*')
        .eq('project_id', projectId)
        .neq('status', 'removed')
        .order('created_at', { ascending: true });

      if (error) {
        return res.status(500).json({ error: 'Failed to fetch members' });
      }

      res.json({ members: members || [] });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch members' });
    }
  });

  // Invite a member to a project
  router.post('/:projectId/members', verifyAuth, verifySubscription(), async (req, res) => {
    try {
      const { projectId } = req.params;
      const { email, role = 'viewer' } = req.body;

      if (!email) {
        return res.status(400).json({ error: 'Missing email parameter' });
      }

      if (!['owner', 'editor', 'viewer'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role. Must be owner, editor, or viewer' });
      }

      const permission = await checkProjectPermission(projectId, req.user.id, 'editor', req.user.email);
      if (!permission.allowed) {
        return res.status(403).json({ error: 'You need editor or owner access to invite members' });
      }

      if (role === 'owner' && permission.role !== 'owner') {
        return res.status(403).json({ error: 'Only project owners can assign the owner role' });
      }

      // Check if member already exists
      const { data: existing } = await supabase
        .from('project_members')
        .select('*')
        .eq('project_id', projectId)
        .eq('email', email.toLowerCase())
        .neq('status', 'removed')
        .single();

      if (existing) {
        return res.status(409).json({ error: 'User is already a member of this project' });
      }

      // Try to find the user by email in Supabase auth
      let userId = null;
      const { data: userData } = await supabase.auth.admin.listUsers({ filter: email, perPage: 1 });
      if (userData?.users?.length > 0) {
        const matchedUser = userData.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
        if (matchedUser) {
          userId = matchedUser.id;
        }
      }

      // Create the member record
      const { data: member, error } = await supabase
        .from('project_members')
        .insert({
          project_id: projectId,
          user_id: userId,
          email: email.toLowerCase(),
          role,
          invited_by: req.user.id,
          status: userId ? 'active' : 'pending',
        })
        .select()
        .single();

      if (error) {
        return res.status(500).json({ error: 'Failed to invite member' });
      }

      // Send invite email via SES
      const { data: project } = await supabase
        .from('projects')
        .select('name')
        .eq('id', projectId)
        .single();
      const projectName = project?.name || 'Unnamed project';
      await sendProjectInviteEmail({
        toEmail: email.toLowerCase(),
        projectName,
        inviterEmail: req.user.email || 'A team member',
        role,
        appUrl: process.env.FRONTEND_URL,
      });

      res.json({ member });
    } catch (error) {
      res.status(500).json({ error: 'Failed to invite member' });
    }
  });

  // Update a member's role
  router.put('/:projectId/members/:memberId/role', verifyAuth, async (req, res) => {
    try {
      const { projectId, memberId } = req.params;
      const { role } = req.body;

      if (!role || !['owner', 'editor', 'viewer'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role. Must be owner, editor, or viewer' });
      }

      const permission = await checkProjectPermission(projectId, req.user.id, 'owner', req.user.email);
      if (!permission.allowed) {
        return res.status(403).json({ error: 'Only project owners can change member roles' });
      }

      const { data: targetMember } = await supabase
        .from('project_members')
        .select('*')
        .eq('id', memberId)
        .eq('project_id', projectId)
        .single();

      if (!targetMember) {
        return res.status(404).json({ error: 'Member not found' });
      }

      if (targetMember.user_id === req.user.id) {
        return res.status(400).json({ error: 'Cannot change your own role' });
      }

      const { data: updatedMember, error } = await supabase
        .from('project_members')
        .update({
          role,
          updated_at: new Date().toISOString(),
        })
        .eq('id', memberId)
        .eq('project_id', projectId)
        .select()
        .single();

      if (error) {
        return res.status(500).json({ error: 'Failed to update role' });
      }

      res.json({ member: updatedMember });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update role' });
    }
  });

  // Remove a member from a project
  router.delete('/:projectId/members/:memberId', verifyAuth, async (req, res) => {
    try {
      const { projectId, memberId } = req.params;

      const permission = await checkProjectPermission(projectId, req.user.id, 'owner', req.user.email);
      if (!permission.allowed) {
        return res.status(403).json({ error: 'Only project owners can remove members' });
      }

      const { data: targetMember } = await supabase
        .from('project_members')
        .select('*')
        .eq('id', memberId)
        .eq('project_id', projectId)
        .single();

      if (!targetMember) {
        return res.status(404).json({ error: 'Member not found' });
      }

      if (targetMember.user_id === req.user.id) {
        return res.status(400).json({ error: 'Cannot remove yourself from the project' });
      }

      const { error } = await supabase
        .from('project_members')
        .update({
          status: 'removed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', memberId)
        .eq('project_id', projectId);

      if (error) {
        return res.status(500).json({ error: 'Failed to remove member' });
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to remove member' });
    }
  });

  return router;
}
