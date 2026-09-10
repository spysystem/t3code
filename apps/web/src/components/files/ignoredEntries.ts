import type { ProjectEntry } from "@t3tools/contracts";

/** Stable selector so every Files panel surface reads the same client setting. */
export const selectFilesShowIgnored = (settings: { readonly filesShowIgnored: boolean }) =>
  settings.filesShowIgnored;

/**
 * Appends lazily loaded children of ignored directories to a workspace listing.
 * Children are only kept while their directory is still listed as ignored, so a
 * refresh that drops or un-ignores a directory also drops what was loaded under
 * it. Everything under an ignored directory is itself ignored.
 */
export function mergeLoadedIgnoredDirectories(
  listed: readonly ProjectEntry[],
  loaded: ReadonlyMap<string, readonly ProjectEntry[]>,
): readonly ProjectEntry[] {
  if (loaded.size === 0) return listed;
  const ignoredDirectories = new Set(
    listed
      .filter((entry) => entry.kind === "directory" && entry.ignored === true)
      .map((entry) => entry.path),
  );
  const merged = [...listed];
  const seen = new Set(listed.map((entry) => entry.path));
  // Directories loaded under other loaded directories resolve in path order, so
  // a nested directory is admitted once its parent's children have been added.
  const pending = [...loaded.keys()].toSorted((left, right) => left.length - right.length);
  for (const directoryPath of pending) {
    if (!ignoredDirectories.has(directoryPath)) continue;
    for (const child of loaded.get(directoryPath) ?? []) {
      if (seen.has(child.path)) continue;
      seen.add(child.path);
      const entry = { ...child, ignored: true };
      merged.push(entry);
      if (entry.kind === "directory") ignoredDirectories.add(entry.path);
    }
  }
  return merged;
}
