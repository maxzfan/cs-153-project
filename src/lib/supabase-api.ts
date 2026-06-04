// Supabase API service for projects, commits, and branches
import { supabase, Project, Commit, Branch } from './supabase';
import { toast } from 'sonner';
import { PostgrestError } from '@supabase/supabase-js';

// Helper function for consistent error handling
function handleSupabaseError(error: PostgrestError | null, defaultMessage: string): never {
  if (error) {
    const message = error.message || defaultMessage;
    toast.error(message);
    throw new Error(message);
  }
  throw new Error(defaultMessage);
}

export class SupabaseAPI {
  // ============ PROJECTS ============
  
  /**
   * Create a new project
   */
  async createProject(name: string, s3Key: string, ownerId: string): Promise<Project> {
    try {
      const { data, error } = await supabase
        .from('projects')
        .insert({
          name,
          s3_key: s3Key,
          owner_id: ownerId,
        })
        .select()
        .single();

      if (error) handleSupabaseError(error, 'Failed to create project');
      return data;
    } catch (error) {
      // Error already handled by handleSupabaseError
      throw error;
    }
  }

  /**
   * Get all projects for a user
   */
  async getProjects(ownerId: string): Promise<Project[]> {
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: false });

      if (error) handleSupabaseError(error, 'Failed to fetch projects');
      return data || [];
    } catch (error) {
      // Error already handled by handleSupabaseError
      throw error;
    }
  }

  /**
   * Get a single project by ID
   */
  async getProject(projectId: string): Promise<Project | null> {
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();

      if (error) {
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Update a project
   */
  async updateProject(projectId: string, updates: Partial<Project>): Promise<Project> {
    try {
      const { data, error } = await supabase
        .from('projects')
        .update(updates)
        .eq('id', projectId)
        .select()
        .single();

      if (error) handleSupabaseError(error, 'Failed to update project');
      return data;
    } catch (error) {
      // Error already handled by handleSupabaseError
      throw error;
    }
  }

  /**
   * Delete a project (cascades to commits and branches)
   */
  async deleteProject(projectId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectId);

      if (error) handleSupabaseError(error, 'Failed to delete project');
    } catch (error) {
      // Error already handled by handleSupabaseError
      throw error;
    }
  }

  // ============ COMMITS ============

  /**
   * Create a new commit
   */
  async createCommit(
    projectId: string,
    parentCommitId: string | null,
    message: string | null,
    authorId: string,
    s3VersionId: string
  ): Promise<Commit> {
    try {
      const { data, error } = await supabase
        .from('commits')
        .insert({
          project_id: projectId,
          parent_commit_id: parentCommitId,
          message,
          author_id: authorId,
          s3_version_id: s3VersionId,
        })
        .select()
        .single();

      if (error) handleSupabaseError(error, 'Failed to create commit');
      return data;
    } catch (error) {
      // Error already handled by handleSupabaseError
      throw error;
    }
  }

  /**
   * Get all commits for a project
   */
  async getCommits(projectId: string): Promise<Commit[]> {
    try {
      const { data, error } = await supabase
        .from('commits')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (error) handleSupabaseError(error, 'Failed to fetch commits');
      return data || [];
    } catch (error) {
      // Error already handled by handleSupabaseError
      throw error;
    }
  }

  /**
   * Get a single commit by ID
   */
  async getCommit(commitId: string): Promise<Commit | null> {
    try {
      const { data, error } = await supabase
        .from('commits')
        .select('*')
        .eq('id', commitId)
        .single();

      if (error) {
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Get commit history (chain of commits from a specific commit)
   */
  async getCommitHistory(commitId: string): Promise<Commit[]> {
    const history: Commit[] = [];
    let currentCommitId: string | null = commitId;

    while (currentCommitId) {
      const commit = await this.getCommit(currentCommitId);
      if (!commit) break;
      
      history.push(commit);
      currentCommitId = commit.parent_commit_id;
    }

    return history;
  }

  // ============ BRANCHES ============

  /**
   * Create a new branch
   */
  async createBranch(
    projectId: string,
    name: string,
    headCommitId: string | null = null
  ): Promise<Branch> {
    try {
      const { data, error } = await supabase
        .from('branches')
        .insert({
          project_id: projectId,
          name,
          head_commit_id: headCommitId,
        })
        .select()
        .single();

      if (error) handleSupabaseError(error, 'Failed to create branch');
      return data;
    } catch (error) {
      // Error already handled by handleSupabaseError
      throw error;
    }
  }

  /**
   * Get all branches for a project
   */
  async getBranches(projectId: string): Promise<Branch[]> {
    try {
      const { data, error } = await supabase
        .from('branches')
        .select('*')
        .eq('project_id', projectId)
        .order('name', { ascending: true });

      if (error) handleSupabaseError(error, 'Failed to fetch branches');
      return data || [];
    } catch (error) {
      // Error already handled by handleSupabaseError
      throw error;
    }
  }

  /**
   * Get a single branch by ID
   */
  async getBranch(branchId: string): Promise<Branch | null> {
    try {
      const { data, error } = await supabase
        .from('branches')
        .select('*')
        .eq('id', branchId)
        .single();

      if (error) {
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Get branch by project and name
   */
  async getBranchByName(projectId: string, name: string): Promise<Branch | null> {
    try {
      const { data, error } = await supabase
        .from('branches')
        .select('*')
        .eq('project_id', projectId)
        .eq('name', name)
        .single();

      if (error) {
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Update branch head commit
   */
  async updateBranchHead(branchId: string, headCommitId: string): Promise<Branch> {
    try {
      const { data, error } = await supabase
        .from('branches')
        .update({ head_commit_id: headCommitId })
        .eq('id', branchId)
        .select()
        .single();

      if (error) handleSupabaseError(error, 'Failed to update branch');
      return data;
    } catch (error) {
      // Error already handled by handleSupabaseError
      throw error;
    }
  }

  /**
   * Delete a branch
   */
  async deleteBranch(branchId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('branches')
        .delete()
        .eq('id', branchId);

      if (error) handleSupabaseError(error, 'Failed to delete branch');
    } catch (error) {
      // Error already handled by handleSupabaseError
      throw error;
    }
  }
}

// Export singleton instance
export const supabaseAPI = new SupabaseAPI();

