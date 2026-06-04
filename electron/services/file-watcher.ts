import chokidar, { FSWatcher } from 'chokidar';

export interface WatchTargets {
  /** The primary project file (.3dm / .rvt / .ifc). */
  primary: string;
  /** Optional IFC sidecar for .rvt projects. Must already be realpath-resolved. */
  sidecar?: string | null;
}

export class FileWatcherService {
  private watcher: FSWatcher | null = null;
  private isWatching = false;
  private watchedPaths: string[] = [];

  /**
   * Watch a project's primary file (and optional IFC sidecar) for changes.
   * Uses chokidar for reliable macOS file watching (handles null-filename events
   * and atomic-rename saves from Rhino/Revit).
   *
   * Both paths fire the same callback with the per-change filename so the caller
   * (main.ts) can decide whether to treat it as a primary-edit or a sidecar-refresh.
   */
  watch(targets: string | WatchTargets, callback: (eventType: string, filename?: string) => void): void {
    if (this.isWatching) {
      this.stop();
    }

    // Accept either a bare primary path (legacy signature) or the structured form.
    const paths: string[] = typeof targets === 'string'
      ? [targets]
      : [targets.primary, ...(targets.sidecar ? [targets.sidecar] : [])];
    this.watchedPaths = paths;

    this.watcher = chokidar.watch(paths, {
      persistent: true,
      ignoreInitial: true,
      // This ignore matcher only fires for paths reached via globs/recursive patterns.
      // We currently hand chokidar explicit file paths so it's dormant — kept as a safety
      // net in case a future change widens scope to the 0studio_ folder: without this,
      // every commit would self-trigger by writing a .glb or .delta.
      ignored: (p: string) => p.endsWith('.glb') || p.endsWith('.delta'),
      awaitWriteFinish: {
        // Bumped from 500 ms to 1500 ms so Rhino's atomic-rename saves of
        // large .3dm files on Windows clear their write lock before chokidar
        // emits 'change'. Without this, we hit EBUSY on the immediate read
        // and have to fall back to retry-with-backoff in main.ts. 1500 ms
        // matches the chokidar README's "editors that do atomic saves of
        // large files" guidance and what Atom/VS Code use for big files.
        // Cost: ~+1 s detection latency, invisible for save → commit UX.
        stabilityThreshold: 1500,
        pollInterval: 100,
      },
    });

    // Chokidar passes the actual changed path to add/change/unlink handlers when watching
    // multiple files, so callers can distinguish primary vs. sidecar events.
    this.watcher.on('add', (path) => callback('change', path));
    this.watcher.on('change', (path) => callback('change', path));
    this.watcher.on('unlink', (path) => callback('unlink', path));
    this.watcher.on('error', (error) => {
      // EBUSY/EPERM are transient on Windows when Rhino still holds the write
      // lock during atomic-rename saves. They're not user-actionable; swallow
      // them as debug noise rather than surfacing as hard errors to the
      // renderer (which would render an unrecoverable error toast).
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EBUSY' || code === 'EPERM') return;
      callback('error', error instanceof Error ? error.message : String(error));
    });

    this.isWatching = true;
  }

  /**
   * Stop watching the current file
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.isWatching = false;
      this.watchedPaths = [];
    }
  }

  /**
   * Check if currently watching a file
   */
  get watching(): boolean {
    return this.isWatching;
  }

  /**
   * Get list of watched paths
   */
  getWatchedPaths(): string[] {
    return [...this.watchedPaths];
  }
}
