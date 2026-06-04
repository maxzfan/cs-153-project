import log from 'electron-log/renderer';
import { installRedactionHook } from './log-redact';

let initialized = false;

/**
 * Install the redaction hook on the renderer's electron-log instance and start
 * catching uncaught renderer errors. Safe to call once at module load — guarded
 * against duplicate registration so HMR-triggered re-imports don't pile hooks
 * on the same log object.
 *
 * Renderer log calls IPC-bridge to the main-process electron-log instance,
 * which has its own redaction hook (defense in depth). Doing it here too means
 * a missed pattern doesn't slip into devtools console output before the IPC
 * round-trip.
 */
export function initRendererLogging(): void {
  if (initialized) return;
  initialized = true;
  installRedactionHook(log);
  log.errorHandler.startCatching();
}
