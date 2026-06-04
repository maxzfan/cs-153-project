import { contextBridge, ipcRenderer } from 'electron';

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

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Project management
  openProjectDialog: () => ipcRenderer.invoke('open-project-dialog'),
  openProjectByPath: (filePath: string) => ipcRenderer.invoke('open-project-by-path', filePath),
  getCurrentProject: () => ipcRenderer.invoke('get-current-project'),
  closeProject: () => ipcRenderer.invoke('close-project'),
  getIfcSidecarPath: () => ipcRenderer.invoke('get-ifc-sidecar-path'),
  redetectIfcSidecar: () => ipcRenderer.invoke('redetect-ifc-sidecar'),

  // File watching
  startFileWatching: () => ipcRenderer.invoke('start-file-watching'),
  stopFileWatching: () => ipcRenderer.invoke('stop-file-watching'),
      setCurrentFile: (filePath: string) => ipcRenderer.invoke('set-current-file', filePath),
      readFileBuffer: (filePath: string) => ipcRenderer.invoke('read-file-buffer', filePath),
      writeFileBuffer: (filePath: string, buffer: ArrayBuffer) => ipcRenderer.invoke('write-file-buffer', filePath, buffer),

      // File storage (0studio commit storage)
      saveCommitFile: (filePath: string, commitId: string, buffer: ArrayBuffer, originalFormat?: string) =>
        ipcRenderer.invoke('save-commit-file', filePath, commitId, buffer, originalFormat),
      readCommitFile: (filePath: string, commitId: string, originalFormat?: string) =>
        ipcRenderer.invoke('read-commit-file', filePath, commitId, originalFormat),
      listCommitFiles: (filePath: string) => 
        ipcRenderer.invoke('list-commit-files', filePath),
      commitFileExists: (filePath: string, commitId: string) => 
        ipcRenderer.invoke('commit-file-exists', filePath, commitId),
      saveTreeFile: (filePath: string, treeData: any) => 
        ipcRenderer.invoke('save-tree-file', filePath, treeData),
      loadTreeFile: (filePath: string) => 
        ipcRenderer.invoke('load-tree-file', filePath),
      validateCommitFiles: (filePath: string, commitIds: string[]) => 
        ipcRenderer.invoke('validate-commit-files', filePath, commitIds),

      // Delta compression
      computeDelta: (baseBuffer: ArrayBuffer, targetBuffer: ArrayBuffer) =>
        ipcRenderer.invoke('compute-delta', baseBuffer, targetBuffer),
      applyDelta: (baseBuffer: ArrayBuffer, deltaBuffer: ArrayBuffer, expectedHash: string) =>
        ipcRenderer.invoke('apply-delta', baseBuffer, deltaBuffer, expectedHash),
      reconstructCommit: (filePath: string, commitId: string, treeData: object) =>
        ipcRenderer.invoke('reconstruct-commit', filePath, commitId, treeData),
      saveDeltaFile: (filePath: string, commitId: string, deltaBuffer: ArrayBuffer) =>
        ipcRenderer.invoke('save-delta-file', filePath, commitId, deltaBuffer),
      readDeltaFile: (filePath: string, commitId: string) =>
        ipcRenderer.invoke('read-delta-file', filePath, commitId),

      // Dual-artifact derivative (glTF binary) storage
      saveDerivativeFile: (filePath: string, commitId: string, derivativeBuffer: ArrayBuffer) =>
        ipcRenderer.invoke('save-derivative-file', filePath, commitId, derivativeBuffer),
      readDerivativeFile: (filePath: string, commitId: string) =>
        ipcRenderer.invoke('read-derivative-file', filePath, commitId),
      derivativeFileExists: (filePath: string, commitId: string) =>
        ipcRenderer.invoke('derivative-file-exists', filePath, commitId),
      derivativeFileSize: (filePath: string, commitId: string) =>
        ipcRenderer.invoke('derivative-file-size', filePath, commitId),

      // Clipboard
      writeImageToClipboard: (dataUrl: string) => ipcRenderer.invoke('write-image-to-clipboard', dataUrl),

      // Save dialog
      showSaveDialog: (options: { defaultPath?: string, filters?: { name: string, extensions: string[] }[] }) =>
        ipcRenderer.invoke('show-save-dialog', options),

      // Diagnostics
      getDiagnosticReport: () => ipcRenderer.invoke('get-diagnostic-report'),

      // OAuth (loopback PKCE flow lives in main)
      startGoogleSignIn: (supabaseUrl: string, anonKey: string) =>
        ipcRenderer.invoke('start-google-sign-in', supabaseUrl, anonKey),
      cancelGoogleSignIn: () => ipcRenderer.invoke('cancel-google-sign-in'),

      // Event listeners
  onProjectOpened: (callback: (project: ProjectInfo) => void) => {
    const handler = (_: any, project: ProjectInfo) => callback(project);
    ipcRenderer.on('project-opened', handler);
    return () => ipcRenderer.removeListener('project-opened', handler);
  },

  onProjectClosed: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('project-closed', handler);
    return () => ipcRenderer.removeListener('project-closed', handler);
  },

  onFileChanged: (callback: (event: FileChangeEvent) => void) => {
    const handler = (_: any, event: FileChangeEvent) => callback(event);
    ipcRenderer.on('file-changed', handler);
    return () => ipcRenderer.removeListener('file-changed', handler);
  },

  onShowCommitDialog: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('show-commit-dialog', handler);
    return () => ipcRenderer.removeListener('show-commit-dialog', handler);
  },

  onGitOperationComplete: (callback: (operation: string) => void) => {
    const handler = (_: any, operation: string) => callback(operation);
    ipcRenderer.on('git-operation-complete', handler);
    return () => ipcRenderer.removeListener('git-operation-complete', handler);
  },

  onShowDiagnostics: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('show-diagnostics', handler);
    return () => ipcRenderer.removeListener('show-diagnostics', handler);
  },
});

// Type definitions for TypeScript
declare global {
  interface Window {
    electronAPI: {
      openProjectDialog: () => Promise<string | null>;
      openProjectByPath: (filePath: string) => Promise<void>;
      getCurrentProject: () => Promise<ProjectInfo | null>;
      closeProject: () => Promise<void>;
      getIfcSidecarPath: () => Promise<string | null>;
      redetectIfcSidecar: () => Promise<string | null>;

      startFileWatching: () => Promise<void>;
      stopFileWatching: () => Promise<void>;
      setCurrentFile: (filePath: string) => Promise<void>;
      readFileBuffer: (filePath: string) => Promise<ArrayBuffer>;
      writeFileBuffer: (filePath: string, buffer: ArrayBuffer) => Promise<void>;
      
      // File storage (0studio commit storage)
      saveCommitFile: (filePath: string, commitId: string, buffer: ArrayBuffer, originalFormat?: string) => Promise<void>;
      readCommitFile: (filePath: string, commitId: string, originalFormat?: string) => Promise<ArrayBuffer | null>;
      listCommitFiles: (filePath: string) => Promise<string[]>;
      commitFileExists: (filePath: string, commitId: string) => Promise<boolean>;
      saveTreeFile: (filePath: string, treeData: any) => Promise<void>;
      loadTreeFile: (filePath: string) => Promise<any>;
      validateCommitFiles: (filePath: string, commitIds: string[]) => Promise<string[]>;
      showSaveDialog: (options: { defaultPath?: string, filters?: { name: string, extensions: string[] }[] }) => Promise<string | null>;
      writeImageToClipboard: (dataUrl: string) => Promise<void>;

      // Delta compression
      computeDelta: (baseBuffer: ArrayBuffer, targetBuffer: ArrayBuffer) => Promise<any>;
      applyDelta: (baseBuffer: ArrayBuffer, deltaBuffer: ArrayBuffer, expectedHash: string) => Promise<ArrayBuffer>;
      reconstructCommit: (filePath: string, commitId: string, treeData: object) => Promise<ArrayBuffer | null>;
      saveDeltaFile: (filePath: string, commitId: string, deltaBuffer: ArrayBuffer) => Promise<void>;
      readDeltaFile: (filePath: string, commitId: string) => Promise<ArrayBuffer | null>;

      // Dual-artifact derivatives
      saveDerivativeFile: (filePath: string, commitId: string, derivativeBuffer: ArrayBuffer) => Promise<void>;
      readDerivativeFile: (filePath: string, commitId: string) => Promise<ArrayBuffer | null>;
      derivativeFileExists: (filePath: string, commitId: string) => Promise<boolean>;
      derivativeFileSize: (filePath: string, commitId: string) => Promise<number | null>;

      getDiagnosticReport: () => Promise<DiagnosticReport>;

      startGoogleSignIn: (supabaseUrl: string, anonKey: string) => Promise<GoogleSignInResult>;
      cancelGoogleSignIn: () => Promise<void>;

      onProjectOpened: (callback: (project: ProjectInfo) => void) => () => void;
      onProjectClosed: (callback: () => void) => () => void;
      onFileChanged: (callback: (event: FileChangeEvent) => void) => () => void;
      onShowCommitDialog: (callback: () => void) => () => void;
      onGitOperationComplete: (callback: (operation: string) => void) => () => void;
      onShowDiagnostics: (callback: () => void) => () => void;
    };
  }
}

export interface DiagnosticReport {
  appVersion: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  locale: string;
  timestamp: string;
  logFilePath: string;
  gpu: unknown;
  logTail?: string;
}

export type GoogleSignInResult =
  | { ok: true; tokens: { access_token: string; refresh_token: string; user: unknown } }
  | { ok: false; error: { code: string; message: string } };