/**
 * Start from ticket opens a Dev support thread whose first message runs SPY's
 * ticket investigation skill. A thread launched with that skill lands in Dev
 * support no matter which client or agent started it.
 */
export const DEV_SUPPORT_TICKET_SKILL = "spy-investigate-ticket";

// Composers write a skill as `$name` for every provider; agents may use `/name`.
const TICKET_SKILL_MENTION = new RegExp(
  String.raw`(?:^|\s)[$/]${DEV_SUPPORT_TICKET_SKILL}(?=\s|$)`,
  "u",
);

/** Whether a thread's first message invokes the ticket investigation skill. */
export function invokesDevSupportTicketSkill(message: {
  readonly text: string;
  readonly context?: { readonly records: ReadonlyArray<unknown> } | undefined;
}): boolean {
  if (TICKET_SKILL_MENTION.test(message.text)) return true;
  return (message.context?.records ?? []).some(
    (record) =>
      typeof record === "object" &&
      record !== null &&
      "kind" in record &&
      record.kind === "skill" &&
      "name" in record &&
      record.name === DEV_SUPPORT_TICKET_SKILL,
  );
}
