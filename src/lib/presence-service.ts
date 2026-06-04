import { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

export interface PresenceUser {
  userId: string;
  email: string;
  displayName: string; // first part of email
  color: string;       // deterministic color from userId
  currentCommitId: string | null;
  statusMessage: string;
  isPushing?: boolean;
  joinedAt: number;
}

// 8 distinct colors for team member avatars
export const PRESENCE_COLORS = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981',
  '#3b82f6', '#ef4444', '#8b5cf6', '#14b8a6',
];

export function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
}

function displayName(email: string): string {
  return email.split('@')[0];
}

export type PresenceChangeCallback = (users: PresenceUser[]) => void;

export class PresenceService {
  private supabase: SupabaseClient;
  private channel: RealtimeChannel | null = null;
  private projectId: string | null = null;
  private myState: Partial<PresenceUser> = {};
  private onChange: PresenceChangeCallback | null = null;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  join(projectId: string, user: { id: string; email: string }, onChange: PresenceChangeCallback) {
    // Leave any existing channel first
    this.leave();

    this.projectId = projectId;
    this.onChange = onChange;
    this.myState = {
      userId: user.id,
      email: user.email,
      displayName: displayName(user.email),
      color: colorForUser(user.id),
      currentCommitId: null,
      statusMessage: '',
      joinedAt: Date.now(),
    };

    this.channel = this.supabase.channel(`presence:project:${projectId}`, {
      config: { presence: { key: user.id } },
    });

    this.channel
      .on('presence', { event: 'sync' }, () => {
        this._emitState();
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await this.channel!.track(this.myState);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Reconnect after a brief delay
          setTimeout(() => {
            if (this.projectId && this.onChange) {
              const pid = this.projectId;
              const cb = this.onChange;
              const state = this.myState;
              this.leave();
              // Re-join uses the stored state
              this.join(pid, { id: state.userId!, email: state.email! }, cb);
            }
          }, 3000);
        }
      });
  }

  async updateCommit(commitId: string | null) {
    if (!this.channel) return;
    this.myState = { ...this.myState, currentCommitId: commitId };
    await this._track();
  }

  async updateStatus(statusMessage: string) {
    if (!this.channel) return;
    this.myState = { ...this.myState, statusMessage };
    await this._track();
  }

  async updatePushing(isPushing: boolean) {
    if (!this.channel) return;
    this.myState = { ...this.myState, isPushing };
    await this._track();
  }

  leave() {
    if (this.channel) {
      this.channel.untrack();
      this.supabase.removeChannel(this.channel);
      this.channel = null;
      this.projectId = null;
      this.onChange = null;
    }
  }

  private async _track() {
    if (this.channel) {
      await this.channel.track(this.myState).catch(() => {
        // Presence broadcast failures are non-fatal; swallow silently
      });
    }
  }

  private _emitState() {
    if (!this.channel || !this.onChange) return;
    const state = this.channel.presenceState<Partial<PresenceUser>>();
    const users: PresenceUser[] = Object.values(state)
      .flat()
      .map((p) => p as PresenceUser)
      .filter((p) => p.userId && p.email)
      .sort((a, b) => a.joinedAt - b.joinedAt);
    this.onChange(users);
  }
}
