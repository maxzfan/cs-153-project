import { app, BrowserWindow, ipcMain, dialog, Menu, shell, clipboard, nativeImage, session, globalShortcut } from 'electron';
import { join, dirname, basename, resolve, relative, isAbsolute } from 'path';
import { existsSync, mkdirSync, statSync } from 'fs';
import { writeFile, open as fsOpen } from 'fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'url';
import log from 'electron-log/main.js';
import { FileWatcherService } from './services/file-watcher.js';
import { FileStorageService } from './services/file-storage-service.js';
import { DeltaWorkerPool } from './workers/delta-worker-pool.js';
import { CommitReconstructionService } from './services/commit-reconstruction-service.js';
import { detectIfcSidecar } from './services/ifc-sidecar-service.js';
import {
  startGoogleSignIn,
  cancelGoogleSignIn,
  shutdownAllOAuthServers,
} from './services/oauth-service.js';
import { isSupportedProjectFile } from './lib/project-file.js';
import { extractProjectPath } from './lib/argv-util.js';
import { applyRedactions, installRedactionHook } from './lib/log-redact.js';
// Note: GitService removed - uses simple-git which requires bundling node_modules

// R5: Safe GPU flags — must be set before app.ready() fires.
// ignore-gpu-blocklist: enables hardware WebGL even when Chromium's GPU blocklist would
//   force SwiftShader (software renderer) in the packaged build.
// disable-software-rasterizer: prevents silent fallback to CPU-rendered WebGL if the
//   GPU is on the blocklist.
// NOTE: do NOT add enable-zero-copy — it caused a 15s startup hang on Apple Silicon.
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-software-rasterizer');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class RhinoStudio {
  private mainWindow: BrowserWindow | null = null;
  private currentProjectFile: string | null = null;
  private currentIfcSidecar: string | null = null;
  private fileWatcher: FileWatcherService | null = null;
  private fileStorage: FileStorageService = new FileStorageService();
  private workerPool: DeltaWorkerPool = new DeltaWorkerPool();
  private reconstructionService: CommitReconstructionService = new CommitReconstructionService(this.fileStorage, this.workerPool);

  // File path captured at cold launch (process.argv) or while the window isn't
  // ready yet (second-instance fired before createWindow finished). Drained
  // exactly once when did-finish-load fires.
  private pendingFileToOpen: string | null = null;

  // Renderer-bound IPC messages buffered while the window is loading. Calling
  // webContents.send before the page is loaded silently drops the message —
  // see https://www.electronjs.org/docs/latest/api/web-contents.
  private pendingRendererMessages: Array<[string, ...unknown[]]> = [];

  constructor() {
    this.setupApp();
    this.setupIPC();
    this.createMenu();
  }

  /**
   * Send to the renderer if the window is loaded, otherwise queue. The queue
   * drains in did-finish-load order. Used in place of `mainWindow.webContents.send`
   * everywhere a message could fire before the page finishes loading (cold-launch
   * file open, second-instance file open, file-watcher events fired during reload).
   */
  private safeSend(channel: string, ...args: unknown[]): void {
    const win = this.mainWindow;
    if (!win || win.isDestroyed() || win.webContents.isLoading()) {
      this.pendingRendererMessages.push([channel, ...args]);
      return;
    }
    win.webContents.send(channel, ...args);
  }

  private setupApp() {
    // We ship NSIS, not Squirrel. NSIS handles Start Menu/desktop shortcuts and
    // file-association registration natively at install time, so the previous
    // `--squirrel-*` argv check was dead code in this build.

    // Single-instance lock. If a second copy of the app is launched (e.g. user
    // double-clicks a .3dm in Explorer while the app is already running), we want
    // the existing window to come to front and switch to the new file rather than
    // spawn a duplicate. Must run before log.initialize() so the second process
    // doesn't write to the same log file before quitting.
    const gotLock = app.requestSingleInstanceLock();
    if (!gotLock) {
      // Hand off the argv to the running instance via 'second-instance' (Electron
      // forwards it automatically) and exit. Skip the rest of setupApp entirely.
      app.quit();
      return;
    }

    // Diagnostic logging. After the single-instance lock so the runner-up never
    // touches the log file. log.initialize() injects the IPC bridge that
    // electron-log/renderer reads from, so renderer-side logging Just Works
    // without preload.ts changes.
    log.initialize();
    log.transports.file.level = 'info';
    log.transports.file.maxSize = 20 * 1024 * 1024;
    // No console transport in packaged builds — keeps secrets out of stdout
    // even though redaction would scrub them; defense in depth.
    log.transports.console.level =
      process.env.NODE_ENV === 'development' || !app.isPackaged ? 'debug' : false;
    installRedactionHook(log);
    log.errorHandler.startCatching({
      showDialog: false,
      onError: ({ error, processType }) => {
        log.error(`[uncaught:${processType}]`, error);
      },
    });

    // Headless --diag-report CLI flag. Generates a JSON report and writes to
    // stdout, no window, no project open. Lets a tester or future support agent
    // grab system info via `0studio.exe --diag-report > report.json`.
    if (process.argv.includes('--diag-report')) {
      app.whenReady().then(async () => {
        try {
          const report = await this.buildDiagnosticReport({ includeLogTail: true });
          process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        } catch (err) {
          log.error('[--diag-report] failed:', err);
          process.stderr.write(`diag-report failed: ${(err as Error).message}\n`);
        }
        app.exit(0);
      });
      return;
    }

    // Capture cold-launch argv. Drained on did-finish-load.
    this.pendingFileToOpen = extractProjectPath(process.argv);

    // Forwarded from a second 0studio.exe / 0studio launch on the same machine.
    // Bring the existing window to front and route the new file through openProject
    // (which will safeSend('project-opened', ...) — queued if the window is mid-load).
    app.on('second-instance', (_event, argv) => {
      const filePath = extractProjectPath(argv);
      if (!this.mainWindow || this.mainWindow.isDestroyed()) {
        if (filePath) this.pendingFileToOpen = filePath;
        return;
      }
      if (this.mainWindow.isMinimized()) this.mainWindow.restore();
      this.mainWindow.focus();
      if (filePath) {
        this.openProject(filePath).catch((err) => {
          log.error('[main] second-instance openProject failed:', err);
        });
      }
    });

    app.whenReady().then(() => {
      // R7: Enable V8 bytecode cache — eliminates JS re-parse cost on every launch
      session.defaultSession.setCodeCachePath(join(app.getPath('userData'), 'code-cache'));

      // R6: Hidden GPU diagnostic shortcut (Cmd+Shift+G) — opens chrome://gpu for
      // verifying hardware WebGL status in the packaged build without a dev rebuild.
      globalShortcut.register('CommandOrControl+Shift+G', () => {
        this.openGpuDiagnostics();
      });

      // Write the on-start diagnostic snapshot. Skipped if --diag-report short-
      // circuited above. Failure is non-fatal — logged and ignored so a flaky
      // disk doesn't prevent the app from starting.
      this.writeStartupDiagnosticSnapshot().catch((err) => {
        log.error('[main] startup diagnostic snapshot failed:', err);
      });

      // R9: Create window first so it's not blocked by worker thread startup
      this.createWindow();
      this.workerPool.warmUp();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          this.createWindow();
        }
      });

      // File associations. macOS uses 'open-file' (Electron docs flag this as
      // macOS-only and it's a no-op on Windows/Linux, so register unconditionally).
      // Windows file-association launches arrive via process.argv on cold start
      // and via 'second-instance' on warm start — both handled above.
      app.on('open-file', async (event, filePath) => {
        event.preventDefault();
        if (isSupportedProjectFile(filePath)) {
          await this.openProject(filePath);
        }
      });
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('before-quit', () => {
      shutdownAllOAuthServers();
    });

    app.on('will-quit', () => {
      globalShortcut.unregisterAll();
      this.workerPool.shutdown().catch(() => {});
    });
  }

  private createWindow() {
    const isMac = process.platform === 'darwin';
    this.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, 'preload.cjs'),
      },
      titleBarStyle: isMac ? 'hiddenInset' : 'default',
      ...(isMac ? { trafficLightPosition: { x: 10, y: 6 } } : {}),
      minWidth: 800,
      minHeight: 600,
      show: false,
    });

    // Load the app
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    if (isDev) {
      // In development, wait for Vite server and then load
      this.mainWindow.loadURL('http://localhost:5173');
      this.mainWindow.webContents.openDevTools();
    } else {
      this.mainWindow.loadFile(join(__dirname, '../dist/index.html'));
    }

    // R5: Show window when ready, with a 10s fallback so a GPU init hang
    // never leaves the app frozen with a black/invisible window.
    let shown = false;
    const showWindow = () => {
      if (!shown && this.mainWindow) {
        shown = true;
        this.mainWindow.show();
      }
    };
    const showTimeout = setTimeout(showWindow, 10_000);
    this.mainWindow.once('ready-to-show', () => {
      clearTimeout(showTimeout);
      showWindow();
    });

    // Once the renderer is fully loaded, drain any IPC messages buffered while
    // the page was loading (cold-launch project-opened, file-watcher events
    // fired before first paint, etc.) and open the file from process.argv if
    // one was supplied at launch.
    this.mainWindow.webContents.on('did-finish-load', () => {
      const win = this.mainWindow;
      if (!win || win.isDestroyed()) return;
      while (this.pendingRendererMessages.length > 0) {
        const next = this.pendingRendererMessages.shift();
        if (!next) break;
        const [channel, ...args] = next;
        win.webContents.send(channel, ...args);
      }
      const file = this.pendingFileToOpen;
      this.pendingFileToOpen = null;
      if (file) {
        this.openProject(file).catch((err) => {
          log.error('[main] cold-launch openProject failed:', err);
        });
      }
    });

    // Renderer health observability. OAuth loopback teardown hooks here so an
    // orphan 127.0.0.1:<port> listener can never outlive the renderer that
    // requested the sign-in flow.
    this.mainWindow.webContents.on('render-process-gone', (_event, details) => {
      log.error('[render-gone]', details);
      shutdownAllOAuthServers();
    });
    this.mainWindow.webContents.on('unresponsive', () => {
      log.warn('[render-unresponsive]');
    });
    this.mainWindow.webContents.on('responsive', () => {
      log.info('[render-responsive]');
    });
    this.mainWindow.webContents.on('destroyed', () => {
      shutdownAllOAuthServers();
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
      this.fileWatcher?.stop();
    });
  }

  private createMenu() {
    const template = [
      {
        label: app.getName(),
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideothers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: 'File',
        submenu: [
          {
            label: 'Open 3D Model...',
            accelerator: 'CmdOrCtrl+O',
            click: () => this.openProjectDialog()
          },
          {
            label: 'Close Model',
            accelerator: 'CmdOrCtrl+W',
            click: () => this.closeProject()
          },
          { type: 'separator' },
          {
            label: 'Export Model...',
            accelerator: 'CmdOrCtrl+E',
            click: () => this.exportModel()
          }
        ]
      },
      {
        label: 'Model',
        submenu: [
          {
            label: 'Save Version...',
            accelerator: 'CmdOrCtrl+Shift+S',
            click: () => this.saveModelVersion()
          },
          { type: 'separator' },
          {
            label: 'Show Version History',
            accelerator: 'CmdOrCtrl+Shift+H',
            click: () => this.showVersionHistory()
          },
          {
            label: 'Simulate Changes',
            accelerator: 'CmdOrCtrl+Shift+T',
            click: () => this.simulateChanges()
          }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'close' }
        ]
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'Copy Diagnostic Report',
            click: () => this.safeSend('show-diagnostics'),
          },
          {
            label: 'Open Logs Folder',
            click: () => {
              shell.openPath(dirname(log.transports.file.getFile().path));
            },
          },
        ],
      },
    ] as any;

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }

  // R6: Open chrome://gpu in a dedicated window for diagnosing GPU acceleration status
  private openGpuDiagnostics(): void {
    const gpuWin = new BrowserWindow({ width: 1200, height: 800, title: 'GPU Diagnostics' });
    gpuWin.loadURL('chrome://gpu');
  }

  private setupIPC() {
    // Model management
    ipcMain.handle('open-project-dialog', () => this.openProjectDialog());
    ipcMain.handle('open-project-by-path', (_, filePath: string) => this.openProject(filePath));
    ipcMain.handle('get-current-project', () => this.getCurrentProject());
    ipcMain.handle('close-project', () => this.closeProject());
    // IFC sidecar — returns the realpath-resolved path of the sidecar detected at
    // project open time, or null if the current project isn't .rvt or has no .ifc.
    ipcMain.handle('get-ifc-sidecar-path', () => this.currentIfcSidecar);
    // Re-run sidecar detection on demand (e.g. after the user exports a fresh .ifc).
    ipcMain.handle('redetect-ifc-sidecar', () => this.redetectIfcSidecar());

    // Model version control
    ipcMain.handle('save-model-version', () => this.saveModelVersion());
    ipcMain.handle('show-version-history', () => this.showVersionHistory());
    ipcMain.handle('simulate-changes', () => this.simulateChanges());
    ipcMain.handle('export-model', () => this.exportModel());

    // File watching
    ipcMain.handle('start-file-watching', () => this.startFileWatching());
    ipcMain.handle('stop-file-watching', () => this.stopFileWatching());
    ipcMain.handle('set-current-file', (_, filePath: string) => this.setCurrentFile(filePath));
    ipcMain.handle('read-file-buffer', (_, filePath: string) => this.readFileBuffer(filePath));
    ipcMain.handle('write-file-buffer', (_, filePath: string, buffer: ArrayBuffer) => this.writeFileBuffer(filePath, buffer));

    // File storage (0studio commit storage)
    ipcMain.handle('save-commit-file', (_, filePath: string, commitId: string, buffer: ArrayBuffer, originalFormat?: string) =>
      this.saveCommitFile(filePath, commitId, buffer, originalFormat));
    ipcMain.handle('read-commit-file', (_, filePath: string, commitId: string, originalFormat?: string) =>
      this.readCommitFile(filePath, commitId, originalFormat));
    ipcMain.handle('list-commit-files', (_, filePath: string) =>
      this.listCommitFiles(filePath));
    ipcMain.handle('commit-file-exists', (_, filePath: string, commitId: string) =>
      this.commitFileExists(filePath, commitId));
    ipcMain.handle('save-tree-file', (_, filePath: string, treeData: any) => 
      this.saveTreeFile(filePath, treeData));
    ipcMain.handle('load-tree-file', (_, filePath: string) => 
      this.loadTreeFile(filePath));
    ipcMain.handle('validate-commit-files', (_, filePath: string, commitIds: string[]) => 
      this.validateCommitFiles(filePath, commitIds));

    // Delta compression
    ipcMain.handle('compute-delta', async (_, baseBuffer: ArrayBuffer, targetBuffer: ArrayBuffer) => {
      return this.workerPool.computeDelta(baseBuffer, targetBuffer);
    });
    ipcMain.handle('apply-delta', async (_, baseBuffer: ArrayBuffer, deltaBuffer: ArrayBuffer, expectedHash: string) => {
      return this.workerPool.applyDelta(baseBuffer, deltaBuffer, expectedHash);
    });
    ipcMain.handle('reconstruct-commit', async (_, filePath: string, commitId: string, treeData: any) => {
      this.validateProjectPath(filePath);
      return this.reconstructionService.readCommitFile(filePath, commitId, treeData);
    });
    ipcMain.handle('save-delta-file', async (_, filePath: string, commitId: string, deltaBuffer: ArrayBuffer) => {
      this.validateProjectPath(filePath);
      await this.fileStorage.saveDeltaFile(filePath, commitId, deltaBuffer);
    });
    ipcMain.handle('read-delta-file', async (_, filePath: string, commitId: string) => {
      this.validateProjectPath(filePath);
      return this.fileStorage.readDeltaFile(filePath, commitId);
    });

    // Dual-artifact derivative (glTF binary) storage
    ipcMain.handle('save-derivative-file', async (_, filePath: string, commitId: string, derivativeBuffer: ArrayBuffer) => {
      this.validateProjectPath(filePath);
      await this.fileStorage.saveDerivativeFile(filePath, commitId, derivativeBuffer);
    });
    ipcMain.handle('read-derivative-file', async (_, filePath: string, commitId: string) => {
      this.validateProjectPath(filePath);
      return this.fileStorage.readDerivativeFile(filePath, commitId);
    });
    ipcMain.handle('derivative-file-exists', (_, filePath: string, commitId: string) => {
      this.validateProjectPath(filePath);
      return this.fileStorage.derivativeFileExists(filePath, commitId);
    });
    ipcMain.handle('derivative-file-size', (_, filePath: string, commitId: string) => {
      this.validateProjectPath(filePath);
      return this.fileStorage.derivativeFileSize(filePath, commitId);
    });

    // Clipboard
    ipcMain.handle('write-image-to-clipboard', (_, dataUrl: string) => {
      const image = nativeImage.createFromDataURL(dataUrl);
      clipboard.writeImage(image);
    });

    // Save file dialog (for choosing where to save downloaded files)
    ipcMain.handle('show-save-dialog', (_, options: { defaultPath?: string, filters?: { name: string, extensions: string[] }[] }) =>
      this.showSaveDialog(options));

    // Diagnostic report — bundles app/runtime versions, platform, GPU info, and
    // a redacted tail of the main log so a tester can paste a single block of
    // text or JSON into a bug report without hunting for the log file.
    ipcMain.handle('get-diagnostic-report', () =>
      this.buildDiagnosticReport({ includeLogTail: true }));

    // OAuth — loopback PKCE flow lives in main so the verifier never crosses
    // the IPC bridge and shell.openExternal stays out of renderer reach.
    // Renderer passes its own VITE_SUPABASE_URL/ANON_KEY because main has no
    // independent access to import.meta.env vars.
    ipcMain.handle('start-google-sign-in', async (_, supabaseUrl: string, anonKey: string) => {
      try {
        const tokens = await startGoogleSignIn(supabaseUrl, anonKey);
        return { ok: true as const, tokens };
      } catch (err) {
        const e = err as Error & { code?: string };
        log.error('[start-google-sign-in] failed:', e);
        return {
          ok: false as const,
          error: { code: e.code ?? 'OAUTH_EXCHANGE_FAILED', message: e.message },
        };
      }
    });
    ipcMain.handle('cancel-google-sign-in', () => {
      cancelGoogleSignIn();
    });
  }

  private async openProjectDialog(): Promise<string | null> {
    const result = await dialog.showOpenDialog(this.mainWindow!, {
      title: 'Open 3D Model',
      filters: [
        { name: '3D Models (.3dm, .rvt, .ifc)', extensions: ['3dm', 'rvt', 'ifc'] },
        { name: 'Rhino 3D Models', extensions: ['3dm'] },
        { name: 'Revit Projects', extensions: ['rvt'] },
        { name: 'IFC Models', extensions: ['ifc'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      await this.openProject(filePath);
      return filePath;
    }

    return null;
  }

  private async showSaveDialog(options: { defaultPath?: string, filters?: { name: string, extensions: string[] }[] }): Promise<string | null> {
    const result = await dialog.showSaveDialog(this.mainWindow!, {
      title: 'Choose where to save the file',
      defaultPath: options.defaultPath,
      filters: options.filters || [
        { name: 'Rhino 3D Models', extensions: ['3dm'] },
        { name: 'All Files', extensions: ['*'] }
      ],
    });

    if (!result.canceled && result.filePath) {
      return result.filePath;
    }

    return null;
  }

  private async openProject(filePath: string): Promise<boolean> {
    if (!existsSync(filePath)) {
      dialog.showErrorBox('Error', 'File not found: ' + filePath);
      return false;
    }

    this.currentProjectFile = filePath;

    // Rename pre-Phase-3 `0studio_{name}` folders to the new `0studio_{name}_{ext}`
    // layout so multi-format projects sharing a basename don't collide. Idempotent and
    // silent — a failure here is logged but does not block opening, since the renderer
    // will create a fresh folder under the new name if migration can't happen.
    try {
      await this.fileStorage.migrateLegacyStorageFolder(filePath);
    } catch (err) {
      log.error('[main] storage folder migration failed:', err);
    }

    // Start file watching
    await this.startFileWatching();
    
    // Update window title
    if (this.mainWindow) {
      this.mainWindow.setTitle(`0studio - ${basename(filePath)}`);
    }

    // Notify renderer process. Routed through safeSend so a cold-launch open
    // that runs before did-finish-load gets queued and replayed once the page
    // is ready, instead of being silently dropped.
    this.safeSend('project-opened', {
      filePath,
      fileName: basename(filePath)
    });
    return true;
  }

  private async closeProject(): Promise<void> {
    this.currentProjectFile = null;
    await this.stopFileWatching();
    
    if (this.mainWindow) {
      this.mainWindow.setTitle('0studio');
    }

    this.safeSend('project-closed');
  }

  private getCurrentProject() {
    return this.currentProjectFile ? {
      filePath: this.currentProjectFile,
      fileName: basename(this.currentProjectFile)
    } : null;
  }

  private async startFileWatching(): Promise<void> {
    if (this.currentProjectFile && !this.fileWatcher) {
      // For .rvt projects, also locate and watch the IFC sidecar. Detection runs every
      // time a project opens rather than being cached, so replacing/re-exporting the
      // .ifc and reopening the project picks up the new geometry.
      this.currentIfcSidecar = null;
      try {
        const sidecar = await detectIfcSidecar(this.currentProjectFile);
        this.currentIfcSidecar = sidecar?.path ?? null;
      } catch (err) {
        log.error('[main] IFC sidecar detection failed:', err);
      }

      this.fileWatcher = new FileWatcherService();
      this.fileWatcher.watch(
        { primary: this.currentProjectFile, sidecar: this.currentIfcSidecar },
        (eventType, filename) => {
          // Chokidar hands us the exact path that changed — forward it so the renderer can
          // decide whether the event came from the primary file (reload model) or the
          // sidecar (mark unsaved changes so the next commit regenerates the derivative).
          this.safeSend('file-changed', {
            eventType,
            filename,
            filePath: this.currentProjectFile,
            isSidecar: !!filename && !!this.currentIfcSidecar && filename === this.currentIfcSidecar,
          });
        }
      );
    }
  }

  private async stopFileWatching(): Promise<void> {
    if (this.fileWatcher) {
      this.fileWatcher.stop();
      this.fileWatcher = null;
    }
    this.currentIfcSidecar = null;
  }

  /**
   * Re-run IFC sidecar detection for the currently open project and restart the watcher
   * if the sidecar path changed. Called when the user re-exports a .ifc mid-session and
   * wants the next commit to pick up the new geometry.
   */
  private async redetectIfcSidecar(): Promise<string | null> {
    if (!this.currentProjectFile) return null;
    try {
      const sidecar = await detectIfcSidecar(this.currentProjectFile);
      const newPath = sidecar?.path ?? null;
      if (newPath !== this.currentIfcSidecar) {
        this.currentIfcSidecar = newPath;
        // Restart watcher so the new sidecar is observed for subsequent edits.
        if (this.fileWatcher) {
          await this.stopFileWatching();
          await this.startFileWatching();
        }
      }
      return this.currentIfcSidecar;
    } catch (err) {
      log.error('[main] redetectIfcSidecar failed:', err);
      return this.currentIfcSidecar;
    }
  }

  private setCurrentFile(filePath: string): void {
    this.currentProjectFile = filePath;
  }

  private validateProjectPath(filePath: string): void {
    if (!this.currentProjectFile) {
      throw new Error('No project is currently open');
    }
    const resolvedProjectFile = resolve(this.currentProjectFile);
    const resolvedProjectDir = resolve(dirname(this.currentProjectFile));
    const resolvedPath = resolve(filePath);

    // Allow the project file itself
    if (resolvedPath === resolvedProjectFile) return;

    // Otherwise require the path to be strictly inside the project directory.
    // Using path.relative + isAbsolute + '..' guard is cross-platform (Windows uses '\').
    const rel = relative(resolvedProjectDir, resolvedPath);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Path "${filePath}" is outside the project directory`);
    }
  }

  // EBUSY retry-with-backoff for Windows atomic-rename saves. Even after
  // chokidar's awaitWriteFinish settles (1500 ms in file-watcher.ts), Rhino
  // can briefly hold a shared-deny-write handle on the .3dm. Schedule:
  //   25 → 75 → 200 → 500 → 1500 ms (5 attempts, ~2.3 s composed worst case).
  // Most EBUSY clears in <100 ms so the early retries cover the common case
  // without piling on latency.
  private static readonly READ_RETRY_DELAYS_MS = [25, 75, 200, 500, 1500] as const;

  // Concurrent-read coalescing. If two chokidar 'change' events fire for the
  // same path while a previous read is still in flight, return the in-flight
  // promise instead of starting another fs.readFile. Prevents the older read
  // from "winning" the race and flashing stale bytes into the renderer.
  private inFlightReads: Map<string, Promise<ArrayBuffer>> = new Map();

  private async readFileBuffer(filePath: string): Promise<ArrayBuffer> {
    this.validateProjectPath(filePath);
    const existing = this.inFlightReads.get(filePath);
    if (existing) return existing;

    const promise = this.doReadFileWithRetry(filePath);
    this.inFlightReads.set(filePath, promise);
    try {
      return await promise;
    } finally {
      this.inFlightReads.delete(filePath);
    }
  }

  private async doReadFileWithRetry(filePath: string): Promise<ArrayBuffer> {
    const fs = await import('fs/promises');
    const delays = RhinoStudio.READ_RETRY_DELAYS_MS;
    for (let i = 0; i < delays.length; i++) {
      try {
        const buffer = await fs.readFile(filePath);
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        const isLast = i === delays.length - 1;
        if (isLast || (code !== 'EBUSY' && code !== 'EPERM')) throw err;
        await new Promise((resolve) => setTimeout(resolve, delays[i]));
      }
    }
    // Unreachable — loop either returns or throws.
    throw new Error('readFileBuffer: exhausted retries');
  }

  private async writeFileBuffer(filePath: string, buffer: ArrayBuffer): Promise<void> {
    if (this.currentProjectFile) {
      this.validateProjectPath(filePath);
    }
    const fsPromises = await import('fs/promises');
    const nodeBuffer = Buffer.from(buffer);
    await fsPromises.writeFile(filePath, nodeBuffer);
  }

  // File storage methods for 0studio commit storage
  private async saveCommitFile(filePath: string, commitId: string, buffer: ArrayBuffer, originalFormat?: string): Promise<void> {
    this.validateProjectPath(filePath);
    await this.fileStorage.saveCommitFile(filePath, commitId, buffer, originalFormat);
  }

  private async readCommitFile(filePath: string, commitId: string, originalFormat?: string): Promise<ArrayBuffer | null> {
    this.validateProjectPath(filePath);
    return await this.fileStorage.readCommitFile(filePath, commitId, originalFormat);
  }

  private async listCommitFiles(filePath: string): Promise<string[]> {
    this.validateProjectPath(filePath);
    return await this.fileStorage.listCommitFiles(filePath);
  }

  private commitFileExists(filePath: string, commitId: string): boolean {
    this.validateProjectPath(filePath);
    return this.fileStorage.commitFileExists(filePath, commitId);
  }

  // Tree file methods
  private async saveTreeFile(filePath: string, treeData: any): Promise<void> {
    this.validateProjectPath(filePath);
    await this.fileStorage.saveTreeFile(filePath, treeData);
  }

  private async loadTreeFile(filePath: string): Promise<any> {
    this.validateProjectPath(filePath);
    return await this.fileStorage.loadTreeFile(filePath);
  }

  private validateCommitFiles(filePath: string, commitIds: string[]): string[] {
    this.validateProjectPath(filePath);
    return this.fileStorage.validateCommitFiles(filePath, commitIds);
  }

  private async saveModelVersion(): Promise<void> {
    if (!this.currentProjectFile) {
      dialog.showErrorBox('Error', 'No model is currently open.');
      return;
    }

    this.safeSend('show-save-version-dialog');
  }

  private async showVersionHistory(): Promise<void> {
    if (!this.currentProjectFile) {
      dialog.showErrorBox('Error', 'No model is currently open.');
      return;
    }

    this.safeSend('show-version-history');
  }

  private async simulateChanges(): Promise<void> {
    if (!this.currentProjectFile) {
      dialog.showErrorBox('Error', 'No model is currently open.');
      return;
    }

    this.safeSend('simulate-model-changes');
  }

  private async exportModel(): Promise<void> {
    if (!this.currentProjectFile) {
      dialog.showErrorBox('Error', 'No model is currently open.');
      return;
    }

    this.safeSend('export-model');
  }

  /**
   * Build a redacted diagnostic snapshot. Used by the IPC handler, the
   * --diag-report CLI flag, and the on-start snapshot writer.
   *
   * `includeLogTail` is opt-in because the on-start snapshot is a system-info
   * baseline written before any errors have happened — including a 64KB tail
   * just bloats the file. The IPC handler and CLI both default to including it.
   */
  private async buildDiagnosticReport(opts: { includeLogTail: boolean }): Promise<Record<string, unknown>> {
    const logFilePath = log.transports.file.getFile().path;
    const report: Record<string, unknown> = {
      appVersion: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      locale: app.getLocale(),
      timestamp: new Date().toISOString(),
      logFilePath: applyRedactions(logFilePath),
    };
    try {
      report.gpu = await app.getGPUInfo('basic');
    } catch (err) {
      report.gpu = { error: (err as Error).message };
    }
    if (opts.includeLogTail) {
      report.logTail = await this.readLogTail(logFilePath, 64 * 1024);
    }
    return report;
  }

  /**
   * Read the last `bytes` bytes of the log file, scrubbed through the same
   * redaction pipeline that filters new log writes. Defends against the case
   * where an older logger version (or a third-party module) wrote secrets to
   * the file before the redaction hook was installed.
   */
  private async readLogTail(filePath: string, bytes: number): Promise<string> {
    const handle = await fsOpen(filePath, 'r');
    try {
      const { size } = await handle.stat();
      const length = Math.min(bytes, size);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, Math.max(0, size - length));
      return applyRedactions(buffer.toString('utf8'));
    } finally {
      await handle.close();
    }
  }

  /**
   * Write a minimal diagnostic report to userData/logs/diag-report.json on
   * every app start. Lets a tester or support agent fetch system info even if
   * the app crashes during launch (and the renderer never becomes available
   * to call the IPC handler).
   */
  private async writeStartupDiagnosticSnapshot(): Promise<void> {
    const logFile = log.transports.file.getFile().path;
    const target = join(dirname(logFile), 'diag-report.json');
    const report = await this.buildDiagnosticReport({ includeLogTail: false });
    await writeFile(target, JSON.stringify(report, null, 2), 'utf8');
  }
}

// Create the app instance
new RhinoStudio();