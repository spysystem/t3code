import { describe, expect, it } from "vite-plus/test";

import { invokesDevSupportTicketSkill } from "./devSupportTicket.ts";

describe("invokesDevSupportTicketSkill", () => {
  it("recognizes the skill written as a composer mention or a slash command", () => {
    expect(invokesDevSupportTicketSkill({ text: "$spy-investigate-ticket 12345" })).toBe(true);
    expect(invokesDevSupportTicketSkill({ text: "Please\n/spy-investigate-ticket 12345" })).toBe(
      true,
    );
  });

  it("recognizes a skill record attached to the message", () => {
    expect(
      invokesDevSupportTicketSkill({
        text: "Look at 12345",
        context: { records: [{ kind: "skill", name: "spy-investigate-ticket" }] },
      }),
    ).toBe(true);
  });

  it("ignores other skills and plain mentions of the name", () => {
    expect(invokesDevSupportTicketSkill({ text: "$spy-investigate-ticket-cloud 12345" })).toBe(
      false,
    );
    expect(invokesDevSupportTicketSkill({ text: "What does spy-investigate-ticket do?" })).toBe(
      false,
    );
    expect(
      invokesDevSupportTicketSkill({
        text: "Plan it",
        context: { records: [{ kind: "skill", name: "plan-spy-task" }] },
      }),
    ).toBe(false);
  });
});
