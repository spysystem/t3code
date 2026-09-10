import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { ServerSettings, ServerSettingsPatch } from "./settings.ts";
import { ThreadLinkRule, threadLinkRuleError } from "./threadLinks.ts";

const rule = { name: "Issue", pattern: "#(\\d+)", urlTemplate: "https://tracker.example/{1}" };
const decodeSettings = Schema.decodeUnknownSync(ServerSettings);
const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);
const decodeRule = Schema.decodeUnknownSync(ThreadLinkRule);

describe("thread link settings validation", () => {
  it("defaults older settings to no configured links", () => {
    const settings = decodeSettings({});
    expect(settings.defaultThreadLinkRules).toEqual([]);
    expect(settings.projectThreadLinkOverrides).toEqual({});
  });

  it.each([
    { ...rule, name: " " },
    { ...rule, pattern: "" },
    { ...rule, pattern: "(" },
    { ...rule, pattern: "a)|(?:b" },
    { ...rule, urlTemplate: "https://tracker.example/{2}" },
    { ...rule, urlTemplate: "https://tracker.example/{unknown}" },
    { ...rule, urlTemplate: "https://tracker.example/no-placeholder" },
    { ...rule, urlTemplate: "/relative/{1}" },
    { ...rule, urlTemplate: "javascript:alert({1})" },
  ])("rejects invalid rules at the settings boundary: %j", (invalid) => {
    expect(threadLinkRuleError(invalid)).not.toBeNull();
    expect(() => decodePatch({ defaultThreadLinkRules: [invalid] })).toThrow();
    expect(() =>
      decodePatch({
        projectThreadLinkOverrides: { project: [invalid] },
      }),
    ).toThrow();
  });

  it("accepts whole matches, numbered groups and lookarounds", () => {
    expect(decodeRule(rule)).toEqual(rule);
    expect(
      threadLinkRuleError({
        ...rule,
        pattern: "(?<=#)(\\d+)-(\\w+)",
        urlTemplate: "https://tracker.example/{1}/{2}?full={match}",
      }),
    ).toBeNull();
  });
});
