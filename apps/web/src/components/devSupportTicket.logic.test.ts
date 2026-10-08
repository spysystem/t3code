import { describe, expect, it } from "vite-plus/test";

import { findDevSupportThread, parseDevSupportTaskId } from "./devSupportTicket.logic";

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

describe("findDevSupportThread", () => {
  const thread = (overrides: Partial<Parameters<typeof findDevSupportThread>[0][number]>) => ({
    title: "Investigate #12345 Stock count mismatch",
    archivedAt: null,
    updatedAt: "2026-10-01T10:00:00.000Z",
    space: "support" as const,
    ...overrides,
  });

  it("picks the most recently active support thread that mentions the ticket", () => {
    const placeholder = thread({ title: "#12345", updatedAt: "2026-10-01T09:00:00.000Z" });
    const fix = thread({
      title: "Implement #12345 Stock count mismatch",
      updatedAt: "2026-10-02T09:00:00.000Z",
    });
    expect(findDevSupportThread([placeholder], "12345")).toBe(placeholder);
    expect(findDevSupportThread([placeholder, fix], "12345")).toBe(fix);
  });

  it("skips archived threads, other tickets, and development threads", () => {
    expect(
      findDevSupportThread(
        [
          thread({ archivedAt: "2026-10-03T00:00:00.000Z" }),
          thread({ title: "Investigate #123456 Other ticket" }),
          thread({ title: "Fix issue12345" }),
          thread({ space: "development" }),
        ],
        "12345",
      ),
    ).toBeNull();
  });
});
