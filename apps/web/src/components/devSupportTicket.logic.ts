import type { OrchestrationV2ThreadSpace } from "@t3tools/contracts";

/** First message of a thread started with "Start from ticket". */
export function devSupportTicketPrompt(taskId: string): string {
  return `Dev-support ticket #${taskId}.

1. Fetch the task with the spy-admin-tasks MCP: export task ${taskId} with comments and related tasks to a file outside the repository, list its attachments, and download the ones that matter.
2. Rename this thread to "#${taskId} – <task title>".
3. Look for earlier cases before investigating: search previous support threads with t3_thread_search for the same error, module, or customer, and read the related tasks in the export.
4. Find the customer's SPY system and the release it runs. Then move this thread into its own worktree based on that release with t3_worktree_handoff (branch "support/${taskId}"), and pass the remaining steps as continuationPrompt so the work continues there.
5. Investigate against that code, and make code changes if the fix needs them.
6. If you changed code, verify the fix on a SPY dev system with the spy-browser-testing skill before answering, and say what you tested and what you saw.
7. Answer with the root cause with evidence, any workaround, and the fix. End with a section headed exactly "### ${SUPPORTER_REPLY_HEADING}": a short reply the supporter can paste into Admin, written as plain text in the ticket's language, with no Markdown and no arrows, and tasks referred to as #<id>.`;
}

export const SUPPORTER_REPLY_HEADING = "Reply to supporter";

/**
 * The supporter reply from the newest finished assistant message that has
 * one: the text under the "Reply to supporter" heading, up to the next heading.
 */
export function extractSupporterReply(
  messages: ReadonlyArray<{
    readonly role: string;
    readonly text: string;
    readonly streaming: boolean;
  }>,
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "assistant" || message.streaming) continue;
    const lines = message.text.split("\n");
    const start = lines.findIndex((line) =>
      new RegExp(`^#{1,6}\\s+${SUPPORTER_REPLY_HEADING}\\s*:?\\s*$`, "iu").test(line.trim()),
    );
    if (start < 0) continue;
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^#{1,6}\s/u.test(line.trim()));
    const reply = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
    if (reply !== "") return reply;
  }
  return null;
}

export type DevSupportFollowUp = "split-task";

export const DEV_SUPPORT_FOLLOW_UP_LABELS: Record<DevSupportFollowUp, string> = {
  "split-task": "Create split task",
};

/** The message a support follow-up sends to the thread's agent. */
export function devSupportFollowUpPrompt(followUp: DevSupportFollowUp, taskId: string): string {
  switch (followUp) {
    case "split-task":
      return `Create a task for the fix in this thread with the create-spy-task-note skill, and mention that it comes from ticket #${taskId}.`;
  }
}

export function devSupportTaskUrl(taskId: string): string {
  return `https://admin.spysystem.dk/?controller=Task%5CView&action=ViewTask&iTaskID=${taskId}`;
}

/** Accepts `12345` or `#12345`; anything else is not a task ID. */
export function parseDevSupportTaskId(input: string): string | null {
  const match = /^#?(\d+)$/u.exec(input.trim());
  return match?.[1] ?? null;
}

/**
 * The ticket a support thread is about, read from its title: the ticket
 * prompt has the agent rename the thread to "#<id> – <task title>".
 */
export function devSupportTaskIdFromTitle(title: string): string | null {
  return /(?:^|\s)#(\d+)\b/u.exec(title)?.[1] ?? null;
}

/** The most recently active, unarchived support thread for a ticket. */
export function findDevSupportThread<
  T extends {
    readonly title: string;
    readonly archivedAt: string | null;
    readonly updatedAt: string;
    readonly space?: OrchestrationV2ThreadSpace | undefined;
  },
>(threads: readonly T[], taskId: string): T | null {
  let found: T | null = null;
  for (const thread of threads) {
    if (thread.space !== "support" || thread.archivedAt !== null) continue;
    if (devSupportTaskIdFromTitle(thread.title) !== taskId) continue;
    if (found === null || Date.parse(thread.updatedAt) > Date.parse(found.updatedAt)) {
      found = thread;
    }
  }
  return found;
}
