import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = '0studio_version_history_view';
const SYNC_EVENT = 'viewmode-changed';

export type ViewMode = 'list' | 'graph';

export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setModeState] = useState<ViewMode>(
    () => (localStorage.getItem(STORAGE_KEY) as ViewMode) || 'list'
  );

  const setMode = useCallback((newMode: ViewMode) => {
    setModeState(newMode);
    localStorage.setItem(STORAGE_KEY, newMode);
    window.dispatchEvent(new Event(SYNC_EVENT));
  }, []);

  // Sync when another component in the same window changes the mode
  useEffect(() => {
    const handleSync = () => {
      const stored = (localStorage.getItem(STORAGE_KEY) as ViewMode) || 'list';
      setModeState(stored);
    };
    window.addEventListener(SYNC_EVENT, handleSync);
    return () => window.removeEventListener(SYNC_EVENT, handleSync);
  }, []);

  return [mode, setMode];
}
