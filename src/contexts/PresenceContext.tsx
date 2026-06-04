import React, {
  createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode,
} from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { PresenceService, PresenceUser } from '@/lib/presence-service';

interface PresenceContextType {
  onlineUsers: PresenceUser[];
  myUserId: string | null;
  updatePresenceCommit: (commitId: string | null) => Promise<void>;
  updatePresenceStatus: (message: string) => Promise<void>;
  updatePushingState: (isPushing: boolean) => Promise<void>;
  joinProject: (projectId: string) => void;
  leaveProject: () => void;
}

const PresenceContext = createContext<PresenceContextType | null>(null);

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const serviceRef = useRef<PresenceService>(new PresenceService(supabase));
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);

  // Clean up on unmount
  useEffect(() => {
    const svc = serviceRef.current;
    return () => svc.leave();
  }, []);

  // Leave channel when user signs out
  useEffect(() => {
    if (!user) {
      serviceRef.current.leave();
      setOnlineUsers([]);
    }
  }, [user]);

  const joinProject = useCallback((projectId: string) => {
    if (!user) return;
    serviceRef.current.join(projectId, { id: user.id, email: user.email ?? '' }, setOnlineUsers);
  }, [user]);

  const leaveProject = useCallback(() => {
    serviceRef.current.leave();
    setOnlineUsers([]);
  }, []);

  const updatePresenceCommit = useCallback(async (commitId: string | null) => {
    await serviceRef.current.updateCommit(commitId);
  }, []);

  const updatePresenceStatus = useCallback(async (message: string) => {
    await serviceRef.current.updateStatus(message);
  }, []);

  const updatePushingState = useCallback(async (isPushing: boolean) => {
    await serviceRef.current.updatePushing(isPushing);
  }, []);

  return (
    <PresenceContext.Provider value={{
      onlineUsers,
      myUserId: user?.id ?? null,
      updatePresenceCommit,
      updatePresenceStatus,
      updatePushingState,
      joinProject,
      leaveProject,
    }}>
      {children}
    </PresenceContext.Provider>
  );
}

/** No-op provider used when features.team is false */
export function PresenceProviderNoop({ children }: { children: ReactNode }) {
  return (
    <PresenceContext.Provider value={{
      onlineUsers: [],
      myUserId: null,
      updatePresenceCommit: async () => {},
      updatePresenceStatus: async () => {},
      updatePushingState: async () => {},
      joinProject: () => {},
      leaveProject: () => {},
    }}>
      {children}
    </PresenceContext.Provider>
  );
}

export function usePresence() {
  const ctx = useContext(PresenceContext);
  if (!ctx) throw new Error('usePresence must be used inside PresenceProvider');
  return ctx;
}
