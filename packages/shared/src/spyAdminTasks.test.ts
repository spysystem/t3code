import { describe, expect, it } from "vite-plus/test";

import { parseSpyAdminTaskReference } from "./spyAdminTasks.ts";

describe("parseSpyAdminTaskReference", () => {
  const host = "admin.example.test";

  it("reads a task number, plain, #-prefixed or from a task link on the host", () => {
    expect(parseSpyAdminTaskReference(" 12345 ", host)).toBe("12345");
    expect(parseSpyAdminTaskReference("#12345", host)).toBe("12345");
    expect(
      parseSpyAdminTaskReference(
        "https://Admin.Example.Test/?controller=Task%5CView&action=ViewTask&iTaskID=12345",
        host,
      ),
    ).toBe("12345");
  });

  it("rejects other text, other hosts, and links that name no task", () => {
    expect(parseSpyAdminTaskReference("", host)).toBeNull();
    expect(parseSpyAdminTaskReference("12a45", host)).toBeNull();
    expect(parseSpyAdminTaskReference("0", host)).toBeNull();
    expect(parseSpyAdminTaskReference("https://elsewhere.test/?iTaskID=12345", host)).toBeNull();
    expect(parseSpyAdminTaskReference(`https://${host}/?iTaskID=abc`, host)).toBeNull();
    expect(parseSpyAdminTaskReference(`https://${host}/?controller=Task%5CView`, host)).toBeNull();
  });
});
