import { describe, expect, it } from "vite-plus/test";

import { threadProjectLabel } from "./sidebarProjectGrouping";

describe("threadProjectLabel", () => {
  const member = (title: string) => ({ title });

  it("names the thread's own checkout when the group merges differently titled projects", () => {
    const group = {
      displayName: "spysystem/spy",
      memberProjects: [member("2.mk.spysystem.dk"), member("3.cc.spysystem.dk")],
    };
    expect(threadProjectLabel(group, member("3.cc.spysystem.dk"))).toBe("3.cc.spysystem.dk");
  });

  it("keeps the group name when every member shares a title", () => {
    const group = {
      displayName: "t3code",
      memberProjects: [member("t3code"), member("t3code")],
    };
    expect(threadProjectLabel(group, member("t3code"))).toBe("t3code");
  });
});
