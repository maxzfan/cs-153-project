/**
 * Authentication middleware factory.
 * Returns { verifyAuth, validateS3Key, checkProjectPermission }.
 */
export function createAuthMiddleware(supabase) {
  /**
   * Express middleware — verifies the Supabase JWT from the Authorization header
   * and attaches the user object to req.user.
   */
  async function verifyAuth(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
      }

      const token = authHeader.replace('Bearer ', '');

      const { data: { user }, error } = await supabase.auth.getUser(token);

      if (error) {
        return res.status(401).json({
          error: 'Invalid or expired token',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }

      if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      req.user = user;
      next();
    } catch (error) {
      res.status(401).json({ error: 'Authentication failed' });
    }
  }

  /**
   * Validates that an S3 key belongs to the given user.
   * Throws if the key prefix doesn't match.
   */
  function validateS3Key(s3Key, userId) {
    const expectedPrefix = `org-${userId}/`;
    if (!s3Key.startsWith(expectedPrefix)) {
      throw new Error('S3 key does not belong to user');
    }
  }

  /**
   * Checks whether a user has at least `minRole` on a project.
   * Returns { allowed: boolean, role: string | null }.
   */
  async function checkProjectPermission(projectId, userId, minRole = 'viewer', userEmail = null) {
    const roleHierarchy = { owner: 3, editor: 2, viewer: 1 };

    const { data: project } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single();

    if (project && project.owner_id === userId) {
      return { allowed: true, role: 'owner' };
    }

    let membership = null;
    const { data: byId } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();
    membership = byId;

    if (!membership && userEmail) {
      const { data: byEmail } = await supabase
        .from('project_members')
        .select('role')
        .eq('project_id', projectId)
        .eq('email', userEmail.toLowerCase())
        .eq('status', 'active')
        .single();
      membership = byEmail;
    }

    if (!membership) {
      return { allowed: false, role: null };
    }

    const userLevel = roleHierarchy[membership.role] || 0;
    const requiredLevel = roleHierarchy[minRole] || 0;

    return {
      allowed: userLevel >= requiredLevel,
      role: membership.role,
    };
  }

  /**
   * Express middleware factory — verifies the user has an active subscription.
   * Must be placed after verifyAuth in the middleware chain.
   */
  function verifySubscription(requiredPlans = ['student', 'enterprise']) {
    return async (req, res, next) => {
      try {
        const userId = req.user?.id;
        if (!userId) {
          return res.status(401).json({ error: 'Authentication required' });
        }

        const { data } = await supabase
          .from('subscriptions')
          .select('plan, status')
          .eq('user_id', userId)
          .eq('status', 'active')
          .single();

        if (!data || !requiredPlans.includes(data.plan)) {
          return res.status(403).json({
            error: 'subscription_required',
            message: 'An active subscription is required for this feature',
          });
        }

        req.subscription = data;
        next();
      } catch (error) {
        return res.status(403).json({
          error: 'subscription_required',
          message: 'An active subscription is required for this feature',
        });
      }
    };
  }

  return { verifyAuth, validateS3Key, checkProjectPermission, verifySubscription };
}
