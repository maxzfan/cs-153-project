export const SUPPORTED_PROJECT_EXTS = ['.3dm', '.rvt', '.ifc'] as const;

export function isSupportedProjectFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return SUPPORTED_PROJECT_EXTS.some((ext) => lower.endsWith(ext));
}
