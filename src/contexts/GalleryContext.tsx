import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface GalleryContextType {
  isGalleryMode: boolean;
  selectedCommitIds: Set<string>;
  toggleGalleryMode: () => void;
  toggleCommitSelection: (commitId: string) => void;
  clearSelectedCommits: () => void;
  resetGallery: () => void;
}

const GalleryContext = createContext<GalleryContextType | null>(null);

export const useGallery = (): GalleryContextType => {
  const context = useContext(GalleryContext);
  if (!context) {
    throw new Error("useGallery must be used within a GalleryProvider");
  }
  return context;
};

interface GalleryProviderProps {
  children: ReactNode;
}

export const GalleryProvider: React.FC<GalleryProviderProps> = ({ children }) => {
  const [isGalleryMode, setIsGalleryMode] = useState(false);
  const [selectedCommitIds, setSelectedCommitIds] = useState<Set<string>>(new Set());

  const toggleGalleryMode = useCallback(() => {
    setIsGalleryMode(prev => {
      const newValue = !prev;
      if (!newValue) {
        // Clear selections when exiting gallery mode
        setSelectedCommitIds(new Set());
      }
      return newValue;
    });
  }, []);

  const toggleCommitSelection = useCallback((commitId: string) => {
    setSelectedCommitIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(commitId)) {
        newSet.delete(commitId);
      } else {
        // Only allow adding if under the limit of 4
        if (newSet.size < 4) {
          newSet.add(commitId);
        }
      }
      return newSet;
    });
  }, []);

  const clearSelectedCommits = useCallback(() => {
    setSelectedCommitIds(new Set());
  }, []);

  const resetGallery = useCallback(() => {
    setIsGalleryMode(false);
    setSelectedCommitIds(new Set());
  }, []);

  const value: GalleryContextType = {
    isGalleryMode,
    selectedCommitIds,
    toggleGalleryMode,
    toggleCommitSelection,
    clearSelectedCommits,
    resetGallery,
  };

  return (
    <GalleryContext.Provider value={value}>
      {children}
    </GalleryContext.Provider>
  );
};
