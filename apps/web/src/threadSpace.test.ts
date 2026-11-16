import { describe, expect, it } from "vite-plus/test";

import { switchableThreadSpaces } from "./threadSpace";

const server = (capabilities: { threadSpaces?: boolean; threadSpaceIds?: string[] }) => ({
  environment: { capabilities },
});

describe("switchableThreadSpaces", () => {
  it("offers each server's spaces, and never strands the user outside Development", () => {
    const current = server({
      threadSpaces: true,
      threadSpaceIds: ["development", "support", "automation"],
    });
    const beforeAutomation = server({ threadSpaces: true });
    const upstream = server({});

    expect(switchableThreadSpaces([current], "development")).toEqual([
      "development",
      "support",
      "automation",
    ]);
    expect(switchableThreadSpaces([beforeAutomation], "development")).toEqual([
      "development",
      "support",
    ]);
    expect(switchableThreadSpaces([upstream], "development")).toEqual([]);
    // Left in a space no connected server stores, e.g. while configs load after a restart.
    expect(switchableThreadSpaces([upstream], "automation")).toEqual(["development", "automation"]);
    expect(switchableThreadSpaces([], "support")).toEqual(["development", "support"]);
  });
});
