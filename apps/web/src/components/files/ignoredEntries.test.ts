import { describe, expect, it } from "vite-plus/test";
import type { ProjectEntry } from "@t3tools/contracts";
import { visibleFileEntries } from "./ignoredEntries";

describe("visibleFileEntries", () => {
  const entries: readonly ProjectEntry[] = [
    { path: "src", kind: "directory" },
    { path: "src/index.ts", kind: "file" },
    { path: ".env", kind: "file", ignored: true },
    { path: "notes", kind: "directory", ignored: true },
    { path: "notes/drafts/a.md", kind: "file" },
    { path: "notes-public/a.md", kind: "file" },
  ];

  it("hides ignored files and cached descendants without hiding similarly named paths", () => {
    expect(visibleFileEntries(entries, false)).toEqual([entries[0], entries[1], entries[5]]);
  });

  it("shows cached ignored entries again when enabled", () => {
    expect(visibleFileEntries(entries, true)).toEqual(entries);
  });
});
