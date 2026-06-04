/// <reference types="vite/client" />

export interface ProjectInfo {
  filePath: string;
  projectDir: string;
  fileName: string;
}

export interface FileChangeEvent {
  eventType: string;
  filename: string;
  filePath: string;
}

declare global {
  interface Window {
    electronAPI?: {
      openProjectDialog: () => Promise<string | null>;
      openProjectByPath: (filePath: string) => Promise<void>;
      getCurrentProject: () => Promise<ProjectInfo | null>;
      closeProject: () => Promise<void>;

      startFileWatching: () => Promise<void>;
      stopFileWatching: () => Promise<void>;
      setCurrentFile: (filePath: string) => Promise<void>;
      readFileBuffer: (filePath: string) => Promise<ArrayBuffer>;
      writeFileBuffer: (filePath: string, buffer: ArrayBuffer) => Promise<void>;
      
      // File storage (0studio commit storage)
      saveCommitFile: (filePath: string, commitId: string, buffer: ArrayBuffer) => Promise<void>;
      readCommitFile: (filePath: string, commitId: string) => Promise<ArrayBuffer | null>;
      listCommitFiles: (filePath: string) => Promise<string[]>;
      commitFileExists: (filePath: string, commitId: string) => Promise<boolean>;
      saveTreeFile: (filePath: string, treeData: any) => Promise<void>;
      loadTreeFile: (filePath: string) => Promise<any>;
      validateCommitFiles: (filePath: string, commitIds: string[]) => Promise<string[]>;
      
      onProjectOpened: (callback: (project: ProjectInfo) => void) => () => void;
      onProjectClosed: (callback: () => void) => () => void;
      onFileChanged: (callback: (event: FileChangeEvent) => void) => () => void;
      onShowCommitDialog: (callback: () => void) => () => void;
      onGitOperationComplete: (callback: (operation: string) => void) => () => void;
    };
  }
}