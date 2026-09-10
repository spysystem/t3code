import { describe, expect, it } from "vite-plus/test";

import type { ProjectEntry } from "@t3tools/contracts";

import { mergeLoadedIgnoredDirectories } from "./ignoredEntries";

const listed: readonly ProjectEntry[] = [
  { path: "src", kind: "directory" },
  { path: "src/index.ts", kind: "file" },
  { path: ".env", kind: "file", ignored: true },
  { path: "notes", kind: "directory", ignored: true },
];

describe("mergeLoadedIgnoredDirectories", () => {
  it("returns the listing untouched when nothing has been loaded", () => {
    expect(mergeLoadedIgnoredDirectories(listed, new Map())).toBe(listed);
  });

  it("marks loaded children as ignored and admits nested directories in order", () => {
    const loaded = new Map<string, readonly ProjectEntry[]>([
      ["notes/drafts", [{ path: "notes/drafts/a.md", kind: "file" }]],
      [
        "notes",
        [
          { path: "notes/spec.md", kind: "file" },
          { path: "notes/drafts", kind: "directory" },
        ],
      ],
    ]);

    expect(mergeLoadedIgnoredDirectories(listed, loaded)).toEqual([
      ...listed,
      { path: "notes/spec.md", kind: "file", ignored: true },
      { path: "notes/drafts", kind: "directory", ignored: true },
      { path: "notes/drafts/a.md", kind: "file", ignored: true },
    ]);
  });

  it("drops children of directories that are no longer listed as ignored", () => {
    const loaded = new Map<string, readonly ProjectEntry[]>([
      ["notes", [{ path: "notes/spec.md", kind: "file" }]],
      ["build", [{ path: "build/out.js", kind: "file" }]],
    ]);
    const withoutIgnored = listed.filter((entry) => entry.ignored !== true);

    expect(mergeLoadedIgnoredDirectories(withoutIgnored, loaded)).toEqual(withoutIgnored);
  });
});
