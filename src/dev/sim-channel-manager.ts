import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import type { PresenceUser } from '../lib/presence-service';
import { SimUser, buildPresenceState } from './sim-users';

export class SimChannelManager {
  private supabase: SupabaseClient;
  private supabaseUrl: string;
  private supabaseAnonKey: string;
  private projectId: string | null = null;
  // Each simulated user gets its own Supabase client + channel to avoid
  // the single-client channel deduplication issue. One client can only have
  // one subscription per channel name — separate clients each get their own.
  private userClients: Map<string, SupabaseClient> = new Map();
  private channels: Map<string, RealtimeChannel> = new Map();
  private userStates: Map<string, PresenceUser> = new Map();

  constructor(supabaseUrl: string, supabaseAnonKey: string) {
    this.supabaseUrl = supabaseUrl;
    this.supabaseAnonKey = supabaseAnonKey;
    this.supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    });
  }

  getSupabase(): SupabaseClient {
    return this.supabase;
  }

  setProjectId(projectId: string) {
    this.projectId = projectId;
  }

  async activateUser(user: SimUser, commitId: string | null = null, status: string = ''): Promise<void> {
    if (!this.projectId) throw new Error('No project ID set');
    if (this.channels.has(user.userId)) return;

    const state = buildPresenceState(user, commitId, status);

    // Create a dedicated Supabase client for this user so it gets its own
    // WebSocket and can subscribe to the same channel name independently.
    const userClient = createClient(this.supabaseUrl, this.supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    this.userClients.set(user.userId, userClient);

    const channel = userClient.channel(`presence:project:${this.projectId}`, {
      config: { presence: { key: user.userId } },
    });

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        userClient.removeChannel(channel);
        this.userClients.delete(user.userId);
        reject(new Error(`Timeout subscribing ${user.displayName}`));
      }, 10000);

      channel
        .on('presence', { event: 'sync' }, () => {})
        .subscribe(async (subStatus) => {
          if (subStatus === 'SUBSCRIBED') {
            clearTimeout(timeout);
            await channel.track(state).catch((err) => console.warn(`[sim] track failed for ${user.displayName}:`, err));
            this.channels.set(user.userId, channel);
            this.userStates.set(user.userId, state);
            resolve();
          }
        });
    });
  }

  async deactivateUser(userId: string): Promise<void> {
    const channel = this.channels.get(userId);
    const userClient = this.userClients.get(userId);
    if (channel) {
      channel.untrack();
      if (userClient) {
        userClient.removeChannel(channel);
      }
    }
    this.channels.delete(userId);
    this.userStates.delete(userId);
    this.userClients.delete(userId);
  }

  async setCommit(userId: string, commitId: string | null): Promise<void> {
    const channel = this.channels.get(userId);
    const state = this.userStates.get(userId);
    if (!channel || !state) return;
    const updated = { ...state, currentCommitId: commitId };
    this.userStates.set(userId, updated);
    await channel.track(updated).catch((err) => console.warn(`[sim] track (setCommit) failed for ${userId}:`, err));
  }

  async setStatus(userId: string, statusMessage: string): Promise<void> {
    const channel = this.channels.get(userId);
    const state = this.userStates.get(userId);
    if (!channel || !state) return;
    const updated = { ...state, statusMessage };
    this.userStates.set(userId, updated);
    await channel.track(updated).catch((err) => console.warn(`[sim] track (setStatus) failed for ${userId}:`, err));
  }

  getState(userId: string): PresenceUser | null {
    return this.userStates.get(userId) ?? null;
  }

  isActive(userId: string): boolean {
    return this.channels.has(userId);
  }

  getActiveUserIds(): string[] {
    return Array.from(this.channels.keys());
  }

  async deactivateAll(): Promise<void> {
    const userIds = Array.from(this.channels.keys());
    await Promise.all(userIds.map((id) => this.deactivateUser(id)));
  }
}
