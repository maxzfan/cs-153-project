import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from "react";
import { useAuth } from "@/contexts/AuthContext";

const STORAGE_KEY_PREFIX = "0studio_recent_projects";
const MAX_RECENT = 10;

function storageKey(userId: string) {
  return `${STORAGE_KEY_PREFIX}_${userId}`;
}

export interface RecentProject {
  name: string;
  path: string;
  openedAt: number;
}

interface RecentProjectsContextType {
  recentProjects: RecentProject[];
  addRecentProject: (path: string, name?: string) => void;
  removeRecentProject: (path: string) => void;
  clearRecentProjects: () => void;
}

const RecentProjectsContext = createContext<RecentProjectsContextType | null>(null);

function loadFromStorage(userId: string | null): RecentProject[] {
  if (!userId) return [];
  try {
    const stored = localStorage.getItem(storageKey(userId));
    if (stored) {
      const parsed = JSON.parse(stored) as RecentProject[];
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    // Silent catch
  }
  return [];
}

function saveToStorage(projects: RecentProject[], userId: string | null) {
  if (!userId) return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(projects));
  } catch {
    // Silent catch
  }
}

export function RecentProjectsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(() =>
    loadFromStorage(userId)
  );

  // When user signs in/out (or switches account), load that user's list or show empty
  useEffect(() => {
    setRecentProjects(loadFromStorage(userId));
  }, [userId]);

  useEffect(() => {
    saveToStorage(recentProjects, userId);
  }, [recentProjects, userId]);

  const addRecentProject = useCallback(
    (path: string, name?: string) => {
      if (!userId) return; // Only track recent projects when signed in
      const projectName = name || path.split(/[/\\]/).pop() || path;
      const openedAt = Date.now();

      setRecentProjects((prev) => {
        const filtered = prev.filter((p) => p.path !== path);
        const updated = [
          { name: projectName, path, openedAt },
          ...filtered,
        ].slice(0, MAX_RECENT);
        return updated;
      });
    },
    [userId]
  );

  const removeRecentProject = useCallback((path: string) => {
    setRecentProjects((prev) => prev.filter((p) => p.path !== path));
  }, []);

  const clearRecentProjects = useCallback(() => {
    setRecentProjects([]);
  }, []);

  return (
    <RecentProjectsContext.Provider
      value={{
        recentProjects,
        addRecentProject,
        removeRecentProject,
        clearRecentProjects,
      }}
    >
      {children}
    </RecentProjectsContext.Provider>
  );
}

export function useRecentProjects() {
  const context = useContext(RecentProjectsContext);
  if (!context) {
    throw new Error("useRecentProjects must be used within RecentProjectsProvider");
  }
  return context;
}
