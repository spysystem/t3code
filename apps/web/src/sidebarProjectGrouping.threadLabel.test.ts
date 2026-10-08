import { describe, expect, it } from "vite-plus/test";

import { threadProjectLabel } from "./sidebarProjectGrouping";

describe("threadProjectLabel", () => {
  const member = (title: string) => ({ title });

  it("names the thread's own checkout when the group merges differently titled projects", () => {
    const group = {
      displayName: "acme/shop",
      memberProjects: [member("shop-customer-a"), member("shop-customer-b")],
    };
    expect(threadProjectLabel(group, member("shop-customer-b"))).toBe("shop-customer-b");
  });

  it("keeps the group name when every member shares a title", () => {
    const group = {
      displayName: "t3code",
      memberProjects: [member("t3code"), member("t3code")],
    };
    expect(threadProjectLabel(group, member("t3code"))).toBe("t3code");
  });
});
