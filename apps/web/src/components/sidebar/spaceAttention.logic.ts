import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import type { OrchestrationV2ThreadSpace } from "@t3tools/contracts";

import { threadSpaceOf } from "../../threadSpace";
import type { SidebarThreadSummary } from "../../types";
import {
  filterSidebarV2VisibleThreads,
  resolveProjectStatusIndicator,
  resolveThreadLastVisitedAt,
  resolveThreadStatusPill,
  type ThreadStatusPill,
} from "../Sidebar.logic";

// Statuses that wait on the user. Working and connecting threads do not: they
// need nobody until they finish.
const WAITING_ON_USER: ReadonlySet<ThreadStatusPill["label"]> = new Set([
  "Pending Approval",
  "Awaiting Input",
  "Plan Ready",
  "Completed",
]);

export interface SpaceAttention {
  readonly count: number;
  /** The most urgent waiting status, for the badge colour. */
  readonly status: ThreadStatusPill | null;
}

/** Threads in `space` that wait on the user, ignoring parked (settled or snoozed) ones. */
export function resolveSpaceAttention(input: {
  readonly threads: readonly SidebarThreadSummary[];
  readonly space: OrchestrationV2ThreadSpace;
  readonly localLastVisitedAtByKey: Readonly<Record<string, string>>;
  readonly now: string;
}): SpaceAttention {
  const statuses: ThreadStatusPill[] = [];
  for (const thread of filterSidebarV2VisibleThreads(input.threads, null)) {
    if (threadSpaceOf(thread) !== input.space) continue;
    if (thread.settledOverride === "settled") continue;
    if (effectiveSnoozed(thread, { now: input.now })) continue;
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    const lastVisitedAt = resolveThreadLastVisitedAt(
      thread.lastVisitedAt,
      input.localLastVisitedAtByKey[key],
    );
    const status = resolveThreadStatusPill({ thread: { ...thread, lastVisitedAt } });
    if (status !== null && WAITING_ON_USER.has(status.label)) statuses.push(status);
  }
  return { count: statuses.length, status: resolveProjectStatusIndicator(statuses) };
}
