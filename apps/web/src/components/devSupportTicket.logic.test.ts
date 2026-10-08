import { describe, expect, it } from "vite-plus/test";

import {
  devSupportTaskIdFromTitle,
  extractSupporterReply,
  findDevSupportThread,
  parseDevSupportTaskId,
} from "./devSupportTicket.logic";

describe("parseDevSupportTaskId", () => {
  it("accepts a plain or #-prefixed task number", () => {
    expect(parseDevSupportTaskId(" 12345 ")).toBe("12345");
    expect(parseDevSupportTaskId("#12345")).toBe("12345");
  });

  it("rejects anything that is not a task number", () => {
    expect(parseDevSupportTaskId("")).toBeNull();
    expect(parseDevSupportTaskId("12a45")).toBeNull();
    expect(parseDevSupportTaskId("##12")).toBeNull();
  });
});

describe("devSupportTaskIdFromTitle", () => {
  it("reads the ticket from a renamed or generated title", () => {
    expect(devSupportTaskIdFromTitle("#12345 – Stock count mismatch")).toBe("12345");
    expect(devSupportTaskIdFromTitle("Investigate dev-support ticket #12345")).toBe("12345");
  });

  it("ignores titles without a ticket reference", () => {
    expect(devSupportTaskIdFromTitle("Fix issue12345")).toBeNull();
    expect(devSupportTaskIdFromTitle("Refactor sidebar")).toBeNull();
  });
});

describe("findDevSupportThread", () => {
  const thread = (overrides: Partial<Parameters<typeof findDevSupportThread>[0][number]>) => ({
    title: "#12345 – Stock count mismatch",
    archivedAt: null,
    updatedAt: "2026-10-01T10:00:00.000Z",
    space: "support" as const,
    ...overrides,
  });

  it("picks the most recently active support thread for the ticket", () => {
    const older = thread({ updatedAt: "2026-10-01T09:00:00.000Z" });
    const newer = thread({ updatedAt: "2026-10-02T09:00:00.000Z" });
    expect(findDevSupportThread([older, newer], "12345")).toBe(newer);
  });

  it("skips archived threads, other tickets, and development threads", () => {
    expect(
      findDevSupportThread(
        [
          thread({ archivedAt: "2026-10-03T00:00:00.000Z" }),
          thread({ title: "#99999 – Other ticket" }),
          thread({ space: "development" }),
        ],
        "12345",
      ),
    ).toBeNull();
  });
});

describe("extractSupporterReply", () => {
  const assistant = (text: string, streaming = false) => ({ role: "assistant", text, streaming });

  it("takes the section under the heading, up to the next heading", () => {
    const text = [
      "Root cause: the import skips zero quantities.",
      "",
      "### Reply to supporter",
      "Hej! Fejlen skyldes importen.",
      "Rettelsen kommer i næste release.",
      "",
      "### Notes",
      "Internal only.",
    ].join("\n");
    expect(extractSupporterReply([assistant(text)])).toBe(
      "Hej! Fejlen skyldes importen.\nRettelsen kommer i næste release.",
    );
  });

  it("uses the newest finished answer that has a reply", () => {
    expect(
      extractSupporterReply([
        assistant("## Reply to supporter\nOld reply"),
        { role: "user", text: "## Reply to supporter\nNot the agent", streaming: false },
        assistant("No reply section here"),
        assistant("## Reply to supporter\nStill streaming", true),
      ]),
    ).toBe("Old reply");
  });

  it("returns null when no answer has a reply", () => {
    expect(extractSupporterReply([assistant("Investigating…")])).toBeNull();
  });
});
