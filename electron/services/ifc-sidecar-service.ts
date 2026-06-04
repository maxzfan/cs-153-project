import { dirname, basename, extname, join, resolve, relative, isAbsolute } from 'path';
import { existsSync, statSync, readdirSync, lstatSync } from 'fs';
import { realpath, open } from 'fs/promises';

/**
 * IFC sidecar auto-detection for .rvt files.
 *
 * Revit projects don't have a browser-parseable format, so we treat a co-located
 * .ifc file as the "geometry bridge" — the user exports IFC from Revit, and we use
 * it to generate the glTF derivative for the versioned .rvt.
 *
 * Resolution priority (highest first):
 *   1. Exact basename match (`building.rvt` → `building.ifc`)
 *   2. Most recently modified `.ifc` in the same directory
 *
 * All results go through symlink resolution + containment + magic-byte validation
 * so a user can't be tricked into parsing an arbitrary file as IFC just because
 * someone named it with a `.ifc` extension.
 */

/**
 * IFC / STEP header magic bytes. web-ifc rejects anything else at parse time, but
 * we check ahead of time so we never surface a non-IFC file to the renderer. Both
 * markers are ASCII — we only need to peek at the first 32 bytes.
 *
 * Reference: ISO 10303-21 clause 5.2 (header prefix `ISO-10303-21;`). Some Revit
 * exporters omit the standard prefix and start directly with `STEP;` — tolerate both.
 */
const IFC_MAGIC_CANDIDATES = ['ISO-10303-21;', 'STEP;'];
const IFC_MAGIC_PEEK_BYTES = 32;

/**
 * Read the first N bytes of a file and check for an IFC/STEP magic prefix. Intentionally
 * uses fs.open/fd.read rather than readFile to avoid slurping a multi-GB IFC just to peek.
 */
async function hasIfcMagic(filePath: string): Promise<boolean> {
  let fd: import('fs/promises').FileHandle | null = null;
  try {
    fd = await open(filePath, 'r');
    const { buffer, bytesRead } = await fd.read(Buffer.alloc(IFC_MAGIC_PEEK_BYTES), 0, IFC_MAGIC_PEEK_BYTES, 0);
    const header = buffer.slice(0, bytesRead).toString('utf8').trimStart();
    return IFC_MAGIC_CANDIDATES.some(magic => header.startsWith(magic));
  } catch {
    return false;
  } finally {
    await fd?.close().catch(() => {});
  }
}

/**
 * Verify `candidate` is a regular file that:
 *   - is NOT a symlink (rejected for symlinks to avoid confusing traversal semantics)
 *   - resolves inside `allowedDir` after realpath (protects against bind-mount tricks)
 *   - carries an IFC/STEP magic prefix
 */
async function isSafeIfcCandidate(candidate: string, allowedDir: string): Promise<boolean> {
  try {
    // Reject symlinks outright. A symlinked .ifc could point to anything — we'd
    // rather force the user to copy or move the real file into the project directory
    // than silently traverse a link.
    const lst = lstatSync(candidate);
    if (lst.isSymbolicLink()) return false;
    if (!lst.isFile()) return false;

    // Canonicalize the path, then assert containment via path.relative — the
    // cross-platform equivalent of a startsWith check, without the '/foo' vs '/foobar'
    // prefix-overlap bug.
    const resolvedCandidate = await realpath(candidate);
    const resolvedAllowed = await realpath(allowedDir);
    const rel = relative(resolvedAllowed, resolvedCandidate);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return false;

    return await hasIfcMagic(resolvedCandidate);
  } catch {
    return false;
  }
}

export interface IfcSidecarResult {
  /** Fully-resolved (realpath) path to the sidecar. */
  path: string;
  /** Whether the sidecar basename matched the .rvt basename exactly. */
  exactMatch: boolean;
}

/**
 * Detect an IFC sidecar for a primary file. Returns null if:
 *   - the primary file is not .rvt (other formats don't use sidecars)
 *   - no valid .ifc is found in the directory
 *   - all candidates fail security/magic-byte validation
 */
export async function detectIfcSidecar(primaryFilePath: string): Promise<IfcSidecarResult | null> {
  const primaryExt = extname(primaryFilePath).toLowerCase();
  if (primaryExt !== '.rvt') return null;

  const dir = dirname(primaryFilePath);
  const baseNoExt = basename(primaryFilePath, primaryExt);

  // 1. Exact basename match wins. This is the documented convention users will rely on.
  const exactCandidate = join(dir, `${baseNoExt}.ifc`);
  if (existsSync(exactCandidate) && await isSafeIfcCandidate(exactCandidate, dir)) {
    const resolved = await realpath(exactCandidate);
    return { path: resolved, exactMatch: true };
  }

  // 2. Fall back to the most recently modified .ifc in the same directory. Bounded to
  //    this directory only — we never recurse into subfolders. readdirSync is synchronous
  //    but Electron file open is a rare event so the blocking time is negligible.
  let newest: { path: string; mtimeMs: number } | null = null;
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.ifc')) continue;
      const candidatePath = join(dir, entry);
      try {
        const st = statSync(candidatePath);
        if (!st.isFile()) continue;
        if (!newest || st.mtimeMs > newest.mtimeMs) {
          newest = { path: candidatePath, mtimeMs: st.mtimeMs };
        }
      } catch {
        // Unreadable entry — skip. realpath + validation happens below on the winner.
      }
    }
  } catch {
    return null;
  }

  if (newest && await isSafeIfcCandidate(newest.path, dir)) {
    const resolved = await realpath(newest.path);
    return { path: resolved, exactMatch: false };
  }

  return null;
}
