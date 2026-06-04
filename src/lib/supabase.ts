// Supabase client configuration
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Read from environment variables
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

// Validate that we're using the anon key, not the service_role key
function validateAnonKey(key: string): boolean {
  if (!key) return false;

  // Service role keys typically start with specific patterns and are longer
  // Anon keys are shorter and have a different format
  // This is a basic check - service_role keys are usually 100+ chars, anon keys are ~100 chars
  // But the real check is if it contains "service_role" in the JWT payload (base64 decoded)

  // Check if key looks suspiciously long (service_role keys are usually longer)
  if (key.length > 150) {
    return false;
  }

  // Try to decode JWT to check the role (basic check)
  try {
    const parts = key.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1]));
      if (payload.role === 'service_role') {
        return false;
      }
    }
  } catch (e) {
    // If we can't decode, that's okay - just proceed with the key
  }

  return true;
}

// Validate Supabase URL format
function isValidSupabaseUrl(url: string): boolean {
  if (!url || url.trim() === '') return false;

  // Remove any trailing slashes
  const cleanUrl = url.trim().replace(/\/+$/, '');

  try {
    const urlObj = new URL(cleanUrl);
    const isValid =
      urlObj.protocol === 'https:' &&
      urlObj.hostname.endsWith('.supabase.co') &&
      urlObj.hostname.split('.').length === 3; // project-ref.supabase.co

    return isValid;
  } catch {
    return false;
  }
}

// Create Supabase client only if configuration is valid
let supabase: SupabaseClient;

if (supabaseUrl && supabaseAnonKey && isValidSupabaseUrl(supabaseUrl)) {
  // Validate key type before creating client
  if (!validateAnonKey(supabaseAnonKey)) {
    // Create a dummy client to prevent app crashes
    supabase = createClient('https://placeholder.supabase.co', 'placeholder-key');
  } else {
    try {
      supabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          // PKCE flow — main process drives the loopback OAuth handshake and
          // hands back tokens via setSession(). detectSessionInUrl is OFF
          // because window.location is meaningless in packaged Electron
          // (it's file://) and would otherwise trigger spurious session
          // attempts on every reload.
          flowType: 'pkce',
          detectSessionInUrl: false,
        },
      });
    } catch {
      // Create a dummy client to prevent app crashes
      supabase = createClient('https://placeholder.supabase.co', 'placeholder-key');
    }
  }
} else {
  // Create a dummy client to prevent app crashes, but it won't work
  supabase = createClient('https://placeholder.supabase.co', 'placeholder-key');
}

export { supabase };

// Database types matching your Supabase schema
export interface Project {
  id: string;
  name: string;
  s3_key: string;
  owner_id: string;
  created_at: string;
}

export interface Commit {
  id: string;
  project_id: string;
  parent_commit_id: string | null;
  message: string | null;
  author_id: string;
  s3_version_id: string;
  created_at: string;
}

export interface Branch {
  id: string;
  project_id: string;
  name: string;
  head_commit_id: string | null;
}

export type ProjectMemberRole = 'owner' | 'editor' | 'viewer';
export type ProjectMemberStatus = 'pending' | 'active' | 'removed';

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string | null;
  email: string;
  role: ProjectMemberRole;
  invited_by: string | null;
  status: ProjectMemberStatus;
  created_at: string;
  updated_at: string;
}

export interface Database {
  public: {
    Tables: {
      projects: {
        Row: Project;
        Insert: Omit<Project, 'id' | 'created_at'>;
        Update: Partial<Omit<Project, 'id' | 'created_at'>>;
      };
      commits: {
        Row: Commit;
        Insert: Omit<Commit, 'id' | 'created_at'>;
        Update: Partial<Omit<Commit, 'id' | 'created_at'>>;
      };
      branches: {
        Row: Branch;
        Insert: Omit<Branch, 'id'>;
        Update: Partial<Omit<Branch, 'id'>>;
      };
      project_members: {
        Row: ProjectMember;
        Insert: Omit<ProjectMember, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<ProjectMember, 'id' | 'created_at'>>;
      };
    };
  };
}
