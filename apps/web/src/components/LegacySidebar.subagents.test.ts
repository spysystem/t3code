import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  backgroundSubagentThreadKeys,
  groupLegacySidebarSubagentThreads,
  isLiveLegacySidebarSubagent,
} from "./LegacySidebar.subagents";

const environmentId = EnvironmentId.make("environment-local");

const thread = (
  id: string,
  parentId: string | null = null,
  relationship: "fork" | "subagent" = "subagent",
) => ({
  environmentId,
  id: ThreadId.make(id),
  archivedAt: null as string | null,
  lineage: {
    rootThreadId: ThreadId.make(parentId ?? id),
    parentThreadId: parentId === null ? null : ThreadId.make(parentId),
    relationshipToParent: parentId === null ? null : relationship,
  },
});

const rowKey = (id: string) => scopedThreadKey(scopeThreadRef(environmentId, ThreadId.make(id)));

const ids = (threads: readonly { id: string }[]) => threads.map((entry) => entry.id);

describe("groupLegacySidebarSubagentThreads", () => {
  it("folds subagents, including nested ones, under their top-level owner", () => {
    const worker = thread("worker");
    const { rows, subagentsByRowKey } = groupLegacySidebarSubagentThreads([
      thread("other"),
      thread("child-a", "worker"),
      worker,
      thread("grandchild", "child-a"),
      thread("child-b", "worker"),
    ]);

    expect(ids(rows)).toEqual(["other", "worker"]);
    expect(ids(subagentsByRowKey.get(rowKey("worker")) ?? [])).toEqual([
      "child-a",
      "grandchild",
      "child-b",
    ]);
  });

  it("keeps a subagent as a row when its parent is not listed", () => {
    const { rows, subagentsByRowKey } = groupLegacySidebarSubagentThreads([
      thread("orphan", "archived-worker"),
      thread("orphan-child", "orphan"),
    ]);

    expect(ids(rows)).toEqual(["orphan"]);
    expect(ids(subagentsByRowKey.get(rowKey("orphan")) ?? [])).toEqual(["orphan-child"]);
  });

  it("hides the subagents of an archived thread", () => {
    const { rows, subagentsByRowKey } = groupLegacySidebarSubagentThreads([
      { ...thread("worker"), archivedAt: "2026-10-12T08:00:00.000Z" },
      thread("child", "worker"),
      thread("grandchild", "child"),
    ]);

    expect(rows).toEqual([]);
    expect(subagentsByRowKey.size).toBe(0);
  });

  it("leaves forks as rows", () => {
    const { rows, subagentsByRowKey } = groupLegacySidebarSubagentThreads([
      thread("source"),
      thread("fork", "source", "fork"),
    ]);

    expect(ids(rows)).toEqual(["source", "fork"]);
    expect(subagentsByRowKey.size).toBe(0);
  });
});

describe("backgroundSubagentThreadKeys", () => {
  it("lists only subagents the parent still waits on", () => {
    const keys = backgroundSubagentThreadKeys([
      {
        environmentId,
        pendingBackgroundTasks: [
          { taskId: "task-1", kind: "subagent", childThreadId: ThreadId.make("child-a") },
          { taskId: "task-2", kind: "subagent" },
          { taskId: "task-3", kind: "command" },
        ],
      },
      { environmentId, pendingBackgroundTasks: [] },
    ]);

    expect([...keys]).toEqual([rowKey("child-a")]);
  });
});

describe("isLiveLegacySidebarSubagent", () => {
  const subagent = {
    environmentId,
    id: ThreadId.make("child"),
    runtime: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
  };

  it("treats a finished subagent as gone", () => {
    expect(isLiveLegacySidebarSubagent(subagent, new Set())).toBe(false);
  });

  it("keeps a subagent its parent still waits on", () => {
    expect(isLiveLegacySidebarSubagent(subagent, new Set([rowKey("child")]))).toBe(true);
  });

  it("keeps a subagent that needs an answer", () => {
    expect(isLiveLegacySidebarSubagent({ ...subagent, hasPendingUserInput: true }, new Set())).toBe(
      true,
    );
  });
});
