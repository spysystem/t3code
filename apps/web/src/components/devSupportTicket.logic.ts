import type { OrchestrationV2ThreadSpace } from "@t3tools/contracts";
import { DEV_SUPPORT_TICKET_SKILL } from "@t3tools/shared/devSupportTicket";

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
 * The most recently active, unarchived Dev support thread about a ticket: one
 * whose title mentions `#<id>`, like the "#12345" Start from ticket gives a new
 * thread or the "Investigate #12345 <subject>" the skill renames it to.
 */
export function findDevSupportThread<
  T extends {
    readonly title: string;
    readonly archivedAt: string | null;
    readonly updatedAt: string;
    readonly space?: OrchestrationV2ThreadSpace | undefined;
  },
>(threads: readonly T[], taskId: string): T | null {
  const mention = new RegExp(String.raw`(?:^|\s)#${taskId}(?!\d)`, "u");
  let found: T | null = null;
  for (const thread of threads) {
    if (thread.space !== "support" || thread.archivedAt !== null) continue;
    if (!mention.test(thread.title)) continue;
    if (found === null || Date.parse(thread.updatedAt) > Date.parse(found.updatedAt)) {
      found = thread;
    }
  }
  return found;
}
