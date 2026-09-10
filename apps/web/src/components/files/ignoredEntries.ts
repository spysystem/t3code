import type { ProjectEntry } from "@t3tools/contracts";

/** Stable selector shared by the Files tree and breadcrumb menus. */
export const selectFilesShowIgnored = (settings: { readonly filesShowIgnored: boolean }) =>
  settings.filesShowIgnored;

/** Hides cached descendants as well as ignored entries when visibility is disabled. */
export function visibleFileEntries(entries: readonly ProjectEntry[], showIgnored: boolean) {
  if (showIgnored) return entries;
  const ignored = new Set(entries.filter((entry) => entry.ignored).map((entry) => entry.path));
  return entries.filter((entry) => {
    let path = entry.path;
    while (path) {
      if (ignored.has(path)) return false;
      const separator = path.lastIndexOf("/");
      if (separator === -1) break;
      path = path.slice(0, separator);
    }
    return true;
  });
}
