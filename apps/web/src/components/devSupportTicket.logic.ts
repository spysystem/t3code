import type { OrchestrationV2ThreadSpace } from "@t3tools/contracts";
import { DEV_SUPPORT_TICKET_SKILL } from "@t3tools/shared/devSupportTicket";
import { SPY_ADMIN_TRACKER } from "@t3tools/shared/spyAdminTasks";

/** First message of a thread started with "Start from ticket": the investigation skill. */
export function devSupportTicketPrompt(taskId: string): string {
  return `$${DEV_SUPPORT_TICKET_SKILL} ${taskId}`;
}

/** Accepts `12345` or `#12345`; anything else is not a task ID. */
export function parseDevSupportTaskId(input: string): string | null {
  const match = /^#?(\d+)$/u.exec(input.trim());
  return match?.[1] ?? null;
}

/**
 * The most recently active, unarchived Dev support thread for the ticket: one the task is linked
 * to, else one whose title mentions it as `#<id>`. Start from ticket titles a new thread with it,
 * and the skill keeps it when renaming, as in "Investigate #<id> <subject>".
 */
export function findDevSupportThread<
  T extends {
    readonly title: string;
    readonly archivedAt: string | null;
    readonly updatedAt: string;
    readonly space?: OrchestrationV2ThreadSpace | undefined;
    readonly issues?: ReadonlyArray<{ readonly tracker: string; readonly key: string }> | undefined;
  },
>(threads: readonly T[], taskId: string): T | null {
  const mention = new RegExp(String.raw`(?:^|\s)#${taskId}(?!\d)`, "u");
  const newest = (found: T | null, thread: T) =>
    found === null || Date.parse(thread.updatedAt) > Date.parse(found.updatedAt) ? thread : found;
  let linked: T | null = null;
  let mentioned: T | null = null;
  for (const thread of threads) {
    if (thread.space !== "support" || thread.archivedAt !== null) continue;
    if (thread.issues?.some((link) => link.tracker === SPY_ADMIN_TRACKER && link.key === taskId))
      linked = newest(linked, thread);
    else if (mention.test(thread.title)) mentioned = newest(mentioned, thread);
  }
  return linked ?? mentioned;
}
