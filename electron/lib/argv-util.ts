import { existsSync, realpathSync } from 'node:fs';
import { isSupportedProjectFile } from './project-file.js';

const MAX_ARG_LENGTH = 4096;

const WINDOWS_SYSTEM_PREFIXES = [
  'c:\\windows\\',
  'c:\\program files\\',
  'c:\\program files (x86)\\',
  'c:\\programdata\\',
];

/**
 * Extract the first supported project file path from a Node argv array.
 *
 * Defends against:
 *  - Chromium / Electron flags (anything starting with `-` or `--`).
 *  - Oversized args (DoS via gigabyte-long argv strings).
 *  - Null-byte injection.
 *  - Symlink/junction abuse — paths are resolved with realpath before acceptance.
 *  - Opening files from Windows system directories (Windows/Program Files).
 *  - Non-existent paths.
 *
 * Returns the realpath-resolved file on success, or `null` if no candidate qualifies.
 */
export function extractProjectPath(argv: readonly string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (typeof arg !== 'string') continue;
    if (arg.length === 0 || arg.length > MAX_ARG_LENGTH) continue;
    if (arg.includes('\0')) continue;
    if (arg.startsWith('-')) continue;
    if (!isSupportedProjectFile(arg)) continue;

    let resolved: string;
    try {
      resolved = realpathSync(arg);
    } catch {
      continue;
    }

    if (process.platform === 'win32') {
      const lower = resolved.toLowerCase();
      if (WINDOWS_SYSTEM_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
        continue;
      }
    }

    if (!existsSync(resolved)) continue;
    return resolved;
  }
  return null;
}
