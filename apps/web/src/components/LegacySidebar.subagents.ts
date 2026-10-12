import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";

import type { SidebarThreadSummary } from "../types";

type GroupableThread = Pick<
  SidebarThreadSummary,
  "archivedAt" | "environmentId" | "id" | "lineage"
>;

const threadKeyOf = (thread: Pick<SidebarThreadSummary, "environmentId" | "id">) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

/**
 * Splits a project's threads, archived ones included, into unarchived sidebar
 * rows and the unarchived subagent threads folded under each row. A subagent
 * folds under its nearest listed ancestor that is not itself folded; one whose
 * parent is not listed (another project) stays a row so it never disappears.
 * Archiving does not cascade to subagents, so an archived row hides its own.
 * Input order is kept.
 */
export function groupLegacySidebarSubagentThreads<T extends GroupableThread>(
  threads: readonly T[],
): { rows: T[]; subagentsByRowKey: Map<string, T[]> } {
  const threadByKey = new Map(threads.map((thread) => [threadKeyOf(thread), thread] as const));
  const rowOf = (thread: T): T => {
    let current = thread;
    const seen = new Set([threadKeyOf(thread)]);
    while (
      current.lineage.relationshipToParent === "subagent" &&
      current.lineage.parentThreadId !== null
    ) {
      const parentKey = scopedThreadKey(
        scopeThreadRef(current.environmentId, current.lineage.parentThreadId),
      );
      const parent = threadByKey.get(parentKey);
      if (!parent) break;
      if (seen.has(parentKey)) return thread;
      seen.add(parentKey);
      current = parent;
    }
    return current;
  };

  const rows: T[] = [];
  const subagentsByRowKey = new Map<string, T[]>();
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    const row = rowOf(thread);
    if (row.archivedAt !== null) continue;
    if (row === thread) {
      rows.push(thread);
      continue;
    }
    const rowKey = threadKeyOf(row);
    const subagents = subagentsByRowKey.get(rowKey);
    if (subagents) subagents.push(thread);
    else subagentsByRowKey.set(rowKey, [thread]);
  }
  return { rows, subagentsByRowKey };
}

/**
 * Keys of subagent threads that are still working in the background. Native
 * provider subagents (Claude's Agent tool) never get runs of their own, so
 * their shells always read idle; once the parent's turn ends, the parent's
 * background roster is the only shell data that says they still work.
 */
export function backgroundSubagentThreadKeys(
  threads: readonly Pick<SidebarThreadSummary, "environmentId" | "pendingBackgroundTasks">[],
): Set<string> {
  const keys = new Set<string>();
  for (const thread of threads) {
    for (const task of thread.pendingBackgroundTasks) {
      if (task.kind === "subagent" && task.childThreadId !== undefined) {
        keys.add(scopedThreadKey(scopeThreadRef(thread.environmentId, task.childThreadId)));
      }
    }
  }
  return keys;
}

const LIVE_RUNTIME_STATUSES: ReadonlySet<string> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

/** Finished subagents leave the sidebar; the thread's Lineage panel still lists them. */
export function isLiveLegacySidebarSubagent(
  thread: Pick<
    SidebarThreadSummary,
    "environmentId" | "id" | "runtime" | "hasPendingApprovals" | "hasPendingUserInput"
  >,
  backgroundSubagentKeys: ReadonlySet<string>,
): boolean {
  return (
    backgroundSubagentKeys.has(threadKeyOf(thread)) ||
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    (thread.runtime != null && LIVE_RUNTIME_STATUSES.has(thread.runtime.status))
  );
}
