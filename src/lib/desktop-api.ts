// Desktop API service for interacting with Electron main process
// This provides a clean interface between React and Electron

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

class DesktopAPIService {
  private isElectron: boolean;

  constructor() {
    this.isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
  }

  get isDesktop(): boolean {
    return this.isElectron;
  }

  // Project Management
  async openProjectDialog(): Promise<string | null> {
    if (!this.isElectron || !window.electronAPI) return null;
    return window.electronAPI.openProjectDialog();
  }

  async openProjectByPath(filePath: string): Promise<void> {
    if (!this.isElectron || !window.electronAPI) return;
    return window.electronAPI.openProjectByPath(filePath);
  }

  async getCurrentProject(): Promise<ProjectInfo | null> {
    if (!this.isElectron || !window.electronAPI) return null;
    return window.electronAPI.getCurrentProject();
  }

  async closeProject(): Promise<void> {
    if (!this.isElectron || !window.electronAPI) return;
    return window.electronAPI.closeProject();
  }

  /**
   * Returns the realpath-resolved IFC sidecar path for the currently open project,
   * or null if the project isn't .rvt or no valid .ifc was found in its directory.
   */
  async getIfcSidecarPath(): Promise<string | null> {
    if (!this.isElectron || !window.electronAPI) return null;
    return (window.electronAPI as { getIfcSidecarPath: () => Promise<string | null> }).getIfcSidecarPath();
  }

  /**
   * Re-run IFC sidecar detection. Use after a user exports a fresh .ifc from Revit
   * and wants the next commit to pick it up without reopening the project.
   */
  async redetectIfcSidecar(): Promise<string | null> {
    if (!this.isElectron || !window.electronAPI) return null;
    return (window.electronAPI as { redetectIfcSidecar: () => Promise<string | null> }).redetectIfcSidecar();
  }

  // File Watching
  async startFileWatching(): Promise<void> {
    if (!this.isElectron || !window.electronAPI) return;
    return window.electronAPI.startFileWatching();
  }

  async stopFileWatching(): Promise<void> {
    if (!this.isElectron || !window.electronAPI) return;
    return window.electronAPI.stopFileWatching();
  }

  async setCurrentFile(filePath: string): Promise<void> {
    if (!this.isElectron || !window.electronAPI) return;
    return window.electronAPI.setCurrentFile(filePath);
  }

  async readFileBuffer(filePath: string): Promise<ArrayBuffer | null> {
    if (!this.isElectron || !window.electronAPI) return null;
    return window.electronAPI.readFileBuffer(filePath);
  }

  async writeFileBuffer(filePath: string, buffer: ArrayBuffer): Promise<void> {
    if (!this.isElectron || !window.electronAPI) return;
    return (window.electronAPI as any).writeFileBuffer(filePath, buffer);
  }

  // File storage (0studio commit storage)
  async saveCommitFile(filePath: string, commitId: string, buffer: ArrayBuffer, originalFormat?: string): Promise<void> {
    if (!this.isElectron || !window.electronAPI) return;
    return (window.electronAPI as any).saveCommitFile(filePath, commitId, buffer, originalFormat);
  }

  async readCommitFile(filePath: string, commitId: string, originalFormat?: string): Promise<ArrayBuffer | null> {
    if (!this.isElectron || !window.electronAPI) return null;
    return (window.electronAPI as any).readCommitFile(filePath, commitId, originalFormat);
  }

  async listCommitFiles(filePath: string): Promise<string[]> {
    if (!this.isElectron || !window.electronAPI) return [];
    return (window.electronAPI as any).listCommitFiles(filePath);
  }

  async commitFileExists(filePath: string, commitId: string): Promise<boolean> {
    if (!this.isElectron || !window.electronAPI) return false;
    return (window.electronAPI as any).commitFileExists(filePath, commitId);
  }

  // Tree file operations
  async saveTreeFile(filePath: string, treeData: any): Promise<void> {
    if (!this.isElectron || !window.electronAPI) return;
    return (window.electronAPI as any).saveTreeFile(filePath, treeData);
  }

  async loadTreeFile(filePath: string): Promise<any> {
    if (!this.isElectron || !window.electronAPI) return null;
    return (window.electronAPI as any).loadTreeFile(filePath);
  }

  async validateCommitFiles(filePath: string, commitIds: string[]): Promise<string[]> {
    if (!this.isElectron || !window.electronAPI) return [];
    return (window.electronAPI as any).validateCommitFiles(filePath, commitIds);
  }

  // Delta compression
  async computeDelta(baseBuffer: ArrayBuffer, targetBuffer: ArrayBuffer): Promise<any> {
    if (!this.isElectron || !window.electronAPI) return null;
    return (window.electronAPI as any).computeDelta(baseBuffer, targetBuffer);
  }

  async applyDelta(baseBuffer: ArrayBuffer, deltaBuffer: ArrayBuffer, expectedHash: string): Promise<ArrayBuffer | null> {
    if (!this.isElectron || !window.electronAPI) return null;
    return (window.electronAPI as any).applyDelta(baseBuffer, deltaBuffer, expectedHash);
  }

  async reconstructCommit(filePath: string, commitId: string, treeData: object): Promise<ArrayBuffer | null> {
    if (!this.isElectron || !window.electronAPI) return null;
    return (window.electronAPI as any).reconstructCommit(filePath, commitId, treeData);
  }

  async saveDeltaFile(filePath: string, commitId: string, deltaBuffer: ArrayBuffer): Promise<void> {
    if (!this.isElectron || !window.electronAPI) return;
    return (window.electronAPI as any).saveDeltaFile(filePath, commitId, deltaBuffer);
  }

  async readDeltaFile(filePath: string, commitId: string): Promise<ArrayBuffer | null> {
    if (!this.isElectron || !window.electronAPI) return null;
    return (window.electronAPI as any).readDeltaFile(filePath, commitId);
  }

  // Dual-artifact derivative (glTF binary) storage
  async saveDerivativeFile(filePath: string, commitId: string, derivativeBuffer: ArrayBuffer): Promise<void> {
    if (!this.isElectron || !window.electronAPI) return;
    return (window.electronAPI as any).saveDerivativeFile(filePath, commitId, derivativeBuffer);
  }

  async readDerivativeFile(filePath: string, commitId: string): Promise<ArrayBuffer | null> {
    if (!this.isElectron || !window.electronAPI) return null;
    return (window.electronAPI as any).readDerivativeFile(filePath, commitId);
  }

  async derivativeFileExists(filePath: string, commitId: string): Promise<boolean> {
    if (!this.isElectron || !window.electronAPI) return false;
    return (window.electronAPI as any).derivativeFileExists(filePath, commitId);
  }

  async derivativeFileSize(filePath: string, commitId: string): Promise<number | null> {
    if (!this.isElectron || !window.electronAPI) return null;
    return (window.electronAPI as any).derivativeFileSize(filePath, commitId);
  }

  // Clipboard
  async writeImageToClipboard(dataUrl: string): Promise<void> {
    if (!this.isElectron || !window.electronAPI) return;
    return (window.electronAPI as any).writeImageToClipboard(dataUrl);
  }

  // Save file dialog
  async showSaveDialog(options?: { defaultPath?: string, filters?: { name: string, extensions: string[] }[] }): Promise<string | null> {
    if (!this.isElectron || !window.electronAPI) return null;
    return window.electronAPI.showSaveDialog(options || {});
  }

  // Diagnostics
  async getDiagnosticReport(): Promise<DiagnosticReport | null> {
    if (!this.isElectron || !window.electronAPI) return null;
    return window.electronAPI.getDiagnosticReport();
  }

  // OAuth — loopback PKCE in main. Returns GoogleSignInResult so callers can
  // discriminate between success (tokens to setSession) and a structured error
  // (e.g. OAUTH_TIMEOUT, OAUTH_CANCELLED) without parsing exception messages.
  async startGoogleSignIn(supabaseUrl: string, anonKey: string): Promise<GoogleSignInResult | null> {
    if (!this.isElectron || !window.electronAPI) return null;
    return window.electronAPI.startGoogleSignIn(supabaseUrl, anonKey);
  }

  async cancelGoogleSignIn(): Promise<void> {
    if (!this.isElectron || !window.electronAPI) return;
    return window.electronAPI.cancelGoogleSignIn();
  }

  // Event Listeners
  onProjectOpened(callback: (project: ProjectInfo) => void): (() => void) | undefined {
    if (!this.isElectron || !window.electronAPI) return undefined;
    return window.electronAPI.onProjectOpened(callback);
  }

  onProjectClosed(callback: () => void): (() => void) | undefined {
    if (!this.isElectron || !window.electronAPI) return undefined;
    return window.electronAPI.onProjectClosed(callback);
  }

  onFileChanged(callback: (event: FileChangeEvent) => void): (() => void) | undefined {
    if (!this.isElectron || !window.electronAPI) return undefined;
    return window.electronAPI.onFileChanged(callback);
  }

  onShowCommitDialog(callback: () => void): (() => void) | undefined {
    if (!this.isElectron || !window.electronAPI) return undefined;
    return window.electronAPI.onShowCommitDialog(callback);
  }

  onGitOperationComplete(callback: (operation: string) => void): (() => void) | undefined {
    if (!this.isElectron || !window.electronAPI) return undefined;
    return window.electronAPI.onGitOperationComplete(callback);
  }

  onShowDiagnostics(callback: () => void): (() => void) | undefined {
    if (!this.isElectron || !window.electronAPI) return undefined;
    return window.electronAPI.onShowDiagnostics(callback);
  }
}

// Create singleton instance
export const desktopAPI = new DesktopAPIService();

// Hook for React components
export const useDesktopAPI = () => {
  return desktopAPI;
};