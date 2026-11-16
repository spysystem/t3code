import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import type { OrchestrationV2ThreadSpace } from "@t3tools/contracts";

import { threadSpaceOf } from "../../threadSpace";
import type { SidebarThreadSummary } from "../../types";
import {
  filterSidebarV2VisibleThreads,
  resolveThreadLastVisitedAt,
  resolveThreadStatusPill,
  type ThreadStatusPill,
} from "../Sidebar.logic";

type WaitingStatuses = ReadonlyArray<ThreadStatusPill["label"]>;

// Statuses that wait on the user, most urgent first. Working and connecting
// threads do not: they need nobody until they finish.
const DEFAULT_WAITING_ON_USER: WaitingStatuses = [
  "Pending Approval",
  "Awaiting Input",
  "Plan Ready",
  "Completed",
];

const WAITING_ON_USER: Record<OrchestrationV2ThreadSpace, WaitingStatuses> = {
  development: DEFAULT_WAITING_ON_USER,
  support: DEFAULT_WAITING_ON_USER,
  // Every bot follow-up ends unread, so an unseen completion would keep the badge lit.
  automation: ["Pending Approval", "Awaiting Input", "Failed", "Plan Ready"],
};

export interface SpaceAttention {
  readonly count: number;
  /** The most urgent waiting status, for the badge colour. */
  readonly status: ThreadStatusPill | null;
}

/** Threads in `space` that wait on the user, ignoring parked (settled or snoozed) ones. */
export function resolveSpaceAttention(input: {
  readonly threads: readonly SidebarThreadSummary[];
  readonly delegatedUnderParent: ReadonlySet<string>;
  readonly space: OrchestrationV2ThreadSpace;
  readonly localLastVisitedAtByKey: Readonly<Record<string, string>>;
  readonly now: string;
}): SpaceAttention {
  const waiting = WAITING_ON_USER[input.space];
  let count = 0;
  let mostUrgent: ThreadStatusPill | null = null;
  for (const thread of filterSidebarV2VisibleThreads(
    input.threads,
    null,
    input.delegatedUnderParent,
  )) {
    if (threadSpaceOf(thread) !== input.space) continue;
    if (thread.settledOverride === "settled") continue;
    if (effectiveSnoozed(thread, { now: input.now })) continue;
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    const lastVisitedAt = resolveThreadLastVisitedAt(
      thread.lastVisitedAt,
      input.localLastVisitedAtByKey[key],
    );
    const status = resolveThreadStatusPill({ thread: { ...thread, lastVisitedAt } });
    const urgency = status === null ? -1 : waiting.indexOf(status.label);
    if (urgency === -1) continue;
    count += 1;
    if (mostUrgent === null || urgency < waiting.indexOf(mostUrgent.label)) {
      mostUrgent = status;
    }
  }
  return { count, status: mostUrgent };
}
